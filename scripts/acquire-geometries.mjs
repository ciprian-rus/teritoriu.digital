import { readFile } from "node:fs/promises";

import pg from "pg";

import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";
import { snapshotMetadata } from "../packages/pipeline/src/acquisition/archive.mjs";
import { registerSnapshot } from "../packages/pipeline/src/acquisition/postgres-metadata.mjs";
import { archiveInSupabase } from "../packages/pipeline/src/acquisition/supabase-archive.mjs";
import { fetchAllFeatures } from "../packages/pipeline/src/geometry/arcgis-client.mjs";
import { buildDownloadResult } from "../packages/pipeline/src/geometry/geometry-snapshot.mjs";
import { matchFeaturesToTerritories } from "../packages/pipeline/src/geometry/match-territories.mjs";
import { readMatchableTerritories, writeGeometries } from "../packages/pipeline/src/geometry/write-geometries.mjs";

const SOURCE_FILE = new URL("../config/sources/ancpi-reluat-geometries.json", import.meta.url);

function usage() {
  return `Usage:
  npm run acquire:geometries -- --dry-run
  npm run acquire:geometries -- --publish

Both modes read the current territory registry to match ANCPI RELUAT features
by SIRUTA code (falling back to scoped name matching). --dry-run reports
match/unmatched/conflict counts without writing anything. --publish archives
the fetched payload, registers a source snapshot and writes matched
geometries, in one transaction, requires SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL.

Both modes require SUPABASE_DB_URL to read the current territory registry.`;
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

  const source = JSON.parse(await readFile(SOURCE_FILE, "utf8"));
  const databaseUrl = requireEnvironment("SUPABASE_DB_URL");
  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: "teritoriu.digital-geometry-acquisition",
    connectionTimeoutMillis: 15000,
    query_timeout: 20000
  });
  await client.connect();

  let fetchResult;
  let territories;
  let matchResult;
  try {
    console.error("Fetching ANCPI RELUAT features...");
    fetchResult = await fetchAllFeatures(source, {
      onProgress: (done, total) => console.error(`  ${done}/${total} features fetched`)
    });
    territories = await readMatchableTerritories(client);
    matchResult = matchFeaturesToTerritories(fetchResult.features, territories);
  } finally {
    if (args.dryRun) await client.end();
  }

  if (matchResult.conflicts.length > 0) {
    throw Object.assign(new Error("Ambiguous geometry matches require a human decision before publishing"), {
      code: "GEOMETRY_MATCH_CONFLICT",
      conflicts: matchResult.conflicts
    });
  }

  const summary = {
    source: source.slug,
    objectCount: fetchResult.objectCount,
    featureCount: fetchResult.features.length,
    matchedCount: matchResult.matched.length,
    unmatchedCount: matchResult.unmatched.length,
    territoryCount: territories.length,
    minExpectedMatchedCount: source.minExpectedMatchedCount
  };

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        { ok: matchResult.matched.length >= source.minExpectedMatchedCount, mode: "dry-run", ...summary, unmatchedSamples: matchResult.unmatched.slice(0, 20) },
        null,
        2
      )
    );
    if (matchResult.matched.length < source.minExpectedMatchedCount) process.exitCode = 2;
    process.exit(0);
  }

  try {
    const download = buildDownloadResult(fetchResult);
    const metadata = snapshotMetadata(source, download);

    const supabaseUrl = requireEnvironment("SUPABASE_URL");
    const serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    const archived = await archiveInSupabase(metadata, download.bytes, { supabaseUrl, serviceRoleKey });
    const registered = await registerSnapshot(source, metadata, { connectionString: databaseUrl });

    await writeGeometries(client, registered.snapshotId, matchResult.matched, {
      minExpectedMatchedCount: source.minExpectedMatchedCount,
      licenseSpdx: source.licenseSpdx
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "publish",
          ...summary,
          snapshotId: registered.snapshotId,
          snapshotCreated: registered.created,
          archiveCreated: archived.created,
          sha256: download.sha256
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error.code ?? "GEOMETRY_ACQUISITION_FAILED",
      message: safeErrorMessage(error),
      conflicts: error.conflicts
    })
  );
  process.exit(1);
}
