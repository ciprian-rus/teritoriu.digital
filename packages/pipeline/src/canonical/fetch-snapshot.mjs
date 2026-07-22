import { createHash } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Pool } = pg;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function parseSnapshotStorageUri(value, expectedSha256) {
  let uri;
  try {
    uri = new URL(value);
  } catch {
    fail("SNAPSHOT_STORAGE_URI_INVALID", "Snapshot storage URI is invalid");
  }
  if (
    uri.protocol !== "supabase:" ||
    uri.hostname !== "source-snapshots" ||
    uri.username ||
    uri.password ||
    uri.port ||
    uri.search ||
    uri.hash
  ) {
    fail("SNAPSHOT_STORAGE_URI_INVALID", "Snapshot storage URI is outside the approved private bucket");
  }
  const objectPath = uri.pathname.replace(/^\//, "");
  const expectedSuffix = `/${expectedSha256.slice(0, 2)}/${expectedSha256}.xlsx`;
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[0-9a-f]{2}\/[0-9a-f]{64}\.xlsx$/.test(objectPath)) {
    fail("SNAPSHOT_STORAGE_URI_INVALID", "Snapshot object path does not match the content-addressed contract");
  }
  if (!objectPath.endsWith(expectedSuffix)) {
    fail("SNAPSHOT_STORAGE_HASH_MISMATCH", "Snapshot object path does not match the expected SHA-256");
  }
  return { bucket: uri.hostname, objectPath };
}

export async function fetchSnapshotForCanonicalization(snapshotId, expectedSha256, options = {}) {
  if (!UUID_V7.test(snapshotId ?? "")) throw new TypeError("snapshotId must be a lowercase UUIDv7");
  if (!SHA256.test(expectedSha256 ?? "")) throw new TypeError("expectedSha256 must be lowercase SHA-256");

  const ownedPool = options.databaseClient ? null : new Pool({ connectionString: options.connectionString });
  let databaseClient = options.databaseClient;
  try {
    databaseClient ??= await ownedPool.connect();
    const result = await databaseClient.query(
      `select
         snapshot_id::text, sha256::text, size_bytes, detected_media_type, storage_uri, status
       from registry.source_snapshots
       where snapshot_id = $1::registry.uuid_v7 and sha256 = $2::registry.sha256_hex`,
      [snapshotId, expectedSha256]
    );
    if (result.rows.length !== 1) {
      fail("SNAPSHOT_NOT_FOUND", "No archived snapshot matches both the requested ID and SHA-256");
    }
    const row = result.rows[0];
    if (!new Set(["archived", "validated"]).has(row.status)) {
      fail("SNAPSHOT_STATUS_INVALID", "Snapshot is not in an archive-ready status");
    }
    if (row.detected_media_type !== XLSX_MEDIA_TYPE) {
      fail("SNAPSHOT_MEDIA_TYPE_INVALID", "Archived snapshot is not a reviewed XLSX resource");
    }
    const expectedSize = Number(row.size_bytes);
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > 5 * 1024 * 1024) {
      fail("SNAPSHOT_SIZE_INVALID", "Archived snapshot size is outside the approved acquisition boundary");
    }
    const storage = parseSnapshotStorageUri(row.storage_uri, expectedSha256);
    const supabase = options.supabaseClient ?? createClient(options.supabaseUrl, options.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data, error } = await supabase.storage.from(storage.bucket).download(storage.objectPath);
    if (error || !data) fail("SNAPSHOT_DOWNLOAD_FAILED", "The archived snapshot could not be downloaded");
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length !== expectedSize) {
      fail("SNAPSHOT_ARCHIVE_SIZE_MISMATCH", "Downloaded archive bytes differ from registered snapshot size");
    }
    const observedSha256 = createHash("sha256").update(bytes).digest("hex");
    if (observedSha256 !== expectedSha256) {
      fail("SNAPSHOT_ARCHIVE_HASH_MISMATCH", "Downloaded archive bytes differ from registered SHA-256");
    }
    return {
      bytes,
      metadata: {
        snapshotId: row.snapshot_id,
        sha256: row.sha256,
        sizeBytes: expectedSize,
        detectedMediaType: row.detected_media_type,
        storageUri: row.storage_uri,
        status: row.status
      }
    };
  } finally {
    if (ownedPool) {
      databaseClient?.release();
      await ownedPool.end();
    }
  }
}
