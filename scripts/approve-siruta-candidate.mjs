import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";
import { approveSirutaCandidate } from "../packages/pipeline/src/release/postgres-release.mjs";

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--import-run-id") result.importRunId = args[++index];
    else if (argument === "--candidate-sha256") result.candidateSha256 = args[++index];
    else if (argument === "--actor") result.actor = args[++index];
    else if (argument === "--rationale") result.rationale = args[++index];
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.help && Object.values(result).some((value) => !value)) {
    throw new Error("--import-run-id, --candidate-sha256, --actor and --rationale are required");
  }
  return result;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log("Approve an exact staged SIRUTA candidate. Requires SUPABASE_DB_URL.");
    process.exit(0);
  }
  if (!process.env.SUPABASE_DB_URL) throw new Error("Missing required environment variable: SUPABASE_DB_URL");
  const result = await approveSirutaCandidate(args, { connectionString: process.env.SUPABASE_DB_URL });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code ?? "CANDIDATE_APPROVAL_FAILED",
    message: safeErrorMessage(error)
  }));
  process.exit(1);
}
