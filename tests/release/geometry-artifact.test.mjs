import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildGeometriesArtifact,
  GEOMETRY_DATA_LICENSE,
  readLatestGeometries
} from "../../packages/pipeline/src/release/geometry-artifact.mjs";

function row(overrides = {}) {
  return {
    territoryId: "019f8e0f-4c41-7361-b40e-e1c7744fd4e4",
    geometryKind: "source",
    detailLevel: "original",
    geometry: { type: "Polygon", coordinates: [[[23, 46], [24, 46], [24, 47], [23, 46]]] },
    sourceSnapshotId: "019fccd4-b267-726e-83fe-b632b3643cdb",
    sourceFeatureKey: "42",
    ...overrides
  };
}

test("buildGeometriesArtifact wraps rows into a FeatureCollection with the given license", () => {
  const artifact = buildGeometriesArtifact([row()]);
  assert.equal(artifact.type, "FeatureCollection");
  assert.equal(artifact.license, GEOMETRY_DATA_LICENSE);
  assert.equal(artifact.features.length, 1);
  assert.equal(artifact.features[0].type, "Feature");
  assert.equal(artifact.features[0].properties.territoryId, row().territoryId);
  assert.deepEqual(artifact.features[0].geometry, row().geometry);
});

test("buildGeometriesArtifact accepts a custom license", () => {
  const customLicense = { spdx: "CC0-1.0", name: "x", url: "https://example.org", attribution: "x" };
  const artifact = buildGeometriesArtifact([row()], customLicense);
  assert.equal(artifact.license, customLicense);
});

test("buildGeometriesArtifact is deterministic regardless of input order", () => {
  const a = row({ territoryId: "019f8e0f-4c41-7361-b40e-e1c7744fd4e4" });
  const b = row({ territoryId: "019f8e0f-4c42-7148-96d8-c4ad595c6a0d" });
  const forward = buildGeometriesArtifact([a, b]);
  const reversed = buildGeometriesArtifact([b, a]);
  assert.deepEqual(
    forward.features.map((f) => f.properties.territoryId),
    reversed.features.map((f) => f.properties.territoryId)
  );
});

test("buildGeometriesArtifact omits a null sourceFeatureKey rather than writing undefined", () => {
  const artifact = buildGeometriesArtifact([row({ sourceFeatureKey: undefined })]);
  assert.equal(artifact.features[0].properties.sourceFeatureKey, null);
});

test("readLatestGeometries selects the most recent row per territory/kind/level", async () => {
  const client = {
    calls: [],
    async query(sql) {
      this.calls.push(sql);
      return {
        rows: [
          {
            territory_id: "019f8e0f-4c41-7361-b40e-e1c7744fd4e4",
            geometry_kind: "source",
            detail_level: "original",
            geometry_geojson: JSON.stringify({ type: "Polygon", coordinates: [[[1, 2], [3, 4], [5, 6], [1, 2]]] }),
            source_snapshot_id: "019fccd4-b267-726e-83fe-b632b3643cdb",
            source_feature_key: "7"
          }
        ]
      };
    }
  };
  const rows = await readLatestGeometries(client);
  assert.match(client.calls[0], /distinct on \(territory_id, geometry_kind, detail_level\)/);
  assert.match(client.calls[0], /order by territory_id, geometry_kind, detail_level, created_at desc/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].territoryId, "019f8e0f-4c41-7361-b40e-e1c7744fd4e4");
  assert.deepEqual(rows[0].geometry, { type: "Polygon", coordinates: [[[1, 2], [3, 4], [5, 6], [1, 2]]] });
});
