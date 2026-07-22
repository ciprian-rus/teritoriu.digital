import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { AcquisitionError } from "./errors.mjs";

const BUCKET = "source-snapshots";

function clientFor(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "x-application-name": "teritoriu.digital-source-acquisition" } }
  });
}

async function verifyExistingObject(bucket, objectPath, expectedSha256, expectedSize) {
  const { data, error } = await bucket.download(objectPath);
  if (error) {
    throw new AcquisitionError(
      "ARCHIVE_VERIFY_FAILED",
      "Existing snapshot object could not be verified",
      { cause: error, retryable: true }
    );
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedSha256 || bytes.length !== expectedSize) {
    throw new AcquisitionError(
      "ARCHIVE_COLLISION",
      "Existing snapshot object does not match its content-addressed path"
    );
  }
}

export async function archiveInSupabase(metadata, bytes, options) {
  const supabase = options.client ?? clientFor(options.supabaseUrl, options.serviceRoleKey);
  const bucket = supabase.storage.from(BUCKET);
  const { error } = await bucket.upload(metadata.objectPath, bytes, {
    cacheControl: "31536000",
    contentType: metadata.detectedMediaType,
    upsert: false
  });

  if (!error) {
    await verifyExistingObject(bucket, metadata.objectPath, metadata.sha256, metadata.sizeBytes);
    return { created: true, bucket: BUCKET, objectPath: metadata.objectPath };
  }

  const statusCode = Number(error.statusCode ?? error.status ?? 0);
  if (statusCode !== 409) {
    throw new AcquisitionError("ARCHIVE_UPLOAD_FAILED", "Snapshot upload failed", {
      cause: error,
      retryable: statusCode === 0 || statusCode >= 500
    });
  }

  await verifyExistingObject(bucket, metadata.objectPath, metadata.sha256, metadata.sizeBytes);
  return { created: false, bucket: BUCKET, objectPath: metadata.objectPath };
}

export { BUCKET as SOURCE_SNAPSHOT_BUCKET };
