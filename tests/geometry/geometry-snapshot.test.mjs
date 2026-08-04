import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDownloadResult, serializeFeatures } from "../../packages/pipeline/src/geometry/geometry-snapshot.mjs";

test("serializeFeatures is deterministic regardless of input order", () => {
  const a = { properties: { OBJECTID: 1 }, geometry: { type: "Polygon", coordinates: [] } };
  const b = { properties: { OBJECTID: 2 }, geometry: { type: "Polygon", coordinates: [] } };
  const forward = serializeFeatures([a, b]);
  const reversed = serializeFeatures([b, a]);
  assert.deepEqual(forward, reversed);
});

test("buildDownloadResult produces a stable sha256 for the same features", () => {
  const fetchResult = {
    features: [{ properties: { OBJECTID: 1 }, geometry: { type: "Polygon", coordinates: [] } }],
    requestedUrl: "https://services-eu1.arcgis.com/x/query",
    resolvedUrl: "https://services-eu1.arcgis.com/x/query",
    attempts: 3,
    objectCount: 1
  };
  const first = buildDownloadResult(fetchResult);
  const second = buildDownloadResult(fetchResult);
  assert.equal(first.sha256, second.sha256);
  assert.match(first.sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.detectedMediaType, "application/json");
  assert.equal(first.declaredMediaType, "application/json");
  assert.equal(first.httpStatus, 200);
  assert.equal(first.attempts, 3);
  assert.equal(first.sizeBytes, first.bytes.length);
});

test("buildDownloadResult changes the sha256 when feature content changes", () => {
  const withOneFeature = buildDownloadResult({
    features: [{ properties: { OBJECTID: 1 }, geometry: { type: "Polygon", coordinates: [] } }],
    requestedUrl: "u",
    resolvedUrl: "u",
    attempts: 1,
    objectCount: 1
  });
  const withTwoFeatures = buildDownloadResult({
    features: [
      { properties: { OBJECTID: 1 }, geometry: { type: "Polygon", coordinates: [] } },
      { properties: { OBJECTID: 2 }, geometry: { type: "Polygon", coordinates: [] } }
    ],
    requestedUrl: "u",
    resolvedUrl: "u",
    attempts: 1,
    objectCount: 2
  });
  assert.notEqual(withOneFeature.sha256, withTwoFeatures.sha256);
});
