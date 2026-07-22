import { readFile } from "node:fs/promises";

const requiredFiles = [
  "README.md",
  "docs/adr/0001-hybrid-control-and-distribution-planes.md",
  "docs/adr/0002-persistent-territory-identifiers.md",
  "docs/adr/0003-immutable-releases.md",
  "docs/data-contract.md",
  "docs/law-alignment.md",
  "schemas/release-manifest.schema.json",
  "schemas/territory.schema.json",
  "supabase/migrations/202607220001_initial_registry.sql"
];

const errors = [];

async function load(path) {
  try {
    return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
    return "";
  }
}

for (const path of requiredFiles) {
  await load(path);
}

for (const path of [
  "schemas/release-manifest.schema.json",
  "schemas/territory.schema.json",
  "schemas/examples/release-manifest.example.json"
]) {
  const content = await load(path);
  try {
    JSON.parse(content);
  } catch (error) {
    errors.push(`${path}: JSON invalid (${error.message})`);
  }
}

const migration = await load("supabase/migrations/202607220001_initial_registry.sql");
const migrationInvariants = [
  "create schema if not exists registry",
  "create extension if not exists postgis",
  "create domain registry.uuid_v7",
  "create table registry.territories",
  "create table registry.territory_revisions",
  "create table registry.source_snapshots",
  "create table registry.validation_findings",
  "create table registry.releases",
  "enable row level security",
  "revoke all on schema registry"
];

for (const invariant of migrationInvariants) {
  if (!migration.toLowerCase().includes(invariant)) {
    errors.push(`migration invariant missing: ${invariant}`);
  }
}

if (/service_role|sb_secret_|supabase_service_role_key/i.test(migration)) {
  errors.push("migration must not contain privileged API key names or values");
}

const manifestSchema = JSON.parse(
  await load("schemas/release-manifest.schema.json")
);
const territorySchema = JSON.parse(await load("schemas/territory.schema.json"));

for (const [name, schema] of Object.entries({ manifestSchema, territorySchema })) {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    errors.push(`${name}: expected JSON Schema draft 2020-12`);
  }
  if (schema.additionalProperties !== false) {
    errors.push(`${name}: additionalProperties must be false at the root`);
  }
}

if (errors.length > 0) {
  console.error(`Foundation validation failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`Foundation validation passed (${requiredFiles.length} required files).`);

