import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";
import { fetchSnapshotForCanonicalization } from "../packages/pipeline/src/canonical/fetch-snapshot.mjs";

function usage() {
  return `Usage:
  npm run fetch:siruta -- --snapshot-id <uuidv7> --snapshot-sha256 <sha256> --output <path>

Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL.`;
}

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--snapshot-id") result.snapshotId = args[++index];
    else if (argument === "--snapshot-sha256") result.snapshotSha256 = args[++index];
    else if (argument === "--output") result.output = args[++index];
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.help && (!result.snapshotId || !result.snapshotSha256 || !result.output)) {
    throw new Error("--snapshot-id, --snapshot-sha256 and --output are required");
  }
  return result;
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function writeVerified(filePath, bytes, expectedSha256) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const existing = await readFile(filePath);
    const hash = createHash("sha256").update(existing).digest("hex");
    if (hash !== expectedSha256) throw new Error("Existing output file has different bytes");
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  const result = await fetchSnapshotForCanonicalization(args.snapshotId, args.snapshotSha256, {
    supabaseUrl: requireEnvironment("SUPABASE_URL"),
    serviceRoleKey: requireEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    connectionString: requireEnvironment("SUPABASE_DB_URL")
  });
  const created = await writeVerified(args.output, result.bytes, args.snapshotSha256);
  console.log(JSON.stringify({ ok: true, created, output: args.output, ...result.metadata }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code ?? "SNAPSHOT_FETCH_FAILED",
    message: safeErrorMessage(error)
  }));
  process.exit(1);
}
