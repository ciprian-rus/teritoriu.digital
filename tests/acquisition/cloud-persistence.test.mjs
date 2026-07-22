import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { registerSnapshot } from "../../packages/pipeline/src/acquisition/postgres-metadata.mjs";
import { archiveInSupabase } from "../../packages/pipeline/src/acquisition/supabase-archive.mjs";

const bytes = Buffer.from("snapshot bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const source = {
  sourceId: "01983d9c-4b00-7abc-8def-1234567890ab",
  slug: "ro.ins.siruta",
  publisher: "Institutul Național de Statistică",
  title: "SIRUTA_an 2025",
  datasetUrl: "https://data.gov.ro/dataset/siruta_an-2025",
  authorityRole: "authoritative",
  licenseSpdx: "CC-BY-4.0",
  expectedFrequency: "semiannual",
  resourceId: "resource-id"
};
const metadata = {
  snapshotId: "01983d9d-4b00-7abc-8def-1234567890ab",
  sourceVersion: "2025",
  retrievedAt: "2026-07-22T12:00:00.000Z",
  requestedUrl: "https://data.gov.ro/source.csv",
  resolvedUrl: "https://data.gov.ro/source.csv",
  httpStatus: 200,
  declaredMediaType: "text/csv",
  detectedMediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  sizeBytes: bytes.length,
  sha256,
  objectPath: `ro.ins.siruta/${sha256.slice(0, 2)}/${sha256}.xlsx`,
  storageUri: `supabase://source-snapshots/ro.ins.siruta/${sha256.slice(0, 2)}/${sha256}.xlsx`,
  metadata: { attempts: 1 }
};

function supabaseMock({ duplicate = false, existingBytes = bytes } = {}) {
  const bucket = {
    upload: async () =>
      duplicate ? { error: { statusCode: 409 } } : { data: { path: metadata.objectPath }, error: null },
    download: async () => ({ data: new Blob([existingBytes]), error: null })
  };
  return { storage: { from: () => bucket } };
}

test("uploads a content-addressed snapshot without upsert", async () => {
  const result = await archiveInSupabase(metadata, bytes, { client: supabaseMock() });
  assert.equal(result.created, true);
  assert.equal(result.objectPath, metadata.objectPath);
});

test("verifies bytes before accepting a duplicate object", async () => {
  const duplicate = await archiveInSupabase(metadata, bytes, {
    client: supabaseMock({ duplicate: true })
  });
  assert.equal(duplicate.created, false);

  await assert.rejects(
    archiveInSupabase(metadata, bytes, {
      client: supabaseMock({ duplicate: true, existingBytes: Buffer.from("different") })
    }),
    { code: "ARCHIVE_COLLISION" }
  );
});

function databaseClient({ duplicate = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql.includes("insert into registry.data_sources")) {
        return { rows: [{ source_id: source.sourceId }] };
      }
      if (sql.includes("insert into registry.source_snapshots")) {
        return duplicate
          ? { rows: [] }
          : {
              rows: [
                {
                  snapshot_id: metadata.snapshotId,
                  size_bytes: metadata.sizeBytes,
                  detected_media_type: metadata.detectedMediaType,
                  storage_uri: metadata.storageUri
                }
              ]
            };
      }
      if (sql.includes("from registry.source_snapshots")) {
        return {
          rows: [
            {
              snapshot_id: metadata.snapshotId,
              size_bytes: metadata.sizeBytes,
              detected_media_type: metadata.detectedMediaType,
              storage_uri: metadata.storageUri
            }
          ]
        };
      }
      return { rows: [] };
    }
  };
}

test("registers metadata transactionally and treats the unique hash as idempotency key", async () => {
  const firstClient = databaseClient();
  const first = await registerSnapshot(source, metadata, { client: firstClient });
  assert.equal(first.created, true);
  assert.ok(firstClient.queries.some((query) => query === "commit"));

  const duplicateClient = databaseClient({ duplicate: true });
  const duplicate = await registerSnapshot(source, metadata, { client: duplicateClient });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.snapshotId, metadata.snapshotId);
});
