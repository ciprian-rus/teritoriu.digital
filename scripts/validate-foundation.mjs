import { readFile } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const requiredFiles = [
  "README.md",
  "package.json",
  "package-lock.json",
  "docs/adr/0001-hybrid-control-and-distribution-planes.md",
  "docs/adr/0002-persistent-territory-identifiers.md",
  "docs/adr/0003-immutable-releases.md",
  "docs/data-contract.md",
  "docs/public-contract-v1.md",
  "docs/governance/roles-and-promotion.md",
  "docs/law-alignment.md",
  "docs/runbooks/siruta-canonicalization.md",
  "docs/runbooks/siruta-release.md",
  ".github/workflows/acquire-siruta.yml",
  ".github/workflows/approve-siruta-candidate.yml",
  ".github/workflows/canonicalize-siruta.yml",
  ".github/workflows/move-stable-release.yml",
  ".github/workflows/mirror-siruta.yml",
  ".github/workflows/publish-siruta-release.yml",
  ".github/workflows/verify-production-registry.yml",
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
  "packages/pipeline/src/release/artifact-builder.mjs",
  "packages/pipeline/src/release/bundle-files.mjs",
  "packages/pipeline/src/release/postgres-release.mjs",
  "packages/consumer/src/import-release.mjs",
  "packages/consumer/src/index.mjs",
  "packages/consumer/src/verify-release.mjs",
  "scripts/approve-siruta-candidate.mjs",
  "scripts/move-stable-release.mjs",
  "scripts/prepare-siruta-release.mjs",
  "scripts/promote-siruta-release.mjs",
  "scripts/verify-release-bundle.mjs",
  "scripts/verify-production-registry.mjs",
  "schemas/contract.schema.json",
  "schemas/release-manifest.schema.json",
  "schemas/territories.schema.json",
  "schemas/territory.schema.json",
  "supabase/migrations/202607220001_initial_registry.sql",
  "supabase/migrations/202607220002_source_snapshot_storage.sql",
  "supabase/migrations/202607220003_m2_identity_and_roles.sql",
  "supabase/migrations/202607220004_m3_release_governance.sql",
  "supabase/migrations/202607230001_identity_proposal_reuse.sql"
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
  contractSchema,
  manifestSchema,
  territoriesSchema,
  territorySchema,
  sirutaSource,
  sirutaTransform
] = await Promise.all([
  loadJson("package.json"),
  loadJson("package-lock.json"),
  loadJson("schemas/contract.schema.json"),
  loadJson("schemas/release-manifest.schema.json"),
  loadJson("schemas/territories.schema.json"),
  loadJson("schemas/territory.schema.json"),
  loadJson("config/sources/siruta-2025.json"),
  loadJson("config/transforms/siruta-2025.json")
]);
const manifestExample = await loadJson("schemas/examples/release-manifest.example.json");

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

const m3Migration = await load("supabase/migrations/202607220004_m3_release_governance.sql");
const m3MigrationInvariants = [
  "add column release_id text references registry.releases",
  "create table registry.release_candidate_approvals",
  "create table registry.release_channel_events",
  "releases_one_published_import_idx",
  "release_candidate_approvals_append_only",
  "release_channel_events_append_only",
  "release_channels_guard",
  "releases_publication_date_check"
];
for (const invariant of m3MigrationInvariants) {
  if (!m3Migration.toLowerCase().includes(invariant)) {
    errors.push(`M3 migration invariant missing: ${invariant}`);
  }
}

const identityProposalMigration = await load("supabase/migrations/202607230001_identity_proposal_reuse.sql");
const identityProposalMigrationInvariants = [
  "drop index if exists registry.identity_decisions_proposed_idx",
  "create index identity_decisions_proposed_idx",
  "create index identity_decisions_source_proposed_idx",
  "pg_advisory_xact_lock",
  "identity_decisions_proposal_reuse_guard"
];
for (const invariant of identityProposalMigrationInvariants) {
  if (!identityProposalMigration.toLowerCase().includes(invariant)) {
    errors.push(`Identity proposal reuse migration invariant missing: ${invariant}`);
  }
}

const migrations = `${initialMigration}\n${m2Migration}\n${m3Migration}\n${identityProposalMigration}`;
if (/service_role|sb_secret_|supabase_service_role_key/i.test(migrations)) {
  errors.push("migrations must not contain privileged API key names or values");
}

for (const [name, schema] of Object.entries({
  contractSchema,
  manifestSchema,
  territoriesSchema,
  territorySchema
})) {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    errors.push(`${name}: expected JSON Schema draft 2020-12`);
  }
  if (schema.additionalProperties !== false) {
    errors.push(`${name}: additionalProperties must be false at the root`);
  }
}

try {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(territorySchema);
  ajv.compile(contractSchema);
  ajv.compile(territoriesSchema);
  const validateManifestExample = ajv.compile(manifestSchema);
  if (!validateManifestExample(manifestExample)) {
    errors.push(`release manifest example fails its schema: ${JSON.stringify(validateManifestExample.errors)}`);
  }
} catch (error) {
  errors.push(`release manifest schema could not be compiled (${error.message})`);
}

for (const field of [
  "releaseTag",
  "contract",
  "transformationVersion",
  "candidateSha256",
  "approval",
  "license",
  "changelogArtifact",
  "checksumArtifact"
]) {
  if (!manifestSchema.required?.includes(field)) errors.push(`release manifest must require ${field}`);
}
if (manifestSchema.properties?.license?.properties?.spdx?.const !== "CC-BY-4.0") {
  errors.push("release manifest must preserve the reviewed SIRUTA CC-BY-4.0 license");
}
if (
  manifestSchema.properties?.contract?.properties?.name?.const !==
    "teritoriu.digital/siruta-release" ||
  manifestSchema.properties?.contract?.properties?.descriptorArtifact?.const !== "contract.json"
) {
  errors.push("release manifest must bind the reviewed public contract descriptor");
}
if (
  contractSchema.properties?.compatibility?.properties?.supportedMajor?.const !== 1 ||
  contractSchema.properties?.compatibility?.properties?.breakingChanges?.const !== "new-major-required"
) {
  errors.push("public contract must preserve the reviewed SemVer compatibility policy");
}
if (
  territoriesSchema.properties?.territories?.items?.$ref !== territorySchema.$id ||
  !territoriesSchema.required?.includes("contractVersion")
) {
  errors.push("territories payload schema must bind the public contract and territory schema");
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
const sourceCorrectionSchema =
  territorySchema.properties?.provenance?.properties?.sourceCorrections?.items;
if (
  sourceCorrectionSchema?.properties?.field?.const !== "NUTS" ||
  sourceCorrectionSchema?.properties?.ruleCode?.const !== "SIRUTA_REVIEWED_NUTS_CORRECTION"
) {
  errors.push("territory provenance must model reviewed NUTS source corrections explicitly");
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
if (
  !Number.isSafeInteger(sirutaSource.deadlineMs) ||
  sirutaSource.deadlineMs < sirutaSource.timeoutMs ||
  sirutaSource.deadlineMs > 300000
) {
  errors.push("SIRUTA download deadline must be between the inactivity timeout and 5 minutes");
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
if (
  !/^bootstrap\/[a-z0-9]+(?:[._-][a-z0-9]+)*\.xlsx$/.test(
    sirutaSource.bootstrapStorageObject ?? ""
  )
) {
  errors.push("SIRUTA bootstrap storage object must be a safe XLSX path under bootstrap/");
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
if (
  profile.checksumWarnings !== 77 ||
  profile.nutsMissingValues !== 215 ||
  profile.nuts3Codes !== 42
) {
  errors.push("SIRUTA reviewed source-quality warning counts changed without a config review");
}
const reviewedSourceExceptions = {
  rootParentSentinel: {
    value: "1",
    sourceLevel: 1,
    expectedCount: 42
  },
  recordTypeDefinitions: {
    "179132": {
      sourceTypeCode: 9,
      sourceLevel: 2,
      territoryType: "municipality",
      administrativeRole: "local_uat",
      isUat: true,
      isLocality: true,
      isCountySeat: true
    }
  },
  nutsCountyCorrections: {
    "52": {
      countySiruta: "528",
      sourceValue: "RO224",
      canonicalValue: "RO314",
      expectedRecordCount: 225
    }
  }
};
if (
  JSON.stringify(sirutaTransform.reviewedSourceExceptions) !==
  JSON.stringify(reviewedSourceExceptions)
) {
  errors.push("SIRUTA reviewed hierarchy exceptions differ from the approved 2025 source contract");
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
if (packageJson.dependencies?.ajv !== "8.20.0" || packageJson.dependencies?.["ajv-formats"] !== "3.0.1") {
  errors.push("release schema validators must stay pinned to ajv 8.20.0 and ajv-formats 3.0.1");
}
if (
  packageLock.packages?.[""]?.dependencies?.ajv !== "8.20.0" ||
  packageLock.packages?.[""]?.dependencies?.["ajv-formats"] !== "3.0.1"
) {
  errors.push("package-lock root must pin the reviewed release schema validators");
}
if (packageLock.packages?.[""]?.dependencies?.["read-excel-file"] !== "9.3.4") {
  errors.push("package-lock root must pin read-excel-file 9.3.4");
}

const mirrorWorkflow = await load(".github/workflows/mirror-siruta.yml");
if (!mirrorWorkflow.includes("workflow_dispatch: {}") || mirrorWorkflow.includes("inputs:")) {
  errors.push("SIRUTA mirror manual dispatch must not require operator inputs");
}
for (const invariant of [
  "github.event_name == 'schedule'",
  "--publish --direct-resource",
  "github.event_name == 'workflow_dispatch'",
  "--publish --configured-storage-bootstrap",
  "environment: production",
  "github.ref == 'refs/heads/main'"
]) {
  if (!mirrorWorkflow.includes(invariant)) {
    errors.push(`SIRUTA mirror workflow invariant missing: ${invariant}`);
  }
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

const approveWorkflow = await load(".github/workflows/approve-siruta-candidate.yml");
const approveBeforePrivilegedStep = approveWorkflow.slice(0, approveWorkflow.indexOf("      - name: Approve exact candidate"));
if (approveBeforePrivilegedStep.includes("secrets.")) {
  errors.push("Candidate approval tests must run before SUPABASE_DB_URL is injected");
}
if (!approveWorkflow.includes("environment: production") || !approveWorkflow.includes("persist-credentials: false")) {
  errors.push("Candidate approval must use production protection and discard checkout credentials");
}

const publishWorkflow = await load(".github/workflows/publish-siruta-release.yml");
const publishBeforeBuild = publishWorkflow.slice(0, publishWorkflow.indexOf("      - name: Rebuild approved candidate and release bundle"));
if (publishBeforeBuild.includes("secrets.")) {
  errors.push("Release install and tests must run before Supabase secrets are injected");
}
for (const invariant of [
  "RELEASE_IMMUTABILITY_CONFIRMED",
  "--jq .visibility",
  "persist-credentials: false",
  "readReleaseBundle",
  "cmp --silent",
  "contract.json",
  "territories.ndjson",
  "territory-identifiers.csv",
  "release:promote:siruta",
  "--require-existing-promotion"
]) {
  if (!publishWorkflow.includes(invariant)) errors.push(`Release workflow invariant missing: ${invariant}`);
}

const prepareReleaseScript = await load("scripts/prepare-siruta-release.mjs");
for (const invariant of [
  "registry.release_channels",
  "registry.release_candidate_approvals",
  "candidate_sha256 !== context.candidateSha256",
  "unchangedReleaseDiff",
  "previousRelease?.release_id ?? null"
]) {
  if (!prepareReleaseScript.includes(invariant)) {
    errors.push(`Contract follow-up release invariant missing: ${invariant}`);
  }
}
const draftReleaseIndex = publishWorkflow.indexOf("      - name: Create or verify the immutable draft release");
const promoteReleaseIndex = publishWorkflow.indexOf("      - name: Promote canonical registry and stable atomically");
const publishReleaseIndex = publishWorkflow.indexOf("      - name: Publish the promoted GitHub Release");
const makePublicIndex = publishWorkflow.indexOf("gh release edit \"${tag}\" --draft=false");
if (
  draftReleaseIndex === -1 ||
  promoteReleaseIndex <= draftReleaseIndex ||
  publishReleaseIndex <= promoteReleaseIndex ||
  makePublicIndex <= promoteReleaseIndex
) {
  errors.push("GitHub Release must remain draft until the atomic registry promotion succeeds");
}

const moveStableWorkflow = await load(".github/workflows/move-stable-release.yml");
const moveBeforePrivilegedStep = moveStableWorkflow.slice(0, moveStableWorkflow.indexOf("      - name: Move stable with an audited event"));
if (moveBeforePrivilegedStep.includes("secrets.")) {
  errors.push("Stable-channel tests must run before SUPABASE_DB_URL is injected");
}

const productionVerificationWorkflow = await load(".github/workflows/verify-production-registry.yml");
const productionBeforePrivilegedStep = productionVerificationWorkflow.slice(
  0,
  productionVerificationWorkflow.indexOf("      - name: Verify production migrations and isolation read-only")
);
if (productionBeforePrivilegedStep.includes("secrets.")) {
  errors.push("Production verification tests must run before SUPABASE_DB_URL is injected");
}
if (
  !productionVerificationWorkflow.includes("environment: production") ||
  !productionVerificationWorkflow.includes("persist-credentials: false")
) {
  errors.push("Production verification must be protected and discard checkout credentials");
}
if (
  !productionVerificationWorkflow.includes("push:") ||
  !productionVerificationWorkflow.includes("branches:") ||
  !productionVerificationWorkflow.includes("supabase/migrations/**")
) {
  errors.push("Production verification must run after migration pushes to main");
}
if (!moveStableWorkflow.includes("environment: production") || !moveStableWorkflow.includes("release:stable:siruta")) {
  errors.push("Stable-channel moves must use the protected audited workflow");
}

if (errors.length > 0) {
  console.error(`Foundation validation failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`Foundation validation passed (${requiredFiles.length} required files).`);
