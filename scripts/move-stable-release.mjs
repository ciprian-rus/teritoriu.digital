import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";
import { moveStableReleaseChannel } from "../packages/pipeline/src/release/postgres-release.mjs";

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--release-id") result.releaseId = args[++index];
    else if (argument === "--actor") result.actor = args[++index];
    else if (argument === "--rationale") result.rationale = args[++index];
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.help && (!result.releaseId || !result.actor || !result.rationale)) {
    throw new Error("--release-id, --actor and --rationale are required");
  }
  return result;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log("Move stable to an existing published release. Requires SUPABASE_DB_URL.");
    process.exit(0);
  }
  if (!process.env.SUPABASE_DB_URL) throw new Error("Missing required environment variable: SUPABASE_DB_URL");
  const result = await moveStableReleaseChannel(args, { connectionString: process.env.SUPABASE_DB_URL });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code ?? "STABLE_CHANNEL_MOVE_FAILED",
    message: safeErrorMessage(error)
  }));
  process.exit(1);
}
