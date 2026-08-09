import pg from "pg";

import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";
import {
  readInvalidCurrentSourceGeometries,
  writeSourceCorrections,
  SOURCE_VALIDITY_CORRECTION_METHOD
} from "../packages/pipeline/src/geometry/correct-source-geometries.mjs";

function usage() {
  return `Usage:
  npm run correct:source-geometries -- --dry-run
  npm run correct:source-geometries -- --publish

Finds current 'source' geometries (ANCPI RELUAT, unchanged since
acquisition) that fail gis.ST_IsValid and writes a 'source_corrected' row
for each, via gis.ST_MakeValid. Never touches or replaces the original
'source' row — both remain, distinguished by geometry_kind. --dry-run
reports which territories would be corrected or are still invalid after
correction, without writing anything. --publish writes the corrected rows.
Both modes require SUPABASE_DB_URL.`;
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
    application_name: "teritoriu.digital-geometry-source-correction",
    connectionTimeoutMillis: 15000,
    query_timeout: 60000
  });
  await client.connect();

  try {
    const invalidRows = await readInvalidCurrentSourceGeometries(client);

    if (args.dryRun) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "dry-run",
            invalidCount: invalidRows.length,
            territoryIds: invalidRows.map((row) => row.territoryId)
          },
          null,
          2
        )
      );
      process.exit(0);
    }

    const { corrected, stillInvalid } = await writeSourceCorrections(client, invalidRows, {
      derivationMethod: SOURCE_VALIDITY_CORRECTION_METHOD
    });

    console.log(
      JSON.stringify(
        {
          ok: stillInvalid.length === 0,
          mode: "publish",
          invalidCount: invalidRows.length,
          correctedCount: corrected.length,
          stillInvalid
        },
        null,
        2
      )
    );
    if (stillInvalid.length > 0) process.exit(1);
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error.code ?? "GEOMETRY_SOURCE_CORRECTION_FAILED",
      message: safeErrorMessage(error)
    })
  );
  process.exit(1);
}
