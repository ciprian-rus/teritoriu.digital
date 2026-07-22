import { readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";
import { buildSirutaCandidate } from "../packages/pipeline/src/canonical/build-candidate.mjs";
import { fetchSnapshotForCanonicalization } from "../packages/pipeline/src/canonical/fetch-snapshot.mjs";
import { loadSirutaIdentityIndex } from "../packages/pipeline/src/canonical/postgres-staging.mjs";
import { buildReleaseBundle } from "../packages/pipeline/src/release/artifact-builder.mjs";
import { writeReleaseBundle } from "../packages/pipeline/src/release/bundle-files.mjs";
import { loadApprovedSirutaContext } from "../packages/pipeline/src/release/postgres-release.mjs";

const { Pool } = pg;
const TRANSFORM_FILE = new URL("../config/transforms/siruta-2025.json", import.meta.url);
const RECONCILIATION_LOCK = "teritoriu.digital:ro.ins.siruta:identity-reconciliation";

function parseArguments(args) {
  const result = { previousReleaseId: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--import-run-id") result.importRunId = args[++index];
    else if (argument === "--release-id") result.releaseId = args[++index];
    else if (argument === "--published-at") result.publishedAt = args[++index];
    else if (argument === "--pipeline-commit") result.pipelineCommit = args[++index];
    else if (argument === "--repository") result.repository = args[++index];
    else if (argument === "--output-dir") result.outputDirectory = args[++index];
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const field of ["importRunId", "releaseId", "publishedAt", "pipelineCommit", "repository"]) {
    if (!result.help && !result[field]) throw new Error(`Missing required argument: --${field.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return result;
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let pool;
let client;
let lockHeld = false;
try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log("Rebuild an approved SIRUTA candidate and prepare a deterministic release bundle.");
    process.exit(0);
  }
  const connectionString = requireEnvironment("SUPABASE_DB_URL");
  pool = new Pool({ connectionString });
  client = await pool.connect();
  await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [RECONCILIATION_LOCK]);
  lockHeld = true;
  const context = await loadApprovedSirutaContext(client, args.importRunId);
  if (context.importStatus !== "approved") throw new Error("The import run has already been released");
  if (context.pipelineCommit !== args.pipelineCommit) {
    throw new Error("The requested pipeline commit differs from the approved canonicalization run");
  }
  const stable = await client.query("select release_id from registry.release_channels where channel = 'stable'");
  if (stable.rows.length > 0) {
    throw new Error("M3 prepares the first stable release only; subsequent historical releases require M7");
  }
  const snapshot = await fetchSnapshotForCanonicalization(context.snapshotId, context.source.sha256, {
    databaseClient: client,
    supabaseUrl: requireEnvironment("SUPABASE_URL"),
    serviceRoleKey: requireEnvironment("SUPABASE_SERVICE_ROLE_KEY")
  });
  const configuration = JSON.parse(await readFile(TRANSFORM_FILE, "utf8"));
  const existingIdentityIndex = await loadSirutaIdentityIndex(client);
  const result = await buildSirutaCandidate(snapshot.bytes, configuration, {
    sourceSnapshotId: context.snapshotId,
    sourceSha256: context.source.sha256,
    existingIdentityIndex,
    previousCandidate: null
  });
  if (result.status !== "passed" || !result.candidate) throw new Error("The approved snapshot no longer builds a passing candidate");
  if (result.summary.candidateSha256 !== context.candidateSha256) {
    throw new Error("Rebuilt candidate bytes differ from the immutable approval");
  }
  const validationReport = {
    status: result.status,
    summary: result.summary,
    findings: result.findings
  };
  const bundle = buildReleaseBundle({
    candidate: result.candidate,
    validationReport,
    diff: result.diff,
    metadata: {
      releaseId: args.releaseId,
      publishedAt: args.publishedAt,
      previousReleaseId: null,
      pipelineCommit: args.pipelineCommit,
      repository: args.repository,
      approval: context.approval,
      source: context.source
    }
  });
  const outputDirectory = args.outputDirectory ?? path.join(".artifacts", "releases", args.releaseId);
  const writeResult = await writeReleaseBundle(outputDirectory, bundle);
  console.log(JSON.stringify({
    ok: true,
    releaseId: args.releaseId,
    releaseTag: bundle.releaseTag,
    manifestSha256: bundle.manifestSha256,
    candidateSha256: context.candidateSha256,
    outputDirectory,
    ...writeResult
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code ?? "RELEASE_PREPARATION_FAILED",
    message: safeErrorMessage(error)
  }));
  process.exitCode = 1;
} finally {
  if (lockHeld) await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [RECONCILIATION_LOCK]).catch(() => {});
  client?.release();
  await pool?.end();
}
