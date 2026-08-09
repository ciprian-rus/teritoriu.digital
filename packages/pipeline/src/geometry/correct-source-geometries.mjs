import { createHash } from "node:crypto";

import { AcquisitionError } from "../acquisition/errors.mjs";
import { uuidV7 } from "../acquisition/uuid-v7.mjs";

export const SOURCE_VALIDITY_CORRECTION_METHOD = "st_makevalid_source_correction";

// ANCPI's own published UAT polygons ('source' geometry_kind) sometimes
// self-intersect — confirmed against real production data (34/3186), never
// touched by derive-county-geometries.mjs, which re-validates each child
// itself before unioning. This module reads only the current row per
// (territory_id, geometry_kind, detail_level) — the same "current view over
// immutable history" convention as production-restore-drill.sh and
// geometry-artifact.mjs — so a territory whose earlier 'source' row was
// invalid but has since been re-acquired from a newer, valid ANCPI snapshot
// is correctly skipped here, not re-corrected.
const INVALID_CURRENT_SOURCE_QUERY = `
  with current_source as (
    select distinct on (territory_id, geometry_kind, detail_level)
      territory_id, source_snapshot_id, source_feature_key, license_spdx, geometry
    from registry.territory_geometries
    where geometry_kind = 'source'
    order by territory_id, geometry_kind, detail_level, created_at desc
  )
  select
    territory_id::text as territory_id,
    source_snapshot_id::text as source_snapshot_id,
    source_feature_key,
    license_spdx,
    gis.ST_AsGeoJSON(geometry) as geometry_geojson
  from current_source
  where not gis.ST_IsValid(geometry)
  order by territory_id
`;

export async function readInvalidCurrentSourceGeometries(client) {
  const result = await client.query(INVALID_CURRENT_SOURCE_QUERY);
  return result.rows.map((row) => ({
    territoryId: row.territory_id,
    sourceSnapshotId: row.source_snapshot_id,
    sourceFeatureKey: row.source_feature_key,
    licenseSpdx: row.license_spdx,
    geometry: JSON.parse(row.geometry_geojson)
  }));
}

/**
 * Writes one 'source_corrected' row per invalid current 'source' geometry.
 * Never touches or replaces the original 'source' row — both stay in
 * registry.territory_geometries, distinguished by geometry_kind, so the
 * corrected value is never presented as ANCPI's unmodified original
 * (README, "principii nenegociabile": corecțiile tehnice nu sunt prezentate
 * drept modificări ale sursei oficiale).
 *
 * ST_MakeValid + ST_CollectionExtract(..., 3) + ST_Multi on insert, same
 * GEOMETRYCOLLECTION guard as writeDerivedGeometries and for the same
 * reason: re-parsing GeoJSON can itself reintroduce a self-intersection
 * from coordinate precision loss, so the transform is re-applied at the
 * actual write boundary, not trusted from an earlier computation.
 *
 * Fails closed per row: if the correction still isn't valid, that
 * territory is reported in `stillInvalid` and nothing is written for it —
 * never a half-corrected geometry presented as fixed.
 */
export async function writeSourceCorrections(client, rows, options = {}) {
  const derivationMethod = options.derivationMethod ?? SOURCE_VALIDITY_CORRECTION_METHOD;
  const corrected = [];
  const stillInvalid = [];
  await client.query("begin");
  try {
    for (const row of rows) {
      const geometryJson = JSON.stringify(row.geometry);
      const check = await client.query(
        `select
           gis.ST_IsValid(
             gis.ST_Multi(gis.ST_CollectionExtract(gis.ST_MakeValid(gis.ST_GeomFromGeoJSON($1)), 3))
           ) as is_valid`,
        [geometryJson]
      );
      if (!check.rows[0].is_valid) {
        stillInvalid.push(row.territoryId);
        continue;
      }
      const geometrySha256 = createHash("sha256").update(geometryJson).digest("hex");
      await client.query(
        `insert into registry.territory_geometries (
           geometry_id, territory_id, geometry_kind, detail_level, geometry,
           source_crs, source_snapshot_id, source_feature_key, license_spdx,
           geometry_sha256, derivation_method, valid_from
         ) values (
           $1::uuid, $2::uuid, 'source_corrected', 'original',
           gis.ST_SetSRID(
             gis.ST_Multi(gis.ST_CollectionExtract(gis.ST_MakeValid(gis.ST_GeomFromGeoJSON($3)), 3)),
             4326
           ),
           'EPSG:4326', $4::uuid, $5, $6, $7, $8, current_date
         )`,
        [
          uuidV7(),
          row.territoryId,
          geometryJson,
          row.sourceSnapshotId,
          row.sourceFeatureKey,
          row.licenseSpdx,
          geometrySha256,
          derivationMethod
        ]
      );
      corrected.push(row.territoryId);
    }
    await client.query(
      `insert into registry.audit_events (
         audit_event_id, event_type, entity_kind, entity_key, actor, payload
       ) values ($1::uuid, 'territory_geometries_source_corrected', 'derivation_method', $2, $3, $4::jsonb)`,
      [
        uuidV7(),
        derivationMethod,
        "pipeline:geometry-source-correction",
        JSON.stringify({ correctedCount: corrected.length, stillInvalidCount: stillInvalid.length, stillInvalid })
      ]
    );
    await client.query("commit");
  } catch (cause) {
    await client.query("rollback").catch(() => {});
    if (cause instanceof AcquisitionError) throw cause;
    throw new AcquisitionError(
      "GEOMETRY_SOURCE_CORRECTION_WRITE_FAILED",
      "Writing corrected source territory geometries failed",
      { cause, retryable: true }
    );
  }
  return { corrected, stillInvalid };
}
