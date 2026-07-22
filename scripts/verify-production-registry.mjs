import pg from "pg";

import { safeErrorMessage } from "../packages/pipeline/src/acquisition/errors.mjs";

const { Client } = pg;
const REQUIRED_MIGRATIONS = [
  "202607220001",
  "202607220002",
  "202607220003",
  "202607220004"
];
const REQUIRED_TABLES = [
  "registry.source_snapshots",
  "registry.import_runs",
  "registry.territories",
  "registry.territory_revisions",
  "registry.territory_identifiers",
  "registry.release_candidate_approvals",
  "registry.releases",
  "registry.release_artifacts",
  "registry.release_channels",
  "registry.release_channel_events"
];

let client;
try {
  if (!process.env.SUPABASE_DB_URL) throw new Error("Missing required environment variable: SUPABASE_DB_URL");
  client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    application_name: "teritoriu.digital-production-verification",
    connectionTimeoutMillis: 15000,
    query_timeout: 20000
  });
  await client.connect();
  await client.query("begin read only");
  const migrationResult = await client.query(
    `select version
     from supabase_migrations.schema_migrations
     where version = any($1::text[])
     order by version`,
    [REQUIRED_MIGRATIONS]
  );
  const tableResult = await client.query(
    `select name, to_regclass(name) is not null as present
     from unnest($1::text[]) as requested(name)
     order by name`,
    [REQUIRED_TABLES]
  );
  const controlResult = await client.query(`
    select
      exists (select 1 from pg_extension where extname = 'postgis') as postgis,
      not has_schema_privilege('anon', 'registry', 'usage') as anon_blocked,
      not has_schema_privilege('authenticated', 'registry', 'usage') as authenticated_blocked,
      (select count(*)::integer from registry.source_snapshots) as snapshot_count,
      (select count(*)::integer from registry.import_runs) as import_count,
      (select count(*)::integer from registry.releases where status = 'published') as published_release_count
  `);
  await client.query("rollback");

  const migrations = migrationResult.rows.map((item) => item.version);
  const tables = Object.fromEntries(tableResult.rows.map((item) => [item.name, item.present]));
  const controls = controlResult.rows[0];
  const ok =
    JSON.stringify(migrations) === JSON.stringify(REQUIRED_MIGRATIONS) &&
    Object.values(tables).every(Boolean) &&
    controls.postgis &&
    controls.anon_blocked &&
    controls.authenticated_blocked;
  console.log(JSON.stringify({
    ok,
    migrations,
    tables,
    controls: {
      postgis: controls.postgis,
      anonBlocked: controls.anon_blocked,
      authenticatedBlocked: controls.authenticated_blocked,
      snapshotCount: controls.snapshot_count,
      importCount: controls.import_count,
      publishedReleaseCount: controls.published_release_count
    }
  }, null, 2));
  if (!ok) process.exitCode = 2;
} catch (error) {
  await client?.query("rollback").catch(() => {});
  console.error(JSON.stringify({
    ok: false,
    code: error.code ?? "PRODUCTION_VERIFICATION_FAILED",
    message: safeErrorMessage(error)
  }));
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
