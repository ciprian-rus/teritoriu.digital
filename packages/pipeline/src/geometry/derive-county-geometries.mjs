// ANCPI RELUAT never publishes a polygon for a county/București directly —
// only for their UAT-level children (see write-geometries.mjs). This module
// derives one by unioning those children's already-stored 'source' geometries.
//
// "Children for union" = leaf territories under a root's county_territory_id
// grouping, restricted to the UAT-level types ANCPI actually publishes
// (municipality/city/commune/sector). "Leaf" excludes MUNICIPIUL BUCUREȘTI:
// it carries territory_type 'municipality' and county_territory_id pointing
// straight at București (like a real UAT), but it has no ANCPI geometry of
// its own — its 6 sectors, whose parent_territory_id points at it, are the
// real geometry-bearing children. Detecting "has a candidate child of its
// own within the same group" generalizes this without naming București.
const CANDIDATE_QUERY = `
  with candidates as (
    select territory_id, county_territory_id, parent_territory_id
    from registry.territory_revisions
    where recorded_to is null
      and territory_type in ('municipality', 'city', 'commune', 'sector')
  ),
  leaf_candidates as (
    select c.territory_id, c.county_territory_id
    from candidates c
    where not exists (
      select 1 from candidates child where child.parent_territory_id = c.territory_id
    )
  ),
  latest_geometry as (
    select distinct on (territory_id)
      territory_id, source_snapshot_id, geometry
    from registry.territory_geometries
    where geometry_kind = 'source' and detail_level = 'original'
    order by territory_id, created_at desc
  )
  select
    lc.county_territory_id::text as root_territory_id,
    count(*)::int as expected_count,
    count(lg.territory_id)::int as actual_count,
    array_remove(array_agg(distinct lg.source_snapshot_id::text), null) as snapshot_ids,
    gis.ST_AsGeoJSON(gis.ST_Multi(gis.ST_Union(gis.ST_MakeValid(lg.geometry)))) as union_geojson
  from leaf_candidates lc
  left join latest_geometry lg on lg.territory_id = lc.territory_id
  group by lc.county_territory_id
`;

export async function readCountyUnionCandidates(client) {
  const result = await client.query(CANDIDATE_QUERY);
  return result.rows.map((row) => ({
    rootTerritoryId: row.root_territory_id,
    expectedCount: row.expected_count,
    actualCount: row.actual_count,
    snapshotIds: row.snapshot_ids,
    geometry: row.union_geojson ? JSON.parse(row.union_geojson) : null
  }));
}

/**
 * Fails closed per root rather than guessing: a root is only derived when
 * every expected child currently has a geometry (no silent holes in the
 * union) and every child's geometry traces to the same source snapshot (no
 * mixing geometry vintages into one shape). Everything else is reported as
 * skipped with why, never dropped silently.
 */
export function selectDerivableCounties(candidates) {
  const derivable = [];
  const skipped = [];
  for (const candidate of candidates) {
    if (candidate.expectedCount === 0) {
      skipped.push({ rootTerritoryId: candidate.rootTerritoryId, reason: "no-eligible-children" });
    } else if (candidate.actualCount < candidate.expectedCount) {
      skipped.push({
        rootTerritoryId: candidate.rootTerritoryId,
        reason: "incomplete-children",
        actualCount: candidate.actualCount,
        expectedCount: candidate.expectedCount
      });
    } else if (candidate.snapshotIds.length !== 1) {
      skipped.push({
        rootTerritoryId: candidate.rootTerritoryId,
        reason: "ambiguous-snapshot",
        snapshotIds: candidate.snapshotIds
      });
    } else {
      derivable.push({
        rootTerritoryId: candidate.rootTerritoryId,
        geometry: candidate.geometry,
        snapshotId: candidate.snapshotIds[0]
      });
    }
  }
  return { derivable, skipped };
}
