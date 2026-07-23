import path from "node:path";

import { verifyConsumerRelease } from "../packages/consumer/src/verify-release.mjs";
import { readReleaseBundle } from "../packages/pipeline/src/release/bundle-files.mjs";

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--bundle-dir") result.bundleDirectory = args[++index];
    else if (argument === "--release-id") result.expectedReleaseId = args[++index];
    else if (argument === "--manifest-sha256") result.expectedManifestSha256 = args[++index];
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.help && !result.bundleDirectory) throw new Error("Missing required argument: --bundle-dir");
  return result;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Verify a complete Teritoriu.digital public release bundle.\n" +
      "Usage: npm run contract:verify -- --bundle-dir PATH [--release-id ID] [--manifest-sha256 SHA256]"
    );
    process.exit(0);
  }
  const directory = path.resolve(args.bundleDirectory);
  const bundle = await readReleaseBundle(directory);
  const result = verifyConsumerRelease(bundle, {
    expectedReleaseId: args.expectedReleaseId,
    expectedManifestSha256: args.expectedManifestSha256
  });
  console.log(JSON.stringify({ ok: true, directory, ...result.report }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    ...(error.report ?? {
      status: "rejected",
      errors: [{ code: error.code ?? "CONSUMER_CONTRACT_REJECTED", message: error.message }]
    })
  }, null, 2));
  process.exitCode = 1;
}
