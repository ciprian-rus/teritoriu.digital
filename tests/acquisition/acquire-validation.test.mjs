import test from "node:test";
import assert from "node:assert/strict";

import { acquireSource } from "../../packages/pipeline/src/acquisition/acquire.mjs";
import { AcquisitionError } from "../../packages/pipeline/src/acquisition/errors.mjs";

const bytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("fixture/[Content_Types].xml/fixture/xl/workbook.xml/content")
]);

const source = {
  sourceId: "01983d9c-4b00-7abc-8def-1234567890ab",
  sourceVersion: "2025",
  slug: "ro.ins.siruta",
  datasetUrl: "https://data.gov.ro/dataset/siruta_an-2025",
  resourceId: "resource-id",
  resourceUrl: "https://data.gov.ro/source.csv",
  allowedHosts: ["data.gov.ro"],
  allowedProtocols: ["https:"],
  allowedPorts: [443],
  expectedDetectedMediaTypes: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ],
  maxBytes: 1024,
  timeoutMs: 1000,
  maxAttempts: 1,
  maxRedirects: 1
};

const dependencies = {
  resolver: async () => [{ address: "93.184.216.34", family: 4 }],
  sleep: async () => {},
  transport: async () => ({
    status: 200,
    headers: { "content-type": "text/csv" },
    body: bytes
  })
};

test("returns canonical validation evidence with a dry-run", async () => {
  const validation = {
    status: "passed",
    profile: { totalRows: 16978 },
    findings: [{ ruleCode: "KNOWN_WARNING" }]
  };
  const result = await acquireSource(source, {
    skipDiscovery: true,
    dryRun: true,
    dependencies,
    snapshotValidator: async (observedBytes) => {
      assert.deepEqual(observedBytes, bytes);
      return validation;
    }
  });
  assert.equal(result.mode, "dry-run");
  assert.deepEqual(result.validation, validation);
});

test("blocks before archive or metadata writes when canonical validation fails", async () => {
  await assert.rejects(
    acquireSource(source, {
      skipDiscovery: true,
      dryRun: true,
      dependencies,
      snapshotValidator: async () => ({ status: "blocked", findings: [] })
    }),
    (error) => {
      assert.equal(error.code, "SNAPSHOT_VALIDATION_BLOCKED");
      assert.equal(error.context.phase, "canonical-validation");
      return true;
    }
  );
});

test("labels a terminal download failure with its phase and attempt count", async () => {
  await assert.rejects(
    acquireSource(source, {
      skipDiscovery: true,
      dryRun: true,
      dependencies: {
        ...dependencies,
        transport: async () => {
          throw new AcquisitionError("TIMEOUT", "fixture timeout", { retryable: true });
        }
      }
    }),
    (error) => {
      assert.equal(error.code, "TIMEOUT");
      assert.equal(error.context.phase, "snapshot-download");
      assert.equal(error.context.attempts, 1);
      assert.equal(error.context.maxAttempts, 1);
      return true;
    }
  );
});
