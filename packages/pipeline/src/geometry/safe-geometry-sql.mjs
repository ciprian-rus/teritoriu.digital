/**
 * SQL fragment that turns any geometry expression into a strictly-typed-safe
 * MultiPolygon. `gis.ST_MakeValid` on a badly broken geometry can return a
 * `GEOMETRYCOLLECTION` (stray points/lines alongside the polygon), which the
 * schema's strictly-typed `multipolygon` column rejects outright at insert —
 * confirmed against real production data across three independent write
 * paths (county/București union in derive-county-geometries.mjs, the
 * derived-geometry insert in write-geometries.mjs, the ANCPI source-geometry
 * correction in correct-source-geometries.mjs). `ST_CollectionExtract(...,
 * 3)` (3 = polygon) keeps only the polygonal parts before the final
 * `ST_Multi`; the dropped fragments are zero-area artifacts, not real area.
 *
 * `geometryExpression` is inlined as raw SQL text, not a bound parameter —
 * callers pass a placeholder (`$1`, `$3`, ...), a column reference, or a
 * larger expression (e.g. `gis.ST_Union(...)`).
 */
export function safeMultiPolygonSql(geometryExpression) {
  return `gis.ST_Multi(gis.ST_CollectionExtract(gis.ST_MakeValid(${geometryExpression}), 3))`;
}
