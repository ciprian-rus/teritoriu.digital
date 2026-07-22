import { readFile } from "node:fs/promises";

import { acquireSource } from "../packages/pipeline/src/acquisition/acquire.mjs";
import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";

const SOURCE_FILE = new URL("../config/sources/siruta-2025.json", import.meta.url);

function usage() {
  return `Usage:
  npm run acquire:siruta -- --dry-run [--expected-sha256 <sha>]
  npm run acquire:siruta -- --archive-dir <path> [--expected-sha256 <sha>]
  npm run acquire:siruta -- --publish [--expected-sha256 <sha>]

Publish mode requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL.`;
}

function parseArguments(args) {
  const result = { dryRun: false, publish: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--publish") result.publish = true;
    else if (argument === "--archive-dir") result.localArchiveDirectory = args[++index];
    else if (argument === "--expected-sha256") result.expectedSha256 = args[++index];
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
  return result;
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  const source = JSON.parse(await readFile(SOURCE_FILE, "utf8"));
  const options = {
    dryRun: args.dryRun,
    localArchiveDirectory: args.localArchiveDirectory,
    expectedSha256: args.expectedSha256
  };
  if (args.publish) {
    options.supabaseUrl = requireEnvironment("SUPABASE_URL");
    options.serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    options.databaseUrl = requireEnvironment("SUPABASE_DB_URL");
  }

  const result = await acquireSource(source, options);
  const observed = source.observedSnapshot;
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: result.mode,
        source: source.slug,
        snapshotId: result.metadata.snapshotId,
        sha256: result.download.sha256,
        sizeBytes: result.download.sizeBytes,
        detectedMediaType: result.download.detectedMediaType,
        declaredTypeMismatch: result.download.declaredTypeMismatch,
        attempts: result.download.attempts,
        archiveCreated: result.archiveCreated,
        snapshotCreated: result.snapshotCreated,
        matchesObservedSnapshot:
          observed.sha256 === result.download.sha256 &&
          observed.sizeBytes === result.download.sizeBytes
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error.code ?? "ACQUISITION_FAILED",
      message: safeErrorMessage(error)
    })
  );
  process.exit(1);
}
