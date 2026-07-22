import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { AcquisitionError } from "./errors.mjs";
import { XLSX_MEDIA_TYPE } from "./media-type.mjs";
import { uuidV7 } from "./uuid-v7.mjs";

function extensionFor(mediaType) {
  if (mediaType === XLSX_MEDIA_TYPE) return "xlsx";
  if (mediaType === "text/csv") return "csv";
  if (mediaType === "application/json") return "json";
  return "bin";
}

async function writeExclusive(filePath, bytes) {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export function snapshotMetadata(source, download, options = {}) {
  const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
  const extension = extensionFor(download.detectedMediaType);
  const objectPath = `${source.slug}/${download.sha256.slice(0, 2)}/${download.sha256}.${extension}`;
  return {
    snapshotId: uuidV7(options.nowMs),
    sourceId: source.sourceId,
    sourceSlug: source.slug,
    sourceVersion: source.sourceVersion,
    retrievedAt,
    requestedUrl: download.requestedUrl,
    resolvedUrl: download.resolvedUrl,
    httpStatus: download.httpStatus,
    declaredMediaType: download.declaredMediaType,
    detectedMediaType: download.detectedMediaType,
    declaredTypeMismatch: download.declaredTypeMismatch,
    sizeBytes: download.sizeBytes,
    sha256: download.sha256,
    objectPath,
    storageUri: `supabase://source-snapshots/${objectPath}`,
    status: "downloaded",
    metadata: {
      resourceId: source.resourceId,
      datasetUrl: source.datasetUrl,
      etag: download.headers.etag ?? null,
      lastModified: download.headers["last-modified"] ?? null,
      redirectChain: download.redirectChain,
      attempts: download.attempts,
      discovery: download.discovery ?? null
    }
  };
}

export async function archiveLocally(rootDirectory, source, download, options = {}) {
  const metadata = snapshotMetadata(source, download, options);
  if (options.dryRun) {
    return { created: false, dryRun: true, metadata };
  }

  const objectFile = path.join(rootDirectory, metadata.objectPath);
  const metadataFile = `${objectFile}.metadata.json`;
  await mkdir(path.dirname(objectFile), { recursive: true });

  let created = false;
  try {
    await writeExclusive(objectFile, download.bytes);
    created = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(objectFile);
    const existingHash = createHash("sha256").update(existing).digest("hex");
    if (existingHash !== download.sha256) {
      throw new AcquisitionError(
        "ARCHIVE_COLLISION",
        "Existing snapshot path has different content"
      );
    }
  }

  if (created) {
    await writeJsonAtomically(metadataFile, metadata);
  } else {
    try {
      const existingMetadata = JSON.parse(await readFile(metadataFile, "utf8"));
      metadata.snapshotId = existingMetadata.snapshotId;
      metadata.retrievedAt = existingMetadata.retrievedAt;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeJsonAtomically(metadataFile, metadata);
    }
  }

  const fileStats = await stat(objectFile);
  if (fileStats.size !== download.sizeBytes) {
    throw new AcquisitionError("ARCHIVE_SIZE_MISMATCH", "Archived snapshot size changed unexpectedly");
  }
  return { created, dryRun: false, metadata, objectFile, metadataFile };
}
