import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  fetchSnapshotForCanonicalization,
  parseSnapshotStorageUri
} from "../../packages/pipeline/src/canonical/fetch-snapshot.mjs";

const bytes = Buffer.from("reviewed snapshot bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const snapshotId = "018f0000-0000-7000-8000-0000000000aa";
const storageUri = `supabase://source-snapshots/ro.ins.siruta/${sha256.slice(0, 2)}/${sha256}.xlsx`;

function databaseClient() {
  return {
    async query(_sql, parameters) {
      assert.deepEqual(parameters, [snapshotId, sha256]);
      return {
        rows: [{
          snapshot_id: snapshotId,
          sha256,
          size_bytes: bytes.length,
          detected_media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          storage_uri: storageUri,
          status: "archived"
        }]
      };
    }
  };
}

function supabaseClient(downloadedBytes = bytes) {
  return {
    storage: {
      from(bucket) {
        assert.equal(bucket, "source-snapshots");
        return {
          async download(objectPath) {
            assert.equal(objectPath, `ro.ins.siruta/${sha256.slice(0, 2)}/${sha256}.xlsx`);
            return { data: new Blob([downloadedBytes]), error: null };
          }
        };
      }
    }
  };
}

test("parses only content-addressed URIs from the private snapshot bucket", () => {
  assert.deepEqual(parseSnapshotStorageUri(storageUri, sha256), {
    bucket: "source-snapshots",
    objectPath: `ro.ins.siruta/${sha256.slice(0, 2)}/${sha256}.xlsx`
  });
  assert.throws(
    () => parseSnapshotStorageUri(`supabase://public/ro.ins.siruta/aa/${sha256}.xlsx`, sha256),
    { code: "SNAPSHOT_STORAGE_URI_INVALID" }
  );
});

test("downloads and reverifies the exact registered snapshot", async () => {
  const result = await fetchSnapshotForCanonicalization(snapshotId, sha256, {
    databaseClient: databaseClient(),
    supabaseClient: supabaseClient()
  });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.metadata.sha256, sha256);
});

test("rejects changed archive bytes before canonicalization", async () => {
  await assert.rejects(
    fetchSnapshotForCanonicalization(snapshotId, sha256, {
      databaseClient: databaseClient(),
      supabaseClient: supabaseClient(Buffer.from("short"))
    }),
    { code: "SNAPSHOT_ARCHIVE_SIZE_MISMATCH" }
  );
  const sameLength = Buffer.from(bytes);
  sameLength[0] ^= 0xff;
  await assert.rejects(
    fetchSnapshotForCanonicalization(snapshotId, sha256, {
      databaseClient: databaseClient(),
      supabaseClient: supabaseClient(sameLength)
    }),
    { code: "SNAPSHOT_ARCHIVE_HASH_MISMATCH" }
  );
});
