import assert from "node:assert/strict";
import { test } from "node:test";

import { readMatchableTerritories, writeGeometries } from "../../packages/pipeline/src/geometry/write-geometries.mjs";

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

function matchedRow(overrides = {}) {
  return {
    territoryId: "019f8e0f-4c41-7361-b40e-e1c7744fd4e4",
    geometry: { type: "Polygon", coordinates: [[[23, 46], [24, 46], [24, 47], [23, 46]]] },
    sourceFeatureKey: "42",
    ...overrides
  };
}

test("readMatchableTerritories only selects current revisions of ANCPI-eligible types", async () => {
  const rows = [
    {
      territory_id: "alba",
      official_name: "JUDEȚUL ALBA",
      short_name: "ALBA",
      territory_type: "county",
      county_territory_id: "alba",
      siruta_code: "10"
    }
  ];
  const client = clientMock({ rows });
  const territories = await readMatchableTerritories(client);
  assert.equal(territories.length, 1);
  assert.equal(territories[0].territoryId, "alba");
  assert.equal(territories[0].sirutaCode, "10");
  assert.match(client.calls[0].sql, /recorded_to is null/);
  assert.match(client.calls[0].sql, /territory_type = any\(\$1::text\[\]\)/);
  assert.deepEqual(client.calls[0].parameters[0], ["county", "bucharest", "municipality", "city", "commune", "sector"]);
});

test("writeGeometries fails closed and writes nothing when below the expected minimum", async () => {
  const client = clientMock();
  await assert.rejects(
    writeGeometries(client, "snap-1", [matchedRow()], { minExpectedMatchedCount: 2 }),
    { code: "MATCHED_COUNT_TOO_LOW" }
  );
  assert.equal(client.calls.length, 0);
});

test("writeGeometries inserts one row per match plus an audit event, then commits", async () => {
  const client = clientMock();
  const rows = [matchedRow(), matchedRow({ territoryId: "019f8e0f-4c42-70e7-8cc8-6bc449d622f7", sourceFeatureKey: "43" })];
  await writeGeometries(client, "snap-1", rows, { minExpectedMatchedCount: 2, licenseSpdx: "CC-BY-4.0" });

  assert.equal(client.calls[0].sql, "begin");
  assert.equal(client.calls.at(-1).sql, "commit");
  const inserts = client.calls.filter(({ sql }) => sql.includes("insert into registry.territory_geometries"));
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].sql, /'source', 'original'/);
  assert.match(inserts[0].sql, /gis\.ST_SetSRID\(gis\.ST_Multi\(gis\.ST_GeomFromGeoJSON\(\$3\)\), 4326\)/);
  assert.equal(inserts[0].parameters[1], rows[0].territoryId);
  assert.equal(inserts[0].parameters[3], "snap-1");
  assert.equal(inserts[0].parameters[5], "CC-BY-4.0");
  assert.ok(client.calls.some(({ sql }) => sql.includes("insert into registry.audit_events")));
});

test("writeGeometries rolls back and writes nothing durable when an insert fails", async () => {
  const client = clientMock({ failOn: "insert into registry.territory_geometries" });
  await assert.rejects(
    writeGeometries(client, "snap-1", [matchedRow(), matchedRow({ territoryId: "other" })], { minExpectedMatchedCount: 1 }),
    { code: "GEOMETRY_WRITE_FAILED" }
  );
  assert.equal(client.calls.at(-1).sql, "rollback");
  assert.equal(client.calls.some(({ sql }) => sql === "commit"), false);
});
