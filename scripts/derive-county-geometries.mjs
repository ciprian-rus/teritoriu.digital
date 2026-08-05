import pg from "pg";

import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";
import {
  readCountyUnionCandidates,
  selectDerivableCounties
} from "../packages/pipeline/src/geometry/derive-county-geometries.mjs";
import { writeDerivedGeometries } from "../packages/pipeline/src/geometry/write-geometries.mjs";

const DERIVATION_METHOD = "union_of_children_v1";
const LICENSE_SPDX = "CC-BY-4.0";

function usage() {
  return `Usage:
  npm run derive:county-geometries -- --dry-run
  npm run derive:county-geometries -- --publish

Derives one geometry per county and per București by unioning the current
'source' geometries of their UAT-level children — ANCPI RELUAT never
publishes a polygon for a county or București directly. A root is only
derived when every expected child currently has a geometry (no partial
unions) and all of them trace to the same source snapshot. --dry-run
reports which roots would be derived or skipped, and why, without writing
anything. --publish writes the derived rows. Both modes require
SUPABASE_DB_URL.`;
}

function parseArguments(args) {
  const result = { dryRun: false, publish: false };
  for (const argument of args) {
    if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--publish") result.publish = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.help && result.dryRun === result.publish) {
    throw new Error("Choose exactly one mode: --dry-run or --publish");
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

  const databaseUrl = requireEnvironment("SUPABASE_DB_URL");
  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: "teritoriu.digital-geometry-derivation",
    connectionTimeoutMillis: 15000,
    query_timeout: 60000
  });
  await client.connect();

  try {
    const candidates = await readCountyUnionCandidates(client);
    const { derivable, skipped } = selectDerivableCounties(candidates);

    const summary = {
      rootCount: candidates.length,
      derivableCount: derivable.length,
      skippedCount: skipped.length,
      skipped
    };

    if (args.dryRun) {
      console.log(JSON.stringify({ ok: true, mode: "dry-run", ...summary }, null, 2));
      process.exit(0);
    }

    await writeDerivedGeometries(client, derivable, {
      licenseSpdx: LICENSE_SPDX,
      derivationMethod: DERIVATION_METHOD
    });

    console.log(
      JSON.stringify({ ok: true, mode: "publish", ...summary, derivationMethod: DERIVATION_METHOD }, null, 2)
    );
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error.code ?? "GEOMETRY_DERIVATION_FAILED",
      message: safeErrorMessage(error)
    })
  );
  process.exit(1);
}
