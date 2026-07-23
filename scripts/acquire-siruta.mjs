import { readFile } from "node:fs/promises";

import { acquireSource } from "../packages/pipeline/src/acquisition/acquire.mjs";
import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";
import { loadManualSnapshot } from "../packages/pipeline/src/acquisition/manual-input.mjs";
import { validateSirutaSnapshot } from "../packages/pipeline/src/canonical/build-candidate.mjs";

const SOURCE_FILE = new URL("../config/sources/siruta-2025.json", import.meta.url);
const TRANSFORM_FILE = new URL("../config/transforms/siruta-2025.json", import.meta.url);

function usage() {
  return `Usage:
  npm run acquire:siruta -- --dry-run [--expected-sha256 <sha>] [--fail-on-observed-change]
  npm run acquire:siruta -- --archive-dir <path> [--expected-sha256 <sha>]
  npm run acquire:siruta -- --publish [--expected-sha256 <sha>]
  npm run acquire:siruta -- --publish --direct-resource
  npm run acquire:siruta -- --manual-file <path> --expected-sha256 <sha> --expected-size <bytes> --provenance-url <url> --publish

--direct-resource downloads the allowlisted official resource URL without CKAN discovery.
It is intended for the scheduled source mirror; all integrity and canonical validation gates remain active.

Publish mode requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL.`;
}

function parseArguments(args) {
  const result = { dryRun: false, publish: false, directResource: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--publish") result.publish = true;
    else if (argument === "--direct-resource") result.directResource = true;
    else if (argument === "--archive-dir") result.localArchiveDirectory = args[++index];
    else if (argument === "--expected-sha256") result.expectedSha256 = args[++index];
    else if (argument === "--expected-size") result.expectedSize = Number(args[++index]);
    else if (argument === "--manual-file") result.manualFile = args[++index];
    else if (argument === "--provenance-url") result.provenanceUrl = args[++index];
    else if (argument === "--fail-on-observed-change") result.failOnObservedChange = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  const modes = [result.dryRun, result.publish, Boolean(result.localArchiveDirectory)].filter(Boolean);
  if (!result.help && modes.length !== 1) {
    throw new Error("Choose exactly one mode: --dry-run, --archive-dir or --publish");
  }
  if (result.expectedSha256 && !/^[0-9a-f]{64}$/.test(result.expectedSha256)) {
    throw new Error("--expected-sha256 must contain 64 lowercase hexadecimal characters");
  }
  if (result.directResource && result.manualFile) {
    throw new Error("--direct-resource cannot be combined with --manual-file");
  }
  if (result.directResource && !result.publish && !result.dryRun) {
    throw new Error("--direct-resource requires --publish or --dry-run");
  }
  if (result.manualFile) {
    if (!result.publish) throw new Error("--manual-file requires --publish");
    if (!result.expectedSha256) throw new Error("--manual-file requires --expected-sha256");
    if (!Number.isSafeInteger(result.expectedSize) || result.expectedSize < 1) {
      throw new Error("--manual-file requires a positive integer --expected-size");
    }
    if (!result.provenanceUrl) throw new Error("--manual-file requires --provenance-url");
  }
  return result;
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function validationFailureSummary(error) {
  if (!error.validation) return undefined;
  const ruleCounts = {};
  for (const finding of error.validation.findings ?? []) {
    ruleCounts[finding.ruleCode] = (ruleCounts[finding.ruleCode] ?? 0) + 1;
  }
  return {
    status: error.validation.status,
    profile: error.validation.profile,
    ruleCounts
  };
}

function acquisitionFailureContext(error) {
  const phase = error?.context?.phase;
  const attempts = error?.context?.attempts;
  const maxAttempts = error?.context?.maxAttempts;
  const elapsedMs = error?.context?.elapsedMs;
  const timeoutSource = error?.context?.timeoutSource;
  const causeCode = error?.context?.causeCode;
  return {
    phase: typeof phase === "string" ? phase : undefined,
    attempts: Number.isSafeInteger(attempts) ? attempts : undefined,
    maxAttempts: Number.isSafeInteger(maxAttempts) ? maxAttempts : undefined,
    elapsedMs: Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 ? elapsedMs : undefined,
    timeoutSource:
      timeoutSource === "socket-inactivity" || timeoutSource === "request-deadline"
        ? timeoutSource
        : undefined,
    causeCode:
      typeof causeCode === "string" && /^[A-Z0-9_]{1,40}$/.test(causeCode)
        ? causeCode
        : undefined
  };
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  const source = JSON.parse(await readFile(SOURCE_FILE, "utf8"));
  const transformation = JSON.parse(await readFile(TRANSFORM_FILE, "utf8"));
  const options = {
    dryRun: args.dryRun,
    localArchiveDirectory: args.localArchiveDirectory,
    expectedSha256: args.expectedSha256,
    skipDiscovery: args.directResource,
    snapshotValidator: (bytes) => validateSirutaSnapshot(bytes, transformation)
  };
  if (args.manualFile) {
    options.providedDownload = await loadManualSnapshot(args.manualFile, source, {
      sha256: args.expectedSha256,
      sizeBytes: args.expectedSize,
      provenanceUrl: args.provenanceUrl
    });
  }
  if (args.publish) {
    options.supabaseUrl = requireEnvironment("SUPABASE_URL");
    options.serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    options.databaseUrl = requireEnvironment("SUPABASE_DB_URL");
  }

  const result = await acquireSource(source, options);
  const observed = source.observedSnapshot;
  const matchesObservedSnapshot =
    observed.sha256 === result.download.sha256 &&
    observed.sizeBytes === result.download.sizeBytes;
  const baselineChanged = args.failOnObservedChange && !matchesObservedSnapshot;
  console.log(
    JSON.stringify(
      {
        ok: !baselineChanged,
        code: baselineChanged ? "OBSERVED_SNAPSHOT_CHANGED" : undefined,
        mode: result.mode,
        acquisitionChannel: args.manualFile
          ? "manual-bootstrap"
          : args.directResource
            ? "official-direct-mirror"
            : "ckan-discovery",
        source: source.slug,
        snapshotId: result.metadata.snapshotId,
        sha256: result.download.sha256,
        sizeBytes: result.download.sizeBytes,
        detectedMediaType: result.download.detectedMediaType,
        declaredTypeMismatch: result.download.declaredTypeMismatch,
        attempts: result.download.attempts,
        validation: result.validation
          ? {
              status: result.validation.status,
              profile: result.validation.profile,
              findingCount: result.validation.findings.length
            }
          : null,
        archiveCreated: result.archiveCreated,
        snapshotCreated: result.snapshotCreated,
        changeDetected: result.mode === "publish" ? result.snapshotCreated : !matchesObservedSnapshot,
        matchesObservedSnapshot
      },
      null,
      2
    )
  );
  if (baselineChanged) process.exitCode = 2;
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error.code ?? "ACQUISITION_FAILED",
      message: safeErrorMessage(error),
      ...acquisitionFailureContext(error),
      validation: validationFailureSummary(error)
    })
  );
  process.exit(1);
}
