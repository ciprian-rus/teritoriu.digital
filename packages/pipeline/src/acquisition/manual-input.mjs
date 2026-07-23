import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import { AcquisitionError } from "./errors.mjs";
import { assertExpectedMediaType } from "./media-type.mjs";

export async function loadManualSnapshot(filePath, source, expected) {
  if (!filePath) throw new AcquisitionError("MANUAL_FILE_REQUIRED", "Manual snapshot path is required");
  if (!expected?.sha256 || !/^[0-9a-f]{64}$/.test(expected.sha256)) {
    throw new AcquisitionError("SHA256_REQUIRED", "Manual acquisition requires an exact SHA-256");
  }
  if (!Number.isSafeInteger(expected.sizeBytes) || expected.sizeBytes < 1) {
    throw new AcquisitionError("SIZE_REQUIRED", "Manual acquisition requires an exact positive byte size");
  }
  if (!expected.provenanceUrl) {
    throw new AcquisitionError("PROVENANCE_REQUIRED", "Manual acquisition requires a provenance URL");
  }

  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) throw new AcquisitionError("MANUAL_FILE_INVALID", "Manual snapshot is not a regular file");
  if (fileStats.size !== expected.sizeBytes) {
    throw new AcquisitionError("SIZE_MISMATCH", "Manual snapshot does not match the explicitly required byte size");
  }
  if (fileStats.size > source.maxBytes) {
    throw new AcquisitionError("SIZE_LIMIT_EXCEEDED", "Manual snapshot exceeds the configured source limit");
  }

  const bytes = await readFile(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expected.sha256) {
    throw new AcquisitionError("SHA256_MISMATCH", "Manual snapshot does not match the explicitly required SHA-256");
  }
  const media = assertExpectedMediaType(bytes, null, source.expectedDetectedMediaTypes);
  return {
    bytes,
    requestedUrl: expected.provenanceUrl,
    resolvedUrl: expected.provenanceUrl,
    httpStatus: 200,
    headers: {},
    redirectChain: [],
    sizeBytes: bytes.length,
    sha256,
    ...media,
    attempts: 1,
    discovery: { skipped: true, channel: "manual-bootstrap" }
  };
}
