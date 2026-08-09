import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readInvalidCurrentSourceGeometries,
  writeSourceCorrections,
  SOURCE_VALIDITY_CORRECTION_METHOD
} from "../../packages/pipeline/src/geometry/correct-source-geometries.mjs";

function clientMock(options = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (options.failOn && sql.includes(options.failOn)) throw new Error("database failure");
      if (options.isValidByCall) {
        const index = calls.filter((call) => call.sql.includes("is_valid")).length - 1;
        return { rows: [{ is_valid: options.isValidByCall[index] }] };
      }
      if (options.rows) return { rows: options.rows };
      return { rows: [] };
    }
  };
}

function invalidRow(overrides = {}) {
  return {
    territoryId: "alba-iulia",
    sourceSnapshotId: "snap-1",
    sourceFeatureKey: "feature-1",
    licenseSpdx: "CC-BY-4.0",
    geometry: { type: "MultiPolygon", coordinates: [[[[23, 46], [24, 46], [24, 47], [23, 46]]]] },
    ...overrides
  };
}

test("readInvalidCurrentSourceGeometries scopes to current 'source' rows only", async () => {
  const client = clientMock({ rows: [] });
  await readInvalidCurrentSourceGeometries(client);
  const sql = client.calls[0].sql;
  // Regression guard, same convention as production-restore-drill.sh: must
  // read the current row per (territory_id, geometry_kind, detail_level),
  // not every historical row ever written.
  assert.match(sql, /distinct on \(territory_id, geometry_kind, detail_level\)/);
  assert.match(sql, /where geometry_kind = 'source'/);
  assert.match(sql, /where not gis\.ST_IsValid\(geometry\)/);
});

test("readInvalidCurrentSourceGeometries maps rows and parses geometry", async () => {
  const geometry = { type: "MultiPolygon", coordinates: [[[[23, 46], [24, 46], [24, 47], [23, 46]]]] };
  const client = clientMock({
    rows: [
      {
        territory_id: "alba-iulia",
        source_snapshot_id: "snap-1",
        source_feature_key: "feature-1",
        license_spdx: "CC-BY-4.0",
        geometry_geojson: JSON.stringify(geometry)
      }
    ]
  });
  const rows = await readInvalidCurrentSourceGeometries(client);
  assert.deepEqual(rows, [
    {
      territoryId: "alba-iulia",
      sourceSnapshotId: "snap-1",
      sourceFeatureKey: "feature-1",
      licenseSpdx: "CC-BY-4.0",
      geometry
    }
  ]);
});

test("writeSourceCorrections inserts one source_corrected row plus an audit event, then commits", async () => {
  const client = clientMock({ isValidByCall: [true] });
  const { corrected, stillInvalid } = await writeSourceCorrections(client, [invalidRow()]);
  assert.deepEqual(corrected, ["alba-iulia"]);
  assert.deepEqual(stillInvalid, []);
  const statements = client.calls.map((call) => call.sql);
  assert.equal(statements[0], "begin");
  assert.match(statements[2], /geometry_kind, detail_level, geometry/);
  assert.match(statements[2], /'source_corrected', 'original'/);
  // Same GeoJSON round-trip and GEOMETRYCOLLECTION guards as
  // writeDerivedGeometries, applied at the actual insert boundary.
  assert.match(statements[2], /ST_MakeValid\(gis\.ST_GeomFromGeoJSON/);
  assert.match(statements[2], /ST_CollectionExtract\(gis\.ST_MakeValid\(gis\.ST_GeomFromGeoJSON.*,\s*3\)/s);
  assert.match(statements[3], /territory_geometries_source_corrected/);
  assert.equal(statements.at(-1), "commit");
  // The original 'source' row is never touched — this module only ever
  // inserts, never updates or deletes.
  assert.ok(!statements.some((sql) => /update registry\.territory_geometries/i.test(sql)));
  assert.ok(!statements.some((sql) => /delete from registry\.territory_geometries/i.test(sql)));
});

test("writeSourceCorrections defaults to the documented correction method", async () => {
  const client = clientMock({ isValidByCall: [true] });
  await writeSourceCorrections(client, [invalidRow()]);
  const insertParameters = client.calls[2].parameters;
  assert.equal(insertParameters.at(-1), SOURCE_VALIDITY_CORRECTION_METHOD);
});

test("writeSourceCorrections fails closed per row: a still-invalid correction is reported, not written", async () => {
  const client = clientMock({ isValidByCall: [false] });
  const { corrected, stillInvalid } = await writeSourceCorrections(client, [invalidRow()]);
  assert.deepEqual(corrected, []);
  assert.deepEqual(stillInvalid, ["alba-iulia"]);
  const statements = client.calls.map((call) => call.sql);
  assert.ok(!statements.some((sql) => /^insert into registry\.territory_geometries/.test(sql)));
  // The audit event still records the attempt, and the transaction commits
  // (nothing invalid was written, so there is nothing to roll back).
  assert.match(statements.at(-2), /territory_geometries_source_corrected/);
  assert.equal(statements.at(-1), "commit");
});

test("writeSourceCorrections rolls back and writes nothing durable when an insert fails", async () => {
  const client = clientMock({ isValidByCall: [true], failOn: "insert into registry.territory_geometries" });
  await assert.rejects(writeSourceCorrections(client, [invalidRow()]), {
    code: "GEOMETRY_SOURCE_CORRECTION_WRITE_FAILED"
  });
  assert.equal(client.calls.at(-1).sql, "rollback");
});
