import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveGeometriesByTerritoryId } from "../../lib/release-source.mjs";

function feature(territoryId, geometryKind, geometry = { type: "Polygon", coordinates: [] }) {
  return { type: "Feature", geometry, properties: { territoryId, geometryKind } };
}

test("resolveGeometriesByTerritoryId keeps the single geometry for a territory with only one feature", () => {
  const geometry = { type: "Polygon", coordinates: [[[1, 2]]] };
  const map = resolveGeometriesByTerritoryId({ features: [feature("t1", "source", geometry)] });
  assert.equal(map.size, 1);
  assert.deepEqual(map.get("t1"), geometry);
});

test("resolveGeometriesByTerritoryId prefers source_corrected over source for the same territory", () => {
  const sourceGeometry = { type: "Polygon", coordinates: [[[1, 2]]] };
  const correctedGeometry = { type: "Polygon", coordinates: [[[3, 4]]] };
  const map = resolveGeometriesByTerritoryId({
    features: [feature("t1", "source", sourceGeometry), feature("t1", "source_corrected", correctedGeometry)]
  });
  assert.equal(map.size, 1);
  assert.deepEqual(map.get("t1"), correctedGeometry);
});

test("resolveGeometriesByTerritoryId prefers source_corrected regardless of feature order", () => {
  const sourceGeometry = { type: "Polygon", coordinates: [[[1, 2]]] };
  const correctedGeometry = { type: "Polygon", coordinates: [[[3, 4]]] };
  const map = resolveGeometriesByTerritoryId({
    features: [feature("t1", "source_corrected", correctedGeometry), feature("t1", "source", sourceGeometry)]
  });
  assert.deepEqual(map.get("t1"), correctedGeometry);
});

test("resolveGeometriesByTerritoryId keeps geometries for unrelated territories independent", () => {
  const map = resolveGeometriesByTerritoryId({
    features: [
      feature("t1", "source", { type: "Polygon", coordinates: [[[1, 2]]] }),
      feature("t2", "derived", { type: "Polygon", coordinates: [[[3, 4]]] })
    ]
  });
  assert.equal(map.size, 2);
  assert.deepEqual(map.get("t2"), { type: "Polygon", coordinates: [[[3, 4]]] });
});
