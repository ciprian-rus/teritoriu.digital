import assert from "node:assert/strict";
import { test } from "node:test";

import { safeMultiPolygonSql } from "../../packages/pipeline/src/geometry/safe-geometry-sql.mjs";

test("safeMultiPolygonSql wraps an expression with ST_MakeValid, ST_CollectionExtract(...,3) and ST_Multi", () => {
  const sql = safeMultiPolygonSql("gis.ST_GeomFromGeoJSON($1)");
  assert.equal(sql, "gis.ST_Multi(gis.ST_CollectionExtract(gis.ST_MakeValid(gis.ST_GeomFromGeoJSON($1)), 3))");
});

test("safeMultiPolygonSql inlines arbitrary expressions verbatim, not just placeholders", () => {
  const sql = safeMultiPolygonSql("gis.ST_Union(gis.ST_MakeValid(lg.geometry))");
  assert.equal(
    sql,
    "gis.ST_Multi(gis.ST_CollectionExtract(gis.ST_MakeValid(gis.ST_Union(gis.ST_MakeValid(lg.geometry))), 3))"
  );
});
