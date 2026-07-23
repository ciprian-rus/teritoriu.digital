import { createHash } from "node:crypto";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import contractSchema from "../../../../schemas/contract.schema.json" with { type: "json" };
import manifestSchema from "../../../../schemas/release-manifest.schema.json" with { type: "json" };
import territoriesSchema from "../../../../schemas/territories.schema.json" with { type: "json" };
import territorySchema from "../../../../schemas/territory.schema.json" with { type: "json" };
import {
  canonicalJson,
  canonicalJsonPretty,
  canonicalSha256
} from "../canonical/canonical-json.mjs";

export const PUBLIC_CONTRACT_NAME = "teritoriu.digital/siruta-release";
export const PUBLIC_CONTRACT_VERSION = "1.0.0";
const RELEASE_ID = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]*$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const SIRUTA = /^\d{1,6}$/;
const DATA_LICENSE = Object.freeze({
  spdx: "CC-BY-4.0",
  name: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Sursa datelor: Institutul Național de Statistică, SIRUTA 2025, publicat prin data.gov.ro."
});
const MEDIA_TYPES = Object.freeze({
  "contract.json": "application/json",
  "contract.schema.json": "application/schema+json",
  "release-manifest.schema.json": "application/schema+json",
  "territories.json": "application/json",
  "territories.ndjson": "application/x-ndjson",
  "territories.schema.json": "application/schema+json",
  "territories.csv": "text/csv; charset=utf-8",
  "territory-identifiers.csv": "text/csv; charset=utf-8",
  "territory.schema.json": "application/schema+json",
  "validation-report.json": "application/json",
  "changelog.json": "application/json"
});

function fail(message) {
  const error = new Error(message);
  error.code = "RELEASE_CONTRACT_INVALID";
  throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireUtcTimestamp(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail(`${field} must be an exact UTC timestamp with millisecond precision`);
  }
  if (new Date(value).toISOString() !== value) fail(`${field} is not a valid timestamp`);
  return value;
}

function releaseDate(releaseId) {
  return releaseId.slice(0, 10).replaceAll(".", "-");
}

function sirutaIdentifier(territory) {
  return territory.identifiers.find((item) => item.scheme === "ro.ins.siruta")?.value ?? null;
}

function nutsIdentifier(territory) {
  return territory.identifiers.find((item) => item.scheme === "eu.eurostat.nuts")?.value ?? null;
}

function schemaErrors(validate) {
  return (validate.errors ?? [])
    .map((item) => `${item.instancePath || "/"} ${item.message}`)
    .join("; ");
}

function createValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(territorySchema);
  return {
    contract: ajv.compile(contractSchema),
    manifest: ajv.compile(manifestSchema),
    territories: ajv.compile(territoriesSchema),
    territory: ajv.getSchema(territorySchema.$id)
  };
}

const validators = createValidators();

function majorVersion(value, field) {
  if (!SEMVER.test(value ?? "")) fail(`${field} must use semantic versioning`);
  return Number(value.split(".")[0]);
}

function validateCandidate(candidate, options = {}) {
  if (!candidate || typeof candidate !== "object") fail("candidate is required");
  if (options.requireExactSchemaVersion !== false && candidate.schemaVersion !== "1.0.0") {
    fail("candidate schemaVersion must be 1.0.0");
  }
  if (options.requireExactSchemaVersion === false && majorVersion(candidate.schemaVersion, "candidate schemaVersion") !== 1) {
    fail("candidate schemaVersion is not compatible with contract major 1");
  }
  if (typeof candidate.transformationVersion !== "string" || candidate.transformationVersion.length === 0) {
    fail("candidate transformationVersion is required");
  }
  if (!UUID_V7.test(candidate.sourceSnapshotId ?? "")) fail("candidate sourceSnapshotId must be UUIDv7");
  if (!SHA256.test(candidate.sourceSha256 ?? "")) fail("candidate sourceSha256 must be SHA-256");
  if (!Array.isArray(candidate.territories) || candidate.territories.length === 0) {
    fail("candidate must contain territories");
  }

  const ids = new Set();
  const sirutaCodes = new Set();
  const identifierOwners = new Map();
  let previousSiruta = -1;
  for (const territory of candidate.territories) {
    if (options.validateLocalTerritorySchema !== false && !validators.territory(territory)) {
      fail(`territory schema validation failed: ${schemaErrors(validators.territory)}`);
    }
    if (ids.has(territory.territoryId)) fail(`duplicate territoryId ${territory.territoryId}`);
    ids.add(territory.territoryId);
    const siruta = sirutaIdentifier(territory);
    if (!SIRUTA.test(siruta ?? "")) fail(`territory ${territory.territoryId} has no valid SIRUTA identifier`);
    if (sirutaCodes.has(siruta)) fail(`duplicate SIRUTA identifier ${siruta}`);
    sirutaCodes.add(siruta);
    if (Number(siruta) <= previousSiruta) fail("candidate territories must be sorted by numeric SIRUTA code");
    previousSiruta = Number(siruta);
    if (territory.provenance.sourceSnapshotId !== candidate.sourceSnapshotId) {
      fail(`territory ${siruta} references a different source snapshot`);
    }
    for (const identifier of territory.identifiers) {
      const key = `${identifier.scheme}\u0000${identifier.value}\u0000${identifier.validFrom ?? ""}`;
      if (identifierOwners.has(key)) {
        fail(`duplicate ${identifier.scheme} identifier ${identifier.value}`);
      }
      identifierOwners.set(key, territory.territoryId);
    }
  }
  for (const territory of candidate.territories) {
    for (const field of ["parentTerritoryId", "countyTerritoryId"]) {
      if (territory[field] !== null && !ids.has(territory[field])) {
        fail(`territory ${sirutaIdentifier(territory)} has an unknown ${field}`);
      }
    }
  }
  validateTerritoryGraph(candidate.territories);
}

export function validateTerritoryGraph(territories) {
  const byId = new Map(territories.map((territory) => [territory.territoryId, territory]));
  const complete = new Set();
  const active = new Set();

  function visit(territoryId) {
    if (complete.has(territoryId)) return;
    if (active.has(territoryId)) fail(`release payload contains a hierarchy cycle at ${territoryId}`);
    active.add(territoryId);
    const parentId = byId.get(territoryId)?.parentTerritoryId ?? null;
    if (parentId !== null) {
      if (!byId.has(parentId)) fail(`release payload contains an unresolved parentTerritoryId`);
      visit(parentId);
    }
    active.delete(territoryId);
    complete.add(territoryId);
  }

  for (const territory of territories) visit(territory.territoryId);
}

function validateDiff(diff, previousReleaseId, territoryCount) {
  if (!diff || typeof diff !== "object" || diff.skipped === true) fail("a non-skipped candidate diff is required");
  for (const field of ["added", "removed", "changed", "sourceRecordChanged"]) {
    if (!Array.isArray(diff[field])) fail(`diff.${field} must be an array`);
  }
  if (!Number.isSafeInteger(diff.unchanged) || diff.unchanged < 0) fail("diff.unchanged must be non-negative");
  if ((diff.findings ?? []).some((item) => new Set(["error", "blocker"]).has(item.severity))) {
    fail("candidate diff contains blocking findings");
  }
  if (previousReleaseId === null && diff.baseline !== false) fail("the first release requires a baseline diff");
  if (previousReleaseId !== null && diff.baseline !== true) fail("a subsequent release requires a prior baseline");
  if (diff.added.length + diff.changed.length + diff.unchanged !== territoryCount) {
    fail("diff totals do not match the candidate territory count");
  }
  if (diff.removed.length > 0) {
    fail("M3 does not retire territories; removals require the historical-governance milestone");
  }
}

export function unchangedReleaseDiff(territories) {
  return {
    skipped: false,
    baseline: true,
    added: [],
    removed: [],
    changed: [],
    sourceRecordChanged: [],
    unchanged: territories.length,
    findings: [],
    ratios: {
      totalDelta: 0,
      removed: 0,
      changed: 0
    }
  };
}

function validateMetadata(metadata, candidate, validationReport) {
  if (!RELEASE_ID.test(metadata?.releaseId ?? "")) fail("releaseId is invalid");
  const publishedAt = requireUtcTimestamp(metadata.publishedAt, "publishedAt");
  if (publishedAt.slice(0, 10) !== releaseDate(metadata.releaseId)) {
    fail("releaseId date must match publishedAt in UTC");
  }
  if (metadata.previousReleaseId !== null && !RELEASE_ID.test(metadata.previousReleaseId ?? "")) {
    fail("previousReleaseId must be null or a valid release ID");
  }
  if (!COMMIT_SHA.test(metadata.pipelineCommit ?? "")) fail("pipelineCommit must be a full lowercase commit SHA");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(metadata.repository ?? "")) {
    fail("repository must use owner/name form");
  }
  const approval = metadata.approval ?? {};
  if (!UUID_V7.test(approval.importRunId ?? "")) fail("approval.importRunId must be UUIDv7");
  if (!SHA256.test(approval.candidateSha256 ?? "")) fail("approval.candidateSha256 must be SHA-256");
  if (typeof approval.approvedBy !== "string" || approval.approvedBy.trim().length === 0) {
    fail("approval.approvedBy is required");
  }
  requireUtcTimestamp(approval.approvedAt, "approval.approvedAt");
  if (typeof approval.rationale !== "string" || approval.rationale.trim().length < 10) {
    fail("approval.rationale must contain at least 10 characters");
  }
  const source = metadata.source ?? {};
  if (source.snapshotId !== candidate.sourceSnapshotId) fail("release source snapshot differs from the candidate");
  if (source.sha256 !== candidate.sourceSha256) fail("release source hash differs from the candidate");
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes <= 0) fail("source.sizeBytes must be positive");
  requireUtcTimestamp(source.retrievedAt, "source.retrievedAt");
  for (const field of ["slug", "publisher", "uri"]) {
    if (typeof source[field] !== "string" || source[field].length === 0) fail(`source.${field} is required`);
  }
  try {
    const uri = new URL(source.uri);
    if (uri.protocol !== "https:" || uri.hostname !== "data.gov.ro" || uri.username || uri.password) {
      fail("source.uri must be an unauthenticated HTTPS data.gov.ro URI");
    }
  } catch {
    fail("source.uri must be a valid unauthenticated HTTPS data.gov.ro URI");
  }

  const candidateSha256 = canonicalSha256(candidate);
  if (approval.candidateSha256 !== candidateSha256) fail("approval does not match the candidate bytes");
  if (validationReport?.status !== "passed") fail("validation report must have passed");
  if (validationReport?.summary?.candidateSha256 !== candidateSha256) {
    fail("validation report does not match the candidate bytes");
  }
  const blocking = (validationReport.findings ?? []).filter((item) =>
    new Set(["error", "blocker"]).has(item.severity)
  );
  if (blocking.length > 0) fail("validation report contains blocking findings");
}

function csvCell(value) {
  if (value === null || value === undefined) return "\"\"";
  const text = typeof value === "boolean" ? String(value) : String(value);
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

export function territoriesCsv(territories) {
  const headers = [
    "territory_id",
    "official_name",
    "normalized_name",
    "short_name",
    "territory_type",
    "administrative_role",
    "administrative_level",
    "parent_territory_id",
    "county_territory_id",
    "is_uat",
    "is_locality",
    "is_county_seat",
    "rank",
    "status",
    "valid_from",
    "valid_to",
    "siruta",
    "nuts",
    "source_snapshot_id",
    "source_record_hash",
    "transformation_version"
  ];
  const rows = territories.map((territory) => [
    territory.territoryId,
    territory.officialName,
    territory.normalizedName,
    territory.shortName,
    territory.territoryType,
    territory.administrativeRole,
    territory.administrativeLevel,
    territory.parentTerritoryId,
    territory.countyTerritoryId,
    territory.isUat,
    territory.isLocality,
    territory.isCountySeat,
    territory.rank,
    territory.status,
    territory.validFrom,
    territory.validTo,
    sirutaIdentifier(territory),
    nutsIdentifier(territory),
    territory.provenance.sourceSnapshotId,
    territory.provenance.sourceRecordHash,
    territory.provenance.transformationVersion
  ]);
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export function territoriesNdjson(territories) {
  return `${territories.map((territory) => canonicalJson(territory)).join("\n")}\n`;
}

export function territoryIdentifiersCsv(territories) {
  const headers = [
    "territory_id",
    "scheme",
    "value",
    "status",
    "valid_from",
    "valid_to"
  ];
  const rows = territories.flatMap((territory) =>
    [...territory.identifiers]
      .sort((left, right) =>
        left.scheme.localeCompare(right.scheme) ||
        left.value.localeCompare(right.value) ||
        (left.validFrom ?? "").localeCompare(right.validFrom ?? "")
      )
      .map((identifier) => [
        territory.territoryId,
        identifier.scheme,
        identifier.value,
        identifier.status,
        identifier.validFrom,
        identifier.validTo
      ])
  );
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function publicContractDescriptor(schemaVersion) {
  return {
    $schema: contractSchema.$id,
    name: PUBLIC_CONTRACT_NAME,
    contractVersion: PUBLIC_CONTRACT_VERSION,
    schemaVersion,
    compatibility: {
      model: "semantic-versioning",
      supportedMajor: 1,
      minorChanges: "additive-only",
      patchChanges: "non-semantic-fixes-only",
      unknownFields: "validate-against-bundled-schema",
      breakingChanges: "new-major-required"
    },
    artifacts: [
      {
        name: "SHA256SUMS",
        purpose: "checksums",
        mediaType: "text/plain; charset=utf-8",
        required: true,
        schema: null
      },
      {
        name: "changelog.json",
        purpose: "release-diff",
        mediaType: MEDIA_TYPES["changelog.json"],
        required: true,
        schema: null
      },
      {
        name: "contract.json",
        purpose: "contract",
        mediaType: MEDIA_TYPES["contract.json"],
        required: true,
        schema: "contract.schema.json"
      },
      {
        name: "contract.schema.json",
        purpose: "contract-schema",
        mediaType: MEDIA_TYPES["contract.schema.json"],
        required: true,
        schema: null
      },
      {
        name: "manifest.json",
        purpose: "release-manifest",
        mediaType: "application/json",
        required: true,
        schema: "release-manifest.schema.json"
      },
      {
        name: "release-manifest.schema.json",
        purpose: "release-manifest-schema",
        mediaType: MEDIA_TYPES["release-manifest.schema.json"],
        required: true,
        schema: null
      },
      {
        name: "territories.csv",
        purpose: "tabular-territories",
        mediaType: MEDIA_TYPES["territories.csv"],
        required: true,
        schema: null
      },
      {
        name: "territories.json",
        purpose: "territory-payload",
        mediaType: MEDIA_TYPES["territories.json"],
        required: true,
        schema: "territories.schema.json"
      },
      {
        name: "territories.ndjson",
        purpose: "streaming-territories",
        mediaType: MEDIA_TYPES["territories.ndjson"],
        required: true,
        schema: "territory.schema.json"
      },
      {
        name: "territories.schema.json",
        purpose: "territory-payload-schema",
        mediaType: MEDIA_TYPES["territories.schema.json"],
        required: true,
        schema: null
      },
      {
        name: "territory-identifiers.csv",
        purpose: "identifier-mapping",
        mediaType: MEDIA_TYPES["territory-identifiers.csv"],
        required: true,
        schema: null
      },
      {
        name: "territory.schema.json",
        purpose: "territory-schema",
        mediaType: MEDIA_TYPES["territory.schema.json"],
        required: true,
        schema: null
      },
      {
        name: "validation-report.json",
        purpose: "validation-report",
        mediaType: MEDIA_TYPES["validation-report.json"],
        required: true,
        schema: null
      }
    ],
    consumerReport: {
      statusValues: ["accepted", "rejected"],
      acceptedField: "accepted",
      rejectedField: "rejected",
      conflictsField: "conflicts",
      activeReleaseField: "releaseId",
      activeManifestSha256Field: "manifestSha256"
    }
  };
}

function artifactMetadata(name, bytes, baseUri) {
  return {
    name,
    mediaType: MEDIA_TYPES[name],
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    uri: `${baseUri}/${name}`
  };
}

function releaseCounts(territories) {
  const count = (role) => territories.filter((item) => item.administrativeRole === role).length;
  return {
    territories: territories.length,
    countyUats: count("county_uat"),
    localUats: count("local_uat"),
    administrativeSubdivisions: count("administrative_subdivision"),
    localities: count("locality")
  };
}

export function buildReleaseBundle({ candidate, validationReport, diff, metadata }) {
  validateCandidate(candidate);
  validateMetadata(metadata, candidate, validationReport);
  validateDiff(diff, metadata.previousReleaseId, candidate.territories.length);

  const releaseTag = `siruta-${metadata.releaseId}`;
  const baseUri = `https://github.com/${metadata.repository}/releases/download/${releaseTag}`;
  const candidateSha256 = canonicalSha256(candidate);
  const publicTerritories = {
    releaseId: metadata.releaseId,
    contractVersion: PUBLIC_CONTRACT_VERSION,
    schemaVersion: candidate.schemaVersion,
    transformationVersion: candidate.transformationVersion,
    sourceSnapshotId: candidate.sourceSnapshotId,
    sourceSha256: candidate.sourceSha256,
    candidateSha256,
    territories: candidate.territories
  };
  if (!validators.territories(publicTerritories)) {
    fail(`territories payload schema validation failed: ${schemaErrors(validators.territories)}`);
  }
  const changelog = {
    releaseId: metadata.releaseId,
    previousReleaseId: metadata.previousReleaseId,
    publishedAt: metadata.publishedAt,
    baseline: diff.baseline,
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
    sourceRecordChanged: diff.sourceRecordChanged,
    unchanged: diff.unchanged,
    ratios: diff.ratios ?? null
  };
  const contract = publicContractDescriptor(candidate.schemaVersion);
  if (!validators.contract(contract)) {
    fail(`contract schema validation failed: ${schemaErrors(validators.contract)}`);
  }
  const artifacts = new Map([
    ["contract.json", Buffer.from(canonicalJsonPretty(contract), "utf8")],
    ["contract.schema.json", Buffer.from(canonicalJsonPretty(contractSchema), "utf8")],
    ["release-manifest.schema.json", Buffer.from(canonicalJsonPretty(manifestSchema), "utf8")],
    ["territories.json", Buffer.from(canonicalJsonPretty(publicTerritories), "utf8")],
    ["territories.ndjson", Buffer.from(territoriesNdjson(candidate.territories), "utf8")],
    ["territories.schema.json", Buffer.from(canonicalJsonPretty(territoriesSchema), "utf8")],
    ["territories.csv", Buffer.from(territoriesCsv(candidate.territories), "utf8")],
    ["territory-identifiers.csv", Buffer.from(territoryIdentifiersCsv(candidate.territories), "utf8")],
    ["territory.schema.json", Buffer.from(canonicalJsonPretty(territorySchema), "utf8")],
    ["validation-report.json", Buffer.from(canonicalJsonPretty(validationReport), "utf8")],
    ["changelog.json", Buffer.from(canonicalJsonPretty(changelog), "utf8")]
  ]);
  const artifactEntries = [...artifacts.entries()]
    .map(([name, bytes]) => artifactMetadata(name, bytes, baseUri))
    .sort((left, right) => left.name.localeCompare(right.name));
  const warningCount = (validationReport.findings ?? []).filter((item) => item.severity === "warning").length;
  const manifest = {
    releaseId: metadata.releaseId,
    releaseTag,
    contract: {
      name: PUBLIC_CONTRACT_NAME,
      version: PUBLIC_CONTRACT_VERSION,
      descriptorArtifact: "contract.json",
      compatibility: "semver-major",
      schemas: {
        contract: "contract.schema.json",
        manifest: "release-manifest.schema.json",
        territories: "territories.schema.json",
        territory: "territory.schema.json"
      }
    },
    schemaVersion: candidate.schemaVersion,
    transformationVersion: candidate.transformationVersion,
    publishedAt: metadata.publishedAt,
    previousReleaseId: metadata.previousReleaseId,
    pipelineCommit: metadata.pipelineCommit,
    candidateSha256,
    approval: {
      importRunId: metadata.approval.importRunId,
      approvedBy: metadata.approval.approvedBy,
      approvedAt: metadata.approval.approvedAt,
      rationale: metadata.approval.rationale,
      candidateSha256
    },
    license: DATA_LICENSE,
    sourceSnapshots: [{
      snapshotId: metadata.source.snapshotId,
      source: metadata.source.slug,
      publisher: metadata.source.publisher,
      retrievedAt: metadata.source.retrievedAt,
      sha256: metadata.source.sha256,
      sizeBytes: metadata.source.sizeBytes,
      uri: metadata.source.uri
    }],
    counts: releaseCounts(candidate.territories),
    quality: {
      status: warningCount > 0 ? "passed_with_warnings" : "passed",
      errors: 0,
      warnings: warningCount,
      reportArtifact: "validation-report.json"
    },
    changelogArtifact: "changelog.json",
    checksumArtifact: "SHA256SUMS",
    artifacts: artifactEntries
  };
  if (!validators.manifest(manifest)) {
    fail(`manifest schema validation failed: ${schemaErrors(validators.manifest)}`);
  }
  if (new Set(manifest.artifacts.map((item) => item.name)).size !== manifest.artifacts.length) {
    fail("manifest artifact names must be unique");
  }
  const manifestBytes = Buffer.from(canonicalJsonPretty(manifest), "utf8");
  artifacts.set("manifest.json", manifestBytes);
  const checksumLines = [...artifacts.entries()]
    .map(([name, bytes]) => ({ name, hash: sha256(bytes) }))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => `${item.hash}  ${item.name}`);
  const checksumBytes = Buffer.from(`${checksumLines.join("\n")}\n`, "utf8");
  artifacts.set("SHA256SUMS", checksumBytes);

  return {
    releaseTag,
    manifest,
    manifestSha256: sha256(manifestBytes),
    artifacts
  };
}

function jsonArtifact(bundle, name) {
  const bytes = bundle.artifacts.get(name);
  if (!bytes) fail(`release bundle lacks ${name}`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${name} is not valid JSON`);
  }
}

function createBundledValidators(bundle) {
  const bundledSchemas = {
    contract: jsonArtifact(bundle, "contract.schema.json"),
    manifest: jsonArtifact(bundle, "release-manifest.schema.json"),
    territories: jsonArtifact(bundle, "territories.schema.json"),
    territory: jsonArtifact(bundle, "territory.schema.json")
  };
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  try {
    ajv.addSchema(bundledSchemas.territory);
    return {
      contract: ajv.compile(bundledSchemas.contract),
      manifest: ajv.compile(bundledSchemas.manifest),
      territories: ajv.compile(bundledSchemas.territories),
      territory: ajv.getSchema(bundledSchemas.territory.$id)
    };
  } catch (error) {
    fail(`bundled JSON Schemas could not be compiled: ${error.message}`);
  }
}

export function assertPublicContractCompatibility(contract, manifest = null) {
  if (!contract || contract.name !== PUBLIC_CONTRACT_NAME) {
    fail(`unsupported public contract: ${contract?.name ?? "missing"}`);
  }
  if (majorVersion(contract.contractVersion, "contractVersion") !== 1) {
    fail(`unsupported public contract major: ${contract.contractVersion}`);
  }
  if (majorVersion(contract.schemaVersion, "schemaVersion") !== 1) {
    fail(`unsupported territory schema major: ${contract.schemaVersion}`);
  }
  if (
    contract.compatibility?.model !== "semantic-versioning" ||
    contract.compatibility?.supportedMajor !== 1 ||
    contract.compatibility?.breakingChanges !== "new-major-required"
  ) {
    fail("public contract compatibility policy is incomplete");
  }
  if (manifest) {
    if (
      manifest.contract?.name !== contract.name ||
      manifest.contract?.version !== contract.contractVersion ||
      manifest.schemaVersion !== contract.schemaVersion
    ) {
      fail("manifest and public contract versions differ");
    }
  }
}

export function verifyReleaseBundle(bundle) {
  if (!(bundle?.artifacts instanceof Map)) fail("release bundle artifacts must be a Map");
  const manifestBytes = bundle.artifacts.get("manifest.json");
  const checksumsBytes = bundle.artifacts.get("SHA256SUMS");
  if (!manifestBytes || !checksumsBytes) fail("release bundle lacks manifest.json or SHA256SUMS");

  const expected = new Map();
  for (const line of checksumsBytes.toString("utf8").trimEnd().split("\n")) {
    const match = line.match(/^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/);
    if (!match || expected.has(match[2])) fail("SHA256SUMS contains an invalid or duplicate entry");
    expected.set(match[2], match[1]);
  }
  if (expected.has("SHA256SUMS")) fail("SHA256SUMS must not contain a circular self-hash");
  if (expected.size !== bundle.artifacts.size - 1) fail("SHA256SUMS does not cover the exact bundle file set");
  for (const name of bundle.artifacts.keys()) {
    if (name !== "SHA256SUMS" && !expected.has(name)) fail(`SHA256SUMS omits artifact: ${name}`);
  }
  for (const [name, hash] of expected) {
    const bytes = bundle.artifacts.get(name);
    if (!bytes || sha256(bytes) !== hash) fail(`artifact checksum mismatch: ${name}`);
  }

  const manifest = jsonArtifact(bundle, "manifest.json");
  const contract = jsonArtifact(bundle, "contract.json");
  const payload = jsonArtifact(bundle, "territories.json");
  const bundledValidators = createBundledValidators(bundle);
  if (!bundledValidators.contract(contract)) {
    fail(`contract schema validation failed: ${schemaErrors(bundledValidators.contract)}`);
  }
  if (!bundledValidators.manifest(manifest)) {
    fail(`manifest schema validation failed: ${schemaErrors(bundledValidators.manifest)}`);
  }
  if (!bundledValidators.territories(payload)) {
    fail(`territories payload schema validation failed: ${schemaErrors(bundledValidators.territories)}`);
  }
  assertPublicContractCompatibility(contract, manifest);

  const contractFiles = contract.artifacts.map((artifact) => artifact.name);
  if (
    new Set(contractFiles).size !== contractFiles.length ||
    JSON.stringify([...contractFiles].sort()) !== JSON.stringify([...bundle.artifacts.keys()].sort())
  ) {
    fail("contract descriptor does not cover the exact bundle file set");
  }
  if (manifest.sourceSnapshots.length !== 1) fail("SIRUTA releases must reference exactly one source snapshot");
  if (manifest.approval.candidateSha256 !== manifest.candidateSha256) {
    fail("manifest approval and candidate hashes differ");
  }
  const artifactNames = manifest.artifacts.map((item) => item.name);
  if (new Set(artifactNames).size !== artifactNames.length) fail("manifest artifact names must be unique");
  const expectedManifestArtifacts = [...bundle.artifacts.keys()]
    .filter((name) => !new Set(["manifest.json", "SHA256SUMS"]).has(name))
    .sort();
  if (JSON.stringify([...artifactNames].sort()) !== JSON.stringify(expectedManifestArtifacts)) {
    fail("manifest does not cover the exact non-circular artifact set");
  }
  for (const artifact of manifest.artifacts) {
    const uri = new URL(artifact.uri);
    if (
      uri.protocol !== "https:" ||
      uri.hostname !== "github.com" ||
      !uri.pathname.endsWith(`/releases/download/${manifest.releaseTag}/${artifact.name}`)
    ) fail(`manifest artifact URI is not content-addressable by release tag: ${artifact.name}`);
  }
  for (const artifact of manifest.artifacts) {
    const bytes = bundle.artifacts.get(artifact.name);
    if (!bytes || bytes.length !== artifact.sizeBytes || sha256(bytes) !== artifact.sha256) {
      fail(`manifest artifact mismatch: ${artifact.name}`);
    }
  }
  if (
    payload.releaseId !== manifest.releaseId ||
    payload.contractVersion !== manifest.contract.version ||
    payload.schemaVersion !== manifest.schemaVersion ||
    payload.transformationVersion !== manifest.transformationVersion ||
    payload.sourceSnapshotId !== manifest.sourceSnapshots[0].snapshotId ||
    payload.sourceSha256 !== manifest.sourceSnapshots[0].sha256 ||
    payload.candidateSha256 !== manifest.candidateSha256 ||
    payload.territories.length !== manifest.counts.territories
  ) {
    fail("territories.json metadata does not match the manifest");
  }
  const candidate = {
    schemaVersion: manifest.schemaVersion,
    transformationVersion: manifest.transformationVersion,
    sourceSnapshotId: manifest.sourceSnapshots[0].snapshotId,
    sourceSha256: manifest.sourceSnapshots[0].sha256,
    territories: payload.territories
  };
  validateCandidate(candidate, {
    requireExactSchemaVersion: false,
    validateLocalTerritorySchema: false
  });
  if (canonicalSha256(candidate) !== manifest.candidateSha256) {
    fail("territories.json does not reconstruct the approved candidate hash");
  }
  const expectedNdjson = Buffer.from(territoriesNdjson(payload.territories), "utf8");
  if (!bundle.artifacts.get("territories.ndjson")?.equals(expectedNdjson)) {
    fail("territories.ndjson differs from territories.json");
  }
  const expectedIdentifiers = Buffer.from(territoryIdentifiersCsv(payload.territories), "utf8");
  if (!bundle.artifacts.get("territory-identifiers.csv")?.equals(expectedIdentifiers)) {
    fail("territory-identifiers.csv differs from territories.json");
  }
  return {
    manifest,
    manifestSha256: sha256(manifestBytes),
    contract,
    payload
  };
}

export { DATA_LICENSE };
