import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";
import { readReleaseBundle } from "../packages/pipeline/src/release/bundle-files.mjs";
import { promoteSirutaRelease } from "../packages/pipeline/src/release/postgres-release.mjs";

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--import-run-id") result.importRunId = args[++index];
    else if (argument === "--bundle-dir") result.bundleDirectory = args[++index];
    else if (argument === "--actor") result.actor = args[++index];
    else if (argument === "--rationale") result.rationale = args[++index];
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const field of ["importRunId", "bundleDirectory", "actor", "rationale"]) {
    if (!result.help && !result[field]) throw new Error(`Missing required argument: --${field.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return result;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log("Promote a verified, already-published SIRUTA release bundle. Requires SUPABASE_DB_URL.");
    process.exit(0);
  }
  if (!process.env.SUPABASE_DB_URL) throw new Error("Missing required environment variable: SUPABASE_DB_URL");
  const bundle = await readReleaseBundle(args.bundleDirectory);
  const payload = JSON.parse(bundle.artifacts.get("territories.json").toString("utf8"));
  const candidate = {
    schemaVersion: payload.schemaVersion,
    transformationVersion: payload.transformationVersion,
    sourceSnapshotId: payload.sourceSnapshotId,
    sourceSha256: payload.sourceSha256,
    territories: payload.territories
  };
  if (bundle.manifest.approval.importRunId !== args.importRunId) {
    throw new Error("Bundle approval does not match --import-run-id");
  }
  const result = await promoteSirutaRelease({
    importRunId: args.importRunId,
    actor: args.actor,
    rationale: args.rationale,
    candidate,
    manifest: bundle.manifest,
    manifestSha256: bundle.manifestSha256,
    bundleArtifacts: bundle.artifacts
  }, { connectionString: process.env.SUPABASE_DB_URL });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code ?? "RELEASE_PROMOTION_FAILED",
    message: safeErrorMessage(error)
  }));
  process.exit(1);
}
