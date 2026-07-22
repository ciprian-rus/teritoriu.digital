import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

import { uuidV7 } from "../packages/pipeline/src/acquisition/uuid-v7.mjs";
import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";
import { buildSirutaCandidate } from "../packages/pipeline/src/canonical/build-candidate.mjs";
import {
  loadSirutaIdentityIndex,
  stageSirutaImport
} from "../packages/pipeline/src/canonical/postgres-staging.mjs";

const { Pool } = pg;
const TRANSFORM_FILE = new URL("../config/transforms/siruta-2025.json", import.meta.url);
const RECONCILIATION_LOCK = "teritoriu.digital:ro.ins.siruta:identity-reconciliation";

function usage() {
  return `Usage:
  npm run candidate:siruta -- --input <snapshot.xlsx> --snapshot-id <uuidv7> \\
    --snapshot-sha256 <sha256> [--identity-ledger <ledger.json>] \\
    [--previous-candidate <candidate.json>] [--output-dir <path>]

  Add --stage --pipeline-commit <40-char-sha> to persist staging evidence.
  Stage mode requires SUPABASE_DB_URL and never promotes canonical territories.`;
}

function parseArguments(args) {
  const result = { stage: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") result.input = args[++index];
    else if (argument === "--snapshot-id") result.snapshotId = args[++index];
    else if (argument === "--snapshot-sha256") result.snapshotSha256 = args[++index];
    else if (argument === "--identity-ledger") result.identityLedger = args[++index];
    else if (argument === "--previous-candidate") result.previousCandidate = args[++index];
    else if (argument === "--output-dir") result.outputDirectory = args[++index];
    else if (argument === "--pipeline-commit") result.pipelineCommit = args[++index];
    else if (argument === "--stage") result.stage = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (result.help) return result;
  for (const field of ["input", "snapshotId", "snapshotSha256"]) {
    if (!result[field]) throw new Error(`Missing required argument: --${field.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  if (!/^[0-9a-f]{64}$/.test(result.snapshotSha256)) {
    throw new Error("--snapshot-sha256 must contain 64 lowercase hexadecimal characters");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result.snapshotId)) {
    throw new Error("--snapshot-id must be a lowercase UUIDv7");
  }
  if (result.stage && !/^[0-9a-f]{40}$/.test(result.pipelineCommit ?? "")) {
    throw new Error("Stage mode requires --pipeline-commit with a 40-character lowercase SHA");
  }
  return result;
}

async function optionalJson(filePath, fallback) {
  return filePath ? JSON.parse(await readFile(filePath, "utf8")) : fallback;
}

async function writeOnce(filePath, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing !== content) throw new Error(`Existing artifact differs: ${filePath}`);
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

let pool;
let client;
let reconciliationLockHeld = false;
try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  const configuration = JSON.parse(await readFile(TRANSFORM_FILE, "utf8"));
  const bytes = await readFile(args.input);
  const observedHash = createHash("sha256").update(bytes).digest("hex");
  if (observedHash !== args.snapshotSha256) throw new Error("Input bytes do not match --snapshot-sha256");

  const identityLedger = await optionalJson(args.identityLedger, {});
  const previousCandidate = await optionalJson(args.previousCandidate, null);
  let existingIdentityIndex;
  if (args.stage) {
    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) throw new Error("Missing required environment variable: SUPABASE_DB_URL");
    pool = new Pool({ connectionString });
    client = await pool.connect();
    await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [RECONCILIATION_LOCK]);
    reconciliationLockHeld = true;
    existingIdentityIndex = await loadSirutaIdentityIndex(client);
  }

  const result = await buildSirutaCandidate(bytes, configuration, {
    sourceSnapshotId: args.snapshotId,
    sourceSha256: args.snapshotSha256,
    identityLedger,
    existingIdentityIndex,
    previousCandidate
  });
  const outputDirectory = args.outputDirectory ?? path.join(
    ".artifacts",
    "candidates",
    args.snapshotSha256,
    configuration.transformationVersion
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeOnce(path.join(outputDirectory, "staging.json"), result.stagingRecords);
  await writeOnce(path.join(outputDirectory, "validation-report.json"), {
    status: result.status,
    summary: result.summary,
    findings: result.findings
  });
  await writeOnce(path.join(outputDirectory, "identity-decisions.json"), result.decisions);
  await writeOnce(path.join(outputDirectory, "identity-ledger.json"), result.identityLedger);
  await writeOnce(path.join(outputDirectory, "diff.json"), result.diff);
  if (result.candidate) await writeOnce(path.join(outputDirectory, "candidate.json"), result.candidate);

  let staging = null;
  if (args.stage) {
    const importRunId = uuidV7();
    const idempotencyKey = createHash("sha256")
      .update(`${args.snapshotSha256}:${configuration.transformationVersion}`)
      .digest("hex");
    staging = await stageSirutaImport(
      {
        importRunId,
        snapshotId: args.snapshotId,
        idempotencyKey,
        pipelineCommit: args.pipelineCommit,
        parserVersion: configuration.transformationVersion,
        dryRun: true
      },
      result,
      { client }
    );
  }

  console.log(JSON.stringify({
    ok: result.status === "passed",
    status: result.status,
    summary: result.summary,
    outputDirectory,
    staging
  }, null, 2));
  if (result.status !== "passed") process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code ?? "CANDIDATE_BUILD_FAILED",
    message: safeErrorMessage(error)
  }));
  process.exitCode = 1;
} finally {
  if (reconciliationLockHeld) {
    await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [RECONCILIATION_LOCK]).catch(() => {});
  }
  client?.release();
  await pool?.end();
}
