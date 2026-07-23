import { archiveLocally, snapshotMetadata } from "./archive.mjs";
import { discoverCkanResource } from "./ckan-discovery.mjs";
import { downloadSnapshot } from "./downloader.mjs";
import { registerSnapshot } from "./postgres-metadata.mjs";
import { archiveInSupabase } from "./supabase-archive.mjs";

function withPhase(error, phase) {
  if (error && typeof error === "object") {
    error.context = { ...(error.context ?? {}), phase };
  }
  return error;
}

export async function acquireSource(source, options = {}) {
  let download;
  if (options.providedDownload) {
    download = options.providedDownload;
  } else {
    let discovery;
    try {
      discovery = options.skipDiscovery
        ? { resourceUrl: source.resourceUrl, skipped: true }
        : await discoverCkanResource(source, options.dependencies);
    } catch (error) {
      throw withPhase(error, "ckan-discovery");
    }
    try {
      download = await downloadSnapshot(
        { ...source, resourceUrl: discovery.resourceUrl },
        options.dependencies
      );
    } catch (error) {
      throw withPhase(error, "snapshot-download");
    }
    download.discovery = discovery;
  }

  if (options.expectedSha256 && download.sha256 !== options.expectedSha256) {
    const error = new Error("Downloaded snapshot does not match the explicitly required SHA-256");
    error.code = "SHA256_MISMATCH";
    error.context = { phase: "snapshot-integrity" };
    throw error;
  }

  let validation;
  try {
    validation = options.snapshotValidator
      ? await options.snapshotValidator(download.bytes)
      : null;
  } catch (error) {
    throw withPhase(error, "canonical-validation");
  }
  if (validation?.status === "blocked") {
    const error = new Error("The downloaded snapshot failed blocking canonical validations");
    error.code = "SNAPSHOT_VALIDATION_BLOCKED";
    error.context = { phase: "canonical-validation" };
    error.validation = validation;
    throw error;
  }

  if (options.localArchiveDirectory) {
    const local = await archiveLocally(
      options.localArchiveDirectory,
      source,
      download,
      { dryRun: options.dryRun }
    );
    return {
      mode: options.dryRun ? "dry-run" : "local",
      download,
      metadata: local.metadata,
      validation,
      archiveCreated: local.created,
      snapshotCreated: false
    };
  }

  const metadata = snapshotMetadata(source, download);
  if (options.dryRun) {
    return {
      mode: "dry-run",
      download,
      metadata,
      validation,
      archiveCreated: false,
      snapshotCreated: false
    };
  }

  const archive = await archiveInSupabase(metadata, download.bytes, {
    supabaseUrl: options.supabaseUrl,
    serviceRoleKey: options.serviceRoleKey,
    client: options.supabaseClient
  });
  const registration = await registerSnapshot(source, metadata, {
    connectionString: options.databaseUrl,
    client: options.databaseClient
  });

  return {
    mode: "publish",
    download,
    metadata: { ...metadata, snapshotId: registration.snapshotId },
    validation,
    archiveCreated: archive.created,
    snapshotCreated: registration.created
  };
}
