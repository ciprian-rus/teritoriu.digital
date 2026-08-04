export const GEOMETRY_DATA_LICENSE = Object.freeze({
  spdx: "CC-BY-4.0",
  name: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Sursa geometriilor: Agenția Națională de Cadastru și Publicitate Imobiliară (ANCPI), RELUAT."
});

/**
 * Reads the most recent geometry per (territory_id, geometry_kind,
 * detail_level) — a re-run of the acquisition pipeline never overwrites a
 * prior snapshot's rows in place, so "current" is read-time, not
 * write-time, the same convention registry.territory_revisions already
 * uses for identity data.
 */
export async function readLatestGeometries(client) {
  const result = await client.query(
    `select distinct on (territory_id, geometry_kind, detail_level)
       territory_id::text as territory_id,
       geometry_kind,
       detail_level,
       gis.ST_AsGeoJSON(geometry) as geometry_geojson,
       source_snapshot_id::text as source_snapshot_id,
       source_feature_key
     from registry.territory_geometries
     order by territory_id, geometry_kind, detail_level, created_at desc`
  );
  return result.rows.map((row) => ({
    territoryId: row.territory_id,
    geometryKind: row.geometry_kind,
    detailLevel: row.detail_level,
    geometry: JSON.parse(row.geometry_geojson),
    sourceSnapshotId: row.source_snapshot_id,
    sourceFeatureKey: row.source_feature_key ?? null
  }));
}

/**
 * Builds the public territory-geometries.geojson payload deterministically
 * (sorted by territoryId, then geometryKind, then detailLevel), so two
 * builds from the same underlying rows are byte-identical — the same
 * guarantee buildReleaseBundle already gives every other artifact.
 */
export function buildGeometriesArtifact(rows, license = GEOMETRY_DATA_LICENSE) {
  const features = [...rows]
    .sort((a, b) => {
      if (a.territoryId !== b.territoryId) return a.territoryId < b.territoryId ? -1 : 1;
      if (a.geometryKind !== b.geometryKind) return a.geometryKind < b.geometryKind ? -1 : 1;
      return a.detailLevel < b.detailLevel ? -1 : a.detailLevel > b.detailLevel ? 1 : 0;
    })
    .map((row) => ({
      type: "Feature",
      geometry: row.geometry,
      properties: {
        territoryId: row.territoryId,
        geometryKind: row.geometryKind,
        detailLevel: row.detailLevel,
        sourceSnapshotId: row.sourceSnapshotId,
        sourceFeatureKey: row.sourceFeatureKey ?? null
      }
    }));
  return { type: "FeatureCollection", license, features };
}
