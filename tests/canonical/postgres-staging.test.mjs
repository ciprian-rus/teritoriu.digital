import test from "node:test";
import assert from "node:assert/strict";

import {
  loadSirutaIdentityIndex,
  stageSirutaImport
} from "../../packages/pipeline/src/canonical/postgres-staging.mjs";
import { buildSirutaCandidateFromParsed } from "../../packages/pipeline/src/canonical/build-candidate.mjs";
import {
  CONFIGURATION,
  SNAPSHOT_ID,
  SOURCE_SHA256,
  parsedFixture,
  uuidSequence
} from "./fixture.mjs";

const IMPORT_RUN_ID = "018f0000-0000-7000-8000-0000000000cc";

function buildResult() {
  return buildSirutaCandidateFromParsed(parsedFixture(), CONFIGURATION, {
    sourceSnapshotId: SNAPSHOT_ID,
    sourceSha256: SOURCE_SHA256,
    uuidFactory: uuidSequence()
  });
}

function metadata() {
  return {
    importRunId: IMPORT_RUN_ID,
    snapshotId: SNAPSHOT_ID,
    idempotencyKey: "c".repeat(64),
    pipelineCommit: "d".repeat(40),
    parserVersion: CONFIGURATION.transformationVersion,
    dryRun: true
  };
}

function clientMock(options = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (options.failOn && sql.includes(options.failOn)) throw new Error("database failure");
      if (sql.includes("where idempotency_key = $1")) {
        return options.existing
          ? { rows: [{ import_run_id: IMPORT_RUN_ID, status: "review" }] }
          : { rows: [] };
      }
      return { rows: [] };
    }
  };
}

test("loads active identifiers and pending proposals into the reconciliation index", async () => {
  const client = {
    async query() {
      return {
        rows: [
          { value: "1", territory_id: "id-active", status: "active", valid_to: null, origin: "identifier" },
          { value: "2", territory_id: "id-proposed", status: "proposed", valid_to: null, origin: "proposal" }
        ]
      };
    }
  };
  const index = await loadSirutaIdentityIndex(client);
  assert.equal(index["1"][0].territoryId, "id-active");
  assert.equal(index["2"][0].origin, "proposal");
});

test("stages raw rows, findings and identity decisions in one transaction without promotion", async () => {
  const client = clientMock();
  const result = await stageSirutaImport(metadata(), buildResult(), {
    client,
    uuidFactory: uuidSequence(100)
  });
  assert.deepEqual(result, { created: true, importRunId: IMPORT_RUN_ID, status: "review" });
  assert.equal(client.calls[0].sql, "begin");
  assert.equal(client.calls.at(-1).sql, "commit");
  assert.ok(client.calls.some(({ sql }) => sql.includes("insert into registry.staging_records")));
  assert.ok(client.calls.some(({ sql }) => sql.includes("insert into registry.validation_findings")));
  assert.ok(client.calls.some(({ sql }) => sql.includes("insert into registry.identity_decisions")));
  assert.equal(client.calls.some(({ sql }) => sql.includes("insert into registry.territories")), false);
});

test("returns the existing import for the same idempotency key", async () => {
  const client = clientMock({ existing: true });
  const result = await stageSirutaImport(metadata(), buildResult(), { client });
  assert.deepEqual(result, { created: false, importRunId: IMPORT_RUN_ID, status: "review" });
  assert.equal(client.calls.some(({ sql }) => sql.includes("staging_records")), false);
  assert.equal(client.calls.at(-1).sql, "commit");
});

test("rolls back the entire staging transaction on a persistence error", async () => {
  const client = clientMock({ failOn: "insert into registry.staging_records" });
  await assert.rejects(
    stageSirutaImport(metadata(), buildResult(), { client, uuidFactory: uuidSequence(100) }),
    /database failure/
  );
  assert.equal(client.calls.at(-1).sql, "rollback");
});
