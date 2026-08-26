import { createHash } from "node:crypto";

import { AcquisitionError } from "../acquisition/errors.mjs";
import { uuidV7 } from "../acquisition/uuid-v7.mjs";
import { safeMultiPolygonSql } from "./safe-geometry-sql.mjs";

// Everything ANCPI RELUAT publishes a polygon for: județe/București at the
// root, their UAT-uri, and București's sectoare (which sit one hop below
// the UAT-equivalent "MUNICIPIUL BUCUREȘTI" record, not below the root —
// see the routing catch-all's own handling of this same quirk). Component
// localities and sate have no ANCPI-published boundary and are excluded.
const ELIGIBLE_TERRITORY_TYPES = ["county", "bucharest", "municipality", "city", "commune", "sector"];

export async function readMatchableTerritories(client) {
  const result = await client.query(
    `select
       revision.territory_id::text as territory_id,
       revision.official_name,
       revision.short_name,
       revision.territory_type,
       revision.county_territory_id::text as county_territory_id,
       identifier.value as siruta_code
     from registry.territory_revisions revision
     left join registry.territory_identifiers identifier
       on identifier.territory_id = revision.territory_id
      and identifier.scheme = 'ro.ins.siruta'
      and identifier.status = 'active'
     where revision.recorded_to is null
       and revision.territory_type = any($1::text[])`,
    [ELIGIBLE_TERRITORY_TYPES]
  );
  return result.rows.map((row) => ({
    territoryId: row.territory_id,
    officialName: row.official_name,
    shortName: row.short_name,
    territoryType: row.territory_type,
    countyTerritoryId: row.county_territory_id,
    sirutaCode: row.siruta_code
  }));
}

/**
 * Writes one 'source'/'original' geometry per matched territory for this
 * snapshot. Never updates or deletes a prior snapshot's rows in place — a
 * re-run (or a later ANCPI update) adds new rows referencing the new
 * snapshot; readers pick the most recent row per (territory_id,
 * geometry_kind, detail_level), the same "current view over an immutable
 * history" convention territory_revisions already uses. Fails closed
 * (writes nothing) if fewer than minExpectedMatchedCount territories
 * matched, or if the same territoryId appears more than once in the batch.
 * matchFeaturesToTerritories already guarantees the latter (its output is
 * deduplicated by territoryId, with real ambiguity reported separately as
 * `conflicts`), but this function doesn't trust that upstream guarantee —
 * it checks its own input, the same "don't trust the caller" discipline
 * used throughout this codebase.
 */
export async function writeGeometries(client, snapshotId, matchedRows, options = {}) {
  const minExpectedMatchedCount = options.minExpectedMatchedCount ?? 0;
  if (matchedRows.length < minExpectedMatchedCount) {
    throw new AcquisitionError(
      "MATCHED_COUNT_TOO_LOW",
      `Only ${matchedRows.length} geometries matched, expected at least ${minExpectedMatchedCount}`
    );
  }

  const seenTerritoryIds = new Set();
  for (const row of matchedRows) {
    if (seenTerritoryIds.has(row.territoryId)) {
      throw new AcquisitionError(
        "DUPLICATE_TERRITORY_IN_BATCH",
        `Territory ${row.territoryId} appears more than once in this batch`
      );
    }
    seenTerritoryIds.add(row.territoryId);
  }

  await client.query("begin");
  try {
    for (const row of matchedRows) {
      const geometryJson = JSON.stringify(row.geometry);
      const geometrySha256 = createHash("sha256").update(geometryJson).digest("hex");
      await client.query(
        `insert into registry.territory_geometries (
           geometry_id, territory_id, geometry_kind, detail_level, geometry,
           source_crs, source_snapshot_id, source_feature_key, license_spdx,
           geometry_sha256, valid_from
         ) values (
           $1::uuid, $2::uuid, 'source', 'original',
           gis.ST_SetSRID(gis.ST_Multi(gis.ST_GeomFromGeoJSON($3)), 4326),
           'EPSG:4326', $4::uuid, $5, $6, $7, current_date
         )`,
        [uuidV7(), row.territoryId, geometryJson, snapshotId, row.sourceFeatureKey, options.licenseSpdx ?? null, geometrySha256]
      );
    }
    await client.query(
      `insert into registry.audit_events (
         audit_event_id, event_type, entity_kind, entity_key, actor, payload
       ) values ($1::uuid, 'territory_geometries_imported', 'source_snapshot', $2, $3, $4::jsonb)`,
      [uuidV7(), snapshotId, "pipeline:geometry-acquisition", JSON.stringify({ matchedCount: matchedRows.length })]
    );
    await client.query("commit");
  } catch (cause) {
    await client.query("rollback").catch(() => {});
    if (cause instanceof AcquisitionError) throw cause;
    throw new AcquisitionError("GEOMETRY_WRITE_FAILED", "Writing territory geometries failed", {
      cause,
      retryable: true
    });
  }
}

/**
 * Writes one 'derived'/'original' geometry per given root (county or
 * București), computed by union elsewhere (see
 * derive-county-geometries.mjs). Same append-only convention as
 * writeGeometries: never updates a prior row in place.
 *
 * safeMultiPolygonSql wraps ST_GeomFromGeoJSON here even though the SQL that
 * produced row.geometry already validated its own output: round-tripping
 * through GeoJSON text (ST_AsGeoJSON there, JSON here, ST_GeomFromGeoJSON
 * on the way back in) can itself reintroduce a self-intersection from
 * coordinate precision loss. Confirmed against real production data —
 * geometries that were valid going out came back invalid on the way in
 * without this wrap. See safe-geometry-sql.mjs for the GEOMETRYCOLLECTION
 * guard this also provides.
 */
export async function writeDerivedGeometries(client, rows, options = {}) {
  await client.query("begin");
  try {
    for (const row of rows) {
      const geometryJson = JSON.stringify(row.geometry);
      const geometrySha256 = createHash("sha256").update(geometryJson).digest("hex");
      await client.query(
        `insert into registry.territory_geometries (
           geometry_id, territory_id, geometry_kind, detail_level, geometry,
           source_crs, source_snapshot_id, license_spdx, geometry_sha256,
           derivation_method, valid_from
         ) values (
           $1::uuid, $2::uuid, 'derived', 'original',
           gis.ST_SetSRID(
             ${safeMultiPolygonSql("gis.ST_GeomFromGeoJSON($3)")},
             4326
           ),
           'EPSG:4326', $4::uuid, $5, $6, $7, current_date
         )`,
        [
          uuidV7(),
          row.rootTerritoryId,
          geometryJson,
          row.snapshotId,
          options.licenseSpdx ?? null,
          geometrySha256,
          options.derivationMethod
        ]
      );
    }
    await client.query(
      `insert into registry.audit_events (
         audit_event_id, event_type, entity_kind, entity_key, actor, payload
       ) values ($1::uuid, 'territory_geometries_derived', 'derivation_method', $2, $3, $4::jsonb)`,
      [
        uuidV7(),
        options.derivationMethod,
        "pipeline:geometry-derivation",
        JSON.stringify({ derivedCount: rows.length })
      ]
    );
    await client.query("commit");
  } catch (cause) {
    await client.query("rollback").catch(() => {});
    if (cause instanceof AcquisitionError) throw cause;
    throw new AcquisitionError("GEOMETRY_DERIVATION_WRITE_FAILED", "Writing derived territory geometries failed", {
      cause,
      retryable: true
    });
  }
}
