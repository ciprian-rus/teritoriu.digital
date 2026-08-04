import assert from "node:assert/strict";
import { test } from "node:test";

import { geometryLabelPoint, geometryPath, getBounds, parseGeometry } from "../../lib/territory-geometry.mjs";

const SQUARE = { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };

test("parseGeometry accepts a Polygon or MultiPolygon object", () => {
  assert.deepEqual(parseGeometry(SQUARE), SQUARE);
  const multi = { type: "MultiPolygon", coordinates: [SQUARE.coordinates] };
  assert.deepEqual(parseGeometry(multi), multi);
});

test("parseGeometry accepts a JSON string and rejects everything else", () => {
  assert.deepEqual(parseGeometry(JSON.stringify(SQUARE)), SQUARE);
  assert.equal(parseGeometry(null), null);
  assert.equal(parseGeometry(undefined), null);
  assert.equal(parseGeometry("not json"), null);
  assert.equal(parseGeometry({ type: "Point", coordinates: [0, 0] }), null);
  assert.equal(parseGeometry({ type: "Polygon" }), null);
});

test("getBounds computes the exterior bounding box across geometries", () => {
  const other = { type: "Polygon", coordinates: [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]] };
  const bounds = getBounds([SQUARE, other]);
  assert.deepEqual(bounds, { minX: 0, minY: 0, maxX: 6, maxY: 6 });
});

test("getBounds returns null for an empty geometry list", () => {
  assert.equal(getBounds([]), null);
});

test("geometryPath projects a square into an SVG path that starts and closes", () => {
  const bounds = getBounds([SQUARE]);
  const path = geometryPath(SQUARE, bounds, 100, 100, 0);
  assert.match(path, /^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+ L[\d.]+,[\d.]+ L[\d.]+,[\d.]+ L[\d.]+,[\d.]+ Z$/);
});

test("geometryPath fills the viewBox for a single square with no padding", () => {
  const bounds = getBounds([SQUARE]);
  const path = geometryPath(SQUARE, bounds, 100, 100, 0);
  const points = [...path.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.max(...xs), 100);
  assert.equal(Math.min(...ys), 0);
  assert.equal(Math.max(...ys), 100);
});

test("geometryLabelPoint returns the viewBox center for an empty geometry", () => {
  const empty = { type: "Polygon", coordinates: [] };
  const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  assert.deepEqual(geometryLabelPoint(empty, bounds, 100, 100, 0), [50, 50]);
});

test("geometryLabelPoint stays inside the projected shape for a square", () => {
  const bounds = getBounds([SQUARE]);
  const [x, y] = geometryLabelPoint(SQUARE, bounds, 100, 100, 0);
  assert.ok(x > 0 && x < 100);
  assert.ok(y > 0 && y < 100);
});

test("geometryPath handles a MultiPolygon as one path per polygon", () => {
  const other = { type: "Polygon", coordinates: [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]] };
  const multi = { type: "MultiPolygon", coordinates: [SQUARE.coordinates, other.coordinates] };
  const bounds = getBounds([multi]);
  const path = geometryPath(multi, bounds, 100, 100, 0);
  assert.equal((path.match(/Z/g) ?? []).length, 2);
});
