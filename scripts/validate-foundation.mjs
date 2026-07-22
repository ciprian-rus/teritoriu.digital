import { readFile } from "node:fs/promises";

const requiredFiles = [
  "README.md",
  "package.json",
  "package-lock.json",
  "docs/adr/0001-hybrid-control-and-distribution-planes.md",
  "docs/adr/0002-persistent-territory-identifiers.md",
  "docs/adr/0003-immutable-releases.md",
  "docs/data-contract.md",
  "docs/governance/roles-and-promotion.md",
  "docs/law-alignment.md",
  "docs/runbooks/siruta-canonicalization.md",
  ".github/workflows/acquire-siruta.yml",
  ".github/workflows/canonicalize-siruta.yml",
  "config/sources/siruta-2025.json",
  "config/transforms/siruta-2025.json",
  "packages/pipeline/src/acquisition/ckan-discovery.mjs",
  "packages/pipeline/src/acquisition/downloader.mjs",
  "packages/pipeline/src/acquisition/network-policy.mjs",
  "packages/pipeline/src/canonical/build-candidate.mjs",
  "packages/pipeline/src/canonical/fetch-snapshot.mjs",
  "packages/pipeline/src/canonical/identity-reconciliation.mjs",
  "packages/pipeline/src/canonical/siruta-parser.mjs",
  "packages/pipeline/src/canonical/siruta-validation.mjs",
  "schemas/release-manifest.schema.json",
  "schemas/territory.schema.json",
  "supabase/migrations/202607220001_initial_registry.sql",
  "supabase/migrations/202607220002_source_snapshot_storage.sql",
  "supabase/migrations/202607220003_m2_identity_and_roles.sql"
];

const errors = [];
const contents = new Map();

async function load(path) {
  if (contents.has(path)) return contents.get(path);
  try {
    const content = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    contents.set(path, content);
    return content;
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
    contents.set(path, "");
    return "";
  }
}

async function loadJson(path) {
  const content = await load(path);
  try {
    return JSON.parse(content);
  } catch (error) {
    errors.push(`${path}: JSON invalid (${error.message})`);
    return {};
  }
}

for (const path of requiredFiles) await load(path);

const [
  packageJson,
  packageLock,
  manifestSchema,
  territorySchema,
  sirutaSource,
  sirutaTransform
] = await Promise.all([
  loadJson("package.json"),
  loadJson("package-lock.json"),
  loadJson("schemas/release-manifest.schema.json"),
  loadJson("schemas/territory.schema.json"),
  loadJson("config/sources/siruta-2025.json"),
  loadJson("config/transforms/siruta-2025.json")
]);
await loadJson("schemas/examples/release-manifest.example.json");

const initialMigration = await load("supabase/migrations/202607220001_initial_registry.sql");
const initialMigrationInvariants = [
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
for (const invariant of initialMigrationInvariants) {
  if (!initialMigration.toLowerCase().includes(invariant)) {
    errors.push(`initial migration invariant missing: ${invariant}`);
  }
}

const m2Migration = await load("supabase/migrations/202607220003_m2_identity_and_roles.sql");
const m2MigrationInvariants = [
  "uuid_v7_variant_check",
  "add column if not exists administrative_role text",
  "territory_revisions_administrative_role_check",
  "add column if not exists proposed_territory_id registry.uuid_v7",
  "create unique index if not exists identity_decisions_proposed_idx",
  "identity_decisions_target_check"
];
for (const invariant of m2MigrationInvariants) {
  if (!m2Migration.toLowerCase().includes(invariant)) {
    errors.push(`M2 migration invariant missing: ${invariant}`);
  }
}

const migrations = `${initialMigration}\n${m2Migration}`;
if (/service_role|sb_secret_|supabase_service_role_key/i.test(migrations)) {
  errors.push("migrations must not contain privileged API key names or values");
}

for (const [name, schema] of Object.entries({ manifestSchema, territorySchema })) {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    errors.push(`${name}: expected JSON Schema draft 2020-12`);
  }
  if (schema.additionalProperties !== false) {
    errors.push(`${name}: additionalProperties must be false at the root`);
  }
}

const administrativeRoles = [
  "country",
  "county_uat",
  "local_uat",
  "administrative_subdivision",
  "locality",
  "statistical_region"
];
if (!territorySchema.required?.includes("administrativeRole")) {
  errors.push("territory schema must require administrativeRole");
}
if (JSON.stringify(territorySchema.properties?.administrativeRole?.enum) !== JSON.stringify(administrativeRoles)) {
  errors.push("territory schema administrativeRole enum differs from the approved contract");
}
const uuidV7Pattern = "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
for (const [field, property] of Object.entries({
  territoryId: territorySchema.properties?.territoryId,
  parentTerritoryId: territorySchema.properties?.parentTerritoryId,
  countyTerritoryId: territorySchema.properties?.countyTerritoryId,
  sourceSnapshotId: territorySchema.properties?.provenance?.properties?.sourceSnapshotId
})) {
  if (property?.pattern !== uuidV7Pattern) errors.push(`${field} must enforce lowercase UUIDv7`);
}

if (JSON.stringify(sirutaSource.allowedHosts) !== JSON.stringify(["data.gov.ro"])) {
  errors.push("SIRUTA source must allowlist only data.gov.ro");
}
if (JSON.stringify(sirutaSource.allowedProtocols) !== JSON.stringify(["https:"])) {
  errors.push("SIRUTA production source must allow HTTPS only");
}
if (JSON.stringify(sirutaSource.allowedPorts) !== JSON.stringify([443])) {
  errors.push("SIRUTA production source must allow port 443 only");
}
if (sirutaSource.maxBytes > 5 * 1024 * 1024) {
  errors.push("SIRUTA acquisition limit exceeds the approved 5 MiB boundary");
}
if (
  !Number.isSafeInteger(sirutaSource.timeoutMs) ||
  sirutaSource.timeoutMs < 10000 ||
  sirutaSource.timeoutMs > 60000
) {
  errors.push("SIRUTA timeout must stay between 10 and 60 seconds per attempt");
}
if (!Number.isSafeInteger(sirutaSource.maxAttempts) || sirutaSource.maxAttempts < 1 || sirutaSource.maxAttempts > 4) {
  errors.push("SIRUTA acquisition must use between one and four attempts");
}
if (!/^[0-9a-f]{64}$/.test(sirutaSource.observedSnapshot?.sha256 ?? "")) {
  errors.push("SIRUTA observed snapshot must pin a lowercase SHA-256 baseline");
}
if (
  !Number.isSafeInteger(sirutaSource.observedSnapshot?.sizeBytes) ||
  sirutaSource.observedSnapshot.sizeBytes <= 0 ||
  sirutaSource.observedSnapshot.sizeBytes > sirutaSource.maxBytes
) {
  errors.push("SIRUTA observed snapshot size must fit the approved acquisition boundary");
}
const serializedSource = JSON.stringify(sirutaSource);
if (/service_role|sb_secret_|postgres(?:ql)?:\/\//i.test(serializedSource)) {
  errors.push("source configuration must not contain database URLs or privileged keys");
}

const expectedHeaders = [
  "SIRUTA", "DENLOC", "CODP", "JUD", "SIRSUP", "TIP",
  "NIV", "MED", "REGIUNE", "FSJ", "FSL", "NUTS"
];
if (JSON.stringify(sirutaTransform.expectedHeaders) !== JSON.stringify(expectedHeaders)) {
  errors.push("SIRUTA transformation headers differ from the reviewed 2025 contract");
}
const profile = sirutaTransform.expectedProfile ?? {};
if (profile.totalRows !== 16978 || JSON.stringify(profile.levels) !== JSON.stringify({ "1": 42, "2": 3181, "3": 13755 })) {
  errors.push("SIRUTA transformation volumes differ from the reviewed 2025 profile");
}
if (Object.values(profile.levels ?? {}).reduce((sum, value) => sum + value, 0) !== profile.totalRows) {
  errors.push("SIRUTA hierarchy-level volumes must sum to the total row count");
}
if (profile.checksumWarnings !== 77 || profile.nutsMissingValues !== 215) {
  errors.push("SIRUTA reviewed source-quality warning counts changed without a config review");
}
if (!/^siruta-2025\.[0-9]+\.[0-9]+\.[0-9]+$/.test(sirutaTransform.transformationVersion ?? "")) {
  errors.push("SIRUTA transformationVersion must be explicitly versioned");
}
const expectedThresholds = ["maxTotalDeltaRatio", "maxRemovedRatio", "maxChangedRatio"];
if (JSON.stringify(Object.keys(sirutaTransform.diffThresholds ?? {}).sort()) !== JSON.stringify(expectedThresholds.sort())) {
  errors.push("SIRUTA diff thresholds must define exactly the three reviewed gates");
}
for (const [name, value] of Object.entries(sirutaTransform.diffThresholds ?? {})) {
  if (typeof value !== "number" || value < 0 || value > 1) {
    errors.push(`SIRUTA diff threshold ${name} must be between 0 and 1`);
  }
}
const xlsxLimits = sirutaTransform.xlsxLimits ?? {};
for (const field of [
  "maxEntries",
  "maxUncompressedBytes",
  "maxEntryUncompressedBytes",
  "maxCompressionRatio"
]) {
  if (!Number.isFinite(xlsxLimits[field]) || xlsxLimits[field] <= 0) {
    errors.push(`SIRUTA xlsx limit ${field} must be a positive number`);
  }
}
if (xlsxLimits.maxUncompressedBytes > 64 * 1024 * 1024) {
  errors.push("SIRUTA XLSX total decompressed limit exceeds 64 MiB");
}
if (xlsxLimits.maxEntryUncompressedBytes > xlsxLimits.maxUncompressedBytes) {
  errors.push("SIRUTA XLSX per-entry limit cannot exceed the total decompressed limit");
}

if (packageJson.dependencies?.["read-excel-file"] !== "9.3.4") {
  errors.push("read-excel-file must be pinned to the reviewed version 9.3.4");
}
if (packageLock.packages?.[""]?.dependencies?.["read-excel-file"] !== "9.3.4") {
  errors.push("package-lock root must pin read-excel-file 9.3.4");
}

const acquireWorkflow = await load(".github/workflows/acquire-siruta.yml");
const acquireValidateSection = acquireWorkflow.slice(
  acquireWorkflow.indexOf("  validate:"),
  acquireWorkflow.indexOf("  publish:")
);
const acquirePublishSection = acquireWorkflow.slice(acquireWorkflow.indexOf("  publish:"));
if (acquireValidateSection.includes("secrets.")) {
  errors.push("Acquire SIRUTA validate job must never receive repository or environment secrets");
}
if (!acquireValidateSection.includes("if: github.event_name != 'pull_request'")) {
  errors.push("Acquire SIRUTA live source access must stay outside the deterministic PR gate");
}
if (!acquirePublishSection.includes("environment: production")) {
  errors.push("Acquire SIRUTA publish job must use the protected production environment");
}
if (!acquirePublishSection.includes("github.ref == 'refs/heads/main'")) {
  errors.push("Acquire SIRUTA publish job must be restricted to main");
}

const canonicalizeWorkflow = await load(".github/workflows/canonicalize-siruta.yml");
const canonicalizeBeforeFetch = canonicalizeWorkflow.slice(
  0,
  canonicalizeWorkflow.indexOf("      - name: Fetch exact private snapshot")
);
if (canonicalizeBeforeFetch.includes("secrets.")) {
  errors.push("Canonicalize SIRUTA install and test steps must run without secrets");
}
if (!canonicalizeWorkflow.includes("environment: production") || !canonicalizeWorkflow.includes("github.ref == 'refs/heads/main'")) {
  errors.push("Canonicalize SIRUTA must be restricted to main and the protected production environment");
}

if (errors.length > 0) {
  console.error(`Foundation validation failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`Foundation validation passed (${requiredFiles.length} required files).`);
