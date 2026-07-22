import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { archiveLocally } from "../../packages/pipeline/src/acquisition/archive.mjs";

const bytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("[Content_Types].xml/xl/workbook.xml")
]);

const source = {
  sourceId: "01983d9c-4b00-7abc-8def-1234567890ab",
  sourceVersion: "2025",
  slug: "ro.ins.siruta",
  datasetUrl: "https://data.gov.ro/dataset/siruta_an-2025",
  resourceId: "resource-id"
};

const download = {
  bytes,
  requestedUrl: "https://data.gov.ro/source.csv",
  resolvedUrl: "https://data.gov.ro/source.csv",
  httpStatus: 200,
  declaredMediaType: "text/csv",
  detectedMediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  declaredTypeMismatch: true,
  sizeBytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  headers: {},
  redirectChain: [],
  attempts: 1
};

test("archives exact bytes once and reuses the persistent snapshot ID", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "teritoriu-snapshot-"));
  context.after(() => rm(directory, { recursive: true, force: true }));

  const first = await archiveLocally(directory, source, download);
  const second = await archiveLocally(directory, source, download);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.metadata.snapshotId, first.metadata.snapshotId);
  assert.deepEqual(await readFile(first.objectFile), bytes);
  assert.match(first.metadata.snapshotId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("dry-run computes metadata without creating archive files", async () => {
  const result = await archiveLocally("/path/not-used", source, download, { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.created, false);
  assert.equal(result.metadata.sha256, download.sha256);
});
