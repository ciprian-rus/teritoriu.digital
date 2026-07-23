import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { AcquisitionError } from "./errors.mjs";
import { assertExpectedMediaType } from "./media-type.mjs";
import { SOURCE_SNAPSHOT_BUCKET } from "./supabase-archive.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const BOOTSTRAP_OBJECT = /^bootstrap\/[a-z0-9]+(?:[._-][a-z0-9]+)*\.xlsx$/;

function clientFor(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    global: { headers: { "x-application-name": "teritoriu.digital-storage-bootstrap" } }
  });
}

function validateProvenance(value, source) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AcquisitionError("PROVENANCE_INVALID", "Storage bootstrap provenance URL is invalid");
  }
  if (
    !source.allowedProtocols.includes(url.protocol) ||
    !source.allowedHosts.includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new AcquisitionError(
      "PROVENANCE_INVALID",
      "Storage bootstrap provenance must identify an allowlisted official source"
    );
  }
  return url.href;
}

export async function loadStorageBootstrap(objectPath, source, expected, options = {}) {
  if (!BOOTSTRAP_OBJECT.test(objectPath ?? "")) {
    throw new AcquisitionError(
      "STORAGE_OBJECT_INVALID",
      "Storage bootstrap object must be an XLSX file under bootstrap/"
    );
  }
  if (!SHA256.test(expected?.sha256 ?? "")) {
    throw new AcquisitionError("SHA256_REQUIRED", "Storage bootstrap requires an exact SHA-256");
  }
  if (!Number.isSafeInteger(expected.sizeBytes) || expected.sizeBytes < 1) {
    throw new AcquisitionError(
      "SIZE_REQUIRED",
      "Storage bootstrap requires an exact positive byte size"
    );
  }
  if (expected.sizeBytes > source.maxBytes) {
    throw new AcquisitionError(
      "SIZE_LIMIT_EXCEEDED",
      "Storage bootstrap exceeds the configured source limit"
    );
  }
  const provenanceUrl = validateProvenance(expected.provenanceUrl, source);
  const supabase =
    options.client ?? clientFor(options.supabaseUrl, options.serviceRoleKey);
  const { data, error } = await supabase.storage
    .from(SOURCE_SNAPSHOT_BUCKET)
    .download(objectPath);
  if (error || !data) {
    throw new AcquisitionError(
      "STORAGE_BOOTSTRAP_DOWNLOAD_FAILED",
      "Private storage bootstrap object could not be downloaded",
      { cause: error, retryable: true }
    );
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length !== expected.sizeBytes) {
    throw new AcquisitionError(
      "SIZE_MISMATCH",
      "Storage bootstrap does not match the explicitly required byte size"
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expected.sha256) {
    throw new AcquisitionError(
      "SHA256_MISMATCH",
      "Storage bootstrap does not match the explicitly required SHA-256"
    );
  }
  const media = assertExpectedMediaType(
    bytes,
    null,
    source.expectedDetectedMediaTypes
  );
  return {
    bytes,
    requestedUrl: provenanceUrl,
    resolvedUrl: provenanceUrl,
    httpStatus: 200,
    headers: {},
    redirectChain: [],
    sizeBytes: bytes.length,
    sha256,
    ...media,
    attempts: 1,
    discovery: {
      skipped: true,
      channel: "private-storage-bootstrap",
      bucket: SOURCE_SNAPSHOT_BUCKET,
      objectPath
    }
  };
}
