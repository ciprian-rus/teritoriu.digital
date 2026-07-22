import { createHash } from "node:crypto";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import manifestSchema from "../../../../schemas/release-manifest.schema.json" with { type: "json" };
import territorySchema from "../../../../schemas/territory.schema.json" with { type: "json" };
import {
  canonicalJsonPretty,
  canonicalSha256
} from "../canonical/canonical-json.mjs";

const RELEASE_ID = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]*$/;
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
  "territories.json": "application/json",
  "territories.csv": "text/csv; charset=utf-8",
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
  return {
    manifest: ajv.compile(manifestSchema),
    territory: ajv.compile(territorySchema)
  };
}

const validators = createValidators();

function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") fail("candidate is required");
  if (candidate.schemaVersion !== "1.0.0") fail("candidate schemaVersion must be 1.0.0");
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
  let previousSiruta = -1;
  for (const territory of candidate.territories) {
    if (!validators.territory(territory)) {
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
  }
  for (const territory of candidate.territories) {
    for (const field of ["parentTerritoryId", "countyTerritoryId"]) {
      if (territory[field] !== null && !ids.has(territory[field])) {
        fail(`territory ${sirutaIdentifier(territory)} has an unknown ${field}`);
      }
    }
  }
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
    schemaVersion: candidate.schemaVersion,
    transformationVersion: candidate.transformationVersion,
    sourceSnapshotId: candidate.sourceSnapshotId,
    sourceSha256: candidate.sourceSha256,
    candidateSha256,
    territories: candidate.territories
  };
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
  const artifacts = new Map([
    ["territories.json", Buffer.from(canonicalJsonPretty(publicTerritories), "utf8")],
    ["territories.csv", Buffer.from(territoriesCsv(candidate.territories), "utf8")],
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

export function verifyReleaseBundle(bundle) {
  const manifestBytes = bundle.artifacts.get("manifest.json");
  const checksumsBytes = bundle.artifacts.get("SHA256SUMS");
  if (!manifestBytes || !checksumsBytes) fail("release bundle lacks manifest.json or SHA256SUMS");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (!validators.manifest(manifest)) fail(`manifest schema validation failed: ${schemaErrors(validators.manifest)}`);
  if (manifest.sourceSnapshots.length !== 1) fail("SIRUTA releases must reference exactly one source snapshot");
  if (manifest.approval.candidateSha256 !== manifest.candidateSha256) {
    fail("manifest approval and candidate hashes differ");
  }
  const artifactNames = manifest.artifacts.map((item) => item.name);
  if (new Set(artifactNames).size !== artifactNames.length) fail("manifest artifact names must be unique");
  for (const artifact of manifest.artifacts) {
    const uri = new URL(artifact.uri);
    if (
      uri.protocol !== "https:" ||
      uri.hostname !== "github.com" ||
      !uri.pathname.endsWith(`/releases/download/${manifest.releaseTag}/${artifact.name}`)
    ) fail(`manifest artifact URI is not content-addressable by release tag: ${artifact.name}`);
  }
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
  for (const artifact of manifest.artifacts) {
    const bytes = bundle.artifacts.get(artifact.name);
    if (!bytes || bytes.length !== artifact.sizeBytes || sha256(bytes) !== artifact.sha256) {
      fail(`manifest artifact mismatch: ${artifact.name}`);
    }
  }
  const candidate = {
    schemaVersion: manifest.schemaVersion,
    transformationVersion: manifest.transformationVersion,
    sourceSnapshotId: manifest.sourceSnapshots[0].snapshotId,
    sourceSha256: manifest.sourceSnapshots[0].sha256,
    territories: JSON.parse(bundle.artifacts.get("territories.json").toString("utf8")).territories
  };
  validateCandidate(candidate);
  if (canonicalSha256(candidate) !== manifest.candidateSha256) {
    fail("territories.json does not reconstruct the approved candidate hash");
  }
  return { manifest, manifestSha256: sha256(manifestBytes) };
}

export { DATA_LICENSE };
