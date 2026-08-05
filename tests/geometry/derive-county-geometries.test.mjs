import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readCountyUnionCandidates,
  selectDerivableCounties
} from "../../packages/pipeline/src/geometry/derive-county-geometries.mjs";
import { writeDerivedGeometries } from "../../packages/pipeline/src/geometry/write-geometries.mjs";

function clientMock(options = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (options.failOn && sql.includes(options.failOn)) throw new Error("database failure");
      if (options.rows) return { rows: options.rows };
      return { rows: [] };
    }
  };
}

function candidate(overrides = {}) {
  return {
    rootTerritoryId: "alba",
    expectedCount: 78,
    actualCount: 78,
    snapshotIds: ["snap-1"],
    geometry: { type: "MultiPolygon", coordinates: [[[[23, 46], [24, 46], [24, 47], [23, 46]]]] },
    ...overrides
  };
}

test("readCountyUnionCandidates maps rows and parses the union geometry", async () => {
  const geometry = { type: "MultiPolygon", coordinates: [[[[23, 46], [24, 46], [24, 47], [23, 46]]]] };
  const client = clientMock({
    rows: [
      {
        root_territory_id: "alba",
        expected_count: 78,
        actual_count: 78,
        snapshot_ids: ["snap-1"],
        union_geojson: JSON.stringify(geometry)
      },
      {
        root_territory_id: "empty-root",
        expected_count: 0,
        actual_count: 0,
        snapshot_ids: [],
        union_geojson: null
      }
    ]
  });
  const candidates = await readCountyUnionCandidates(client);
  assert.deepEqual(candidates, [
    { rootTerritoryId: "alba", expectedCount: 78, actualCount: 78, snapshotIds: ["snap-1"], geometry },
    { rootTerritoryId: "empty-root", expectedCount: 0, actualCount: 0, snapshotIds: [], geometry: null }
  ]);
});

test("selectDerivableCounties accepts a root with every child present from one snapshot", () => {
  const { derivable, skipped } = selectDerivableCounties([candidate()]);
  assert.equal(skipped.length, 0);
  assert.deepEqual(derivable, [{ rootTerritoryId: "alba", geometry: candidate().geometry, snapshotId: "snap-1" }]);
});

test("selectDerivableCounties skips a root with no eligible children", () => {
  const { derivable, skipped } = selectDerivableCounties([
    candidate({ rootTerritoryId: "ghost", expectedCount: 0, actualCount: 0, snapshotIds: [], geometry: null })
  ]);
  assert.equal(derivable.length, 0);
  assert.deepEqual(skipped, [{ rootTerritoryId: "ghost", reason: "no-eligible-children" }]);
});

test("selectDerivableCounties fails closed rather than unioning a partial set of children", () => {
  const { derivable, skipped } = selectDerivableCounties([
    candidate({ rootTerritoryId: "bucuresti", expectedCount: 6, actualCount: 5 })
  ]);
  assert.equal(derivable.length, 0);
  assert.deepEqual(skipped, [
    { rootTerritoryId: "bucuresti", reason: "incomplete-children", actualCount: 5, expectedCount: 6 }
  ]);
});

test("selectDerivableCounties fails closed on children spanning more than one source snapshot", () => {
  const { derivable, skipped } = selectDerivableCounties([
    candidate({ rootTerritoryId: "arad", snapshotIds: ["snap-1", "snap-2"] })
  ]);
  assert.equal(derivable.length, 0);
  assert.deepEqual(skipped, [
    { rootTerritoryId: "arad", reason: "ambiguous-snapshot", snapshotIds: ["snap-1", "snap-2"] }
  ]);
});

test("writeDerivedGeometries inserts one derived row per root plus an audit event, then commits", async () => {
  const client = clientMock();
  await writeDerivedGeometries(
    client,
    [{ rootTerritoryId: "alba", geometry: candidate().geometry, snapshotId: "snap-1" }],
    { licenseSpdx: "CC-BY-4.0", derivationMethod: "union_of_children_v1" }
  );
  const statements = client.calls.map((call) => call.sql);
  assert.equal(statements[0], "begin");
  assert.match(statements[1], /geometry_kind, detail_level, geometry/);
  assert.match(statements[1], /'derived', 'original'/);
  assert.match(statements[2], /territory_geometries_derived/);
  assert.equal(statements[3], "commit");
});

test("writeDerivedGeometries rolls back and writes nothing durable when an insert fails", async () => {
  const client = clientMock({ failOn: "insert into registry.territory_geometries" });
  await assert.rejects(
    writeDerivedGeometries(
      client,
      [{ rootTerritoryId: "alba", geometry: candidate().geometry, snapshotId: "snap-1" }],
      { derivationMethod: "union_of_children_v1" }
    ),
    { code: "GEOMETRY_DERIVATION_WRITE_FAILED" }
  );
  assert.equal(client.calls.at(-1).sql, "rollback");
});
