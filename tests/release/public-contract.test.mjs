import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  activeReleaseMetadata,
  importReleaseReadModel
} from "../../packages/consumer/src/import-release.mjs";
import {
  assertConsumerCompatibility,
  verifyConsumerRelease
} from "../../packages/consumer/src/verify-release.mjs";
import {
  buildReleaseBundle,
  territoriesNdjson,
  territoryIdentifiersCsv,
  validateTerritoryGraph
} from "../../packages/pipeline/src/release/artifact-builder.mjs";
import {
  canonicalJsonPretty,
  canonicalSha256
} from "../../packages/pipeline/src/canonical/canonical-json.mjs";

const SNAPSHOT_ID = "018f0000-0000-7000-8000-0000000000aa";
const SOURCE_SHA256 = "a".repeat(64);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function territory(index, siruta, officialName, territoryType, administrativeRole, parentIndex = null) {
  const territoryId = `018f0000-0000-7000-8000-${String(index).padStart(12, "0")}`;
  const parentTerritoryId = parentIndex === null
    ? null
    : `018f0000-0000-7000-8000-${String(parentIndex).padStart(12, "0")}`;
  return {
    territoryId,
    officialName,
    normalizedName: officialName.toLocaleLowerCase("ro-RO"),
    shortName: null,
    territoryType,
    administrativeRole,
    administrativeLevel: administrativeRole === "county_uat" ? 1 : administrativeRole === "locality" ? 3 : 2,
    parentTerritoryId,
    countyTerritoryId: administrativeRole === "county_uat"
      ? territoryId
      : "018f0000-0000-7000-8000-000000000001",
    isUat: new Set(["county_uat", "local_uat", "administrative_subdivision"]).has(administrativeRole),
    isLocality: administrativeRole !== "county_uat",
    isCountySeat: false,
    rank: null,
    status: "active",
    validFrom: "2025-01-01",
    validTo: null,
    identifiers: [{
      scheme: "ro.ins.siruta",
      value: siruta,
      status: "active",
      validFrom: "2025-01-01",
      validTo: null
    }],
    provenance: {
      sourceSnapshotId: SNAPSHOT_ID,
      sourceRecordHash: index.toString(16).padStart(64, "0"),
      transformationVersion: "siruta-contract-fixture.1.0.0"
    }
  };
}

function contractTerritories() {
  return [
    territory(1, "100", "JUDEȚ TEST", "county", "county_uat"),
    territory(2, "101", "MUNICIPIU TEST", "municipality", "local_uat", 1),
    territory(3, "102", "ORAȘ TEST", "city", "local_uat", 1),
    territory(4, "103", "COMUNĂ TEST", "commune", "local_uat", 1),
    territory(5, "104", "SECTOR TEST", "sector", "administrative_subdivision", 1),
    territory(6, "105", "LOCALITATE COMPONENTĂ TEST", "component_locality", "locality", 2)
  ];
}

function releaseInput() {
  const territories = contractTerritories();
  const candidate = {
    schemaVersion: "1.0.0",
    transformationVersion: "siruta-contract-fixture.1.0.0",
    sourceSnapshotId: SNAPSHOT_ID,
    sourceSha256: SOURCE_SHA256,
    territories
  };
  const candidateSha256 = canonicalSha256(candidate);
  return {
    candidate,
    validationReport: {
      status: "passed",
      summary: { candidateSha256 },
      findings: []
    },
    diff: {
      skipped: false,
      baseline: false,
      added: territories.map((item) => item.identifiers[0].value),
      removed: [],
      changed: [],
      sourceRecordChanged: [],
      unchanged: 0,
      findings: [],
      ratios: null
    },
    metadata: {
      releaseId: "2026.07.23.9",
      publishedAt: "2026-07-23T18:00:00.000Z",
      previousReleaseId: null,
      pipelineCommit: "d".repeat(40),
      repository: "ciprian-rus/teritoriu.digital",
      approval: {
        importRunId: "018f0000-0000-7000-8000-0000000000cc",
        candidateSha256,
        approvedBy: "reviewer",
        approvedAt: "2026-07-23T17:30:00.000Z",
        rationale: "Fixture-ul contractului public a trecut verificarea completă."
      },
      source: {
        snapshotId: SNAPSHOT_ID,
        sha256: SOURCE_SHA256,
        sizeBytes: 1158236,
        retrievedAt: "2026-07-23T14:00:00.000Z",
        uri: "https://data.gov.ro/dataset/example/download/siruta.xlsx",
        slug: "ro.ins.siruta",
        publisher: "Institutul Național de Statistică"
      }
    }
  };
}

function repackPayload(bundle, territories) {
  const artifacts = new Map(bundle.artifacts);
  const payload = JSON.parse(artifacts.get("territories.json").toString("utf8"));
  const manifest = JSON.parse(artifacts.get("manifest.json").toString("utf8"));
  const candidate = {
    schemaVersion: payload.schemaVersion,
    transformationVersion: payload.transformationVersion,
    sourceSnapshotId: payload.sourceSnapshotId,
    sourceSha256: payload.sourceSha256,
    territories
  };
  payload.territories = territories;
  payload.candidateSha256 = canonicalSha256(candidate);
  manifest.candidateSha256 = payload.candidateSha256;
  manifest.approval.candidateSha256 = payload.candidateSha256;
  manifest.counts.territories = territories.length;
  artifacts.set("territories.json", Buffer.from(canonicalJsonPretty(payload), "utf8"));
  artifacts.set("territories.ndjson", Buffer.from(territoriesNdjson(territories), "utf8"));
  artifacts.set("territory-identifiers.csv", Buffer.from(territoryIdentifiersCsv(territories), "utf8"));
  for (const entry of manifest.artifacts) {
    const bytes = artifacts.get(entry.name);
    if (bytes) {
      entry.sizeBytes = bytes.length;
      entry.sha256 = sha256(bytes);
    }
  }
  artifacts.set("manifest.json", Buffer.from(canonicalJsonPretty(manifest), "utf8"));
  const checksumLines = [...artifacts.entries()]
    .filter(([name]) => name !== "SHA256SUMS")
    .map(([name, bytes]) => ({ name, hash: sha256(bytes) }))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => `${item.hash}  ${item.name}`);
  artifacts.set("SHA256SUMS", Buffer.from(`${checksumLines.join("\n")}\n`, "utf8"));
  return { artifacts };
}

test("publishes a machine-readable v1 contract and the six required territory fixture types", () => {
  const bundle = buildReleaseBundle(releaseInput());
  const verification = verifyConsumerRelease(bundle);
  assert.equal(verification.report.status, "accepted");
  assert.equal(verification.report.accepted, 6);
  assert.equal(verification.report.rejected, 0);
  assert.equal(verification.report.conflicts, 0);
  assert.equal(verification.contract.contractVersion, "1.0.0");
  assert.deepEqual(
    new Set(verification.payload.territories.map((item) => item.territoryType)),
    new Set(["county", "municipality", "city", "commune", "sector", "component_locality"])
  );
  assert.equal(bundle.artifacts.get("territories.ndjson").toString("utf8").trimEnd().split("\n").length, 6);
  assert.equal(bundle.artifacts.get("territory-identifiers.csv").toString("utf8").trimEnd().split("\n").length, 7);
});

test("pins release and manifest hashes and reports the active consumer version", () => {
  const bundle = buildReleaseBundle(releaseInput());
  const verification = verifyConsumerRelease(bundle);
  const model = importReleaseReadModel(bundle, null, {
    expectedReleaseId: verification.manifest.releaseId,
    expectedManifestSha256: verification.manifestSha256
  });
  assert.deepEqual(activeReleaseMetadata(model), {
    releaseId: verification.manifest.releaseId,
    manifestSha256: verification.manifestSha256,
    importedAt: verification.manifest.publishedAt
  });
  assert.throws(
    () => verifyConsumerRelease(bundle, { expectedManifestSha256: "f".repeat(64) }),
    (error) => error.report.status === "rejected" && error.report.rejected === 6
  );
});

test("rejects incompatible contract majors before import", () => {
  const bundle = buildReleaseBundle(releaseInput());
  const contract = JSON.parse(bundle.artifacts.get("contract.json").toString("utf8"));
  contract.contractVersion = "2.0.0";
  assert.throws(
    () => assertConsumerCompatibility(contract),
    /unsupported public contract major/
  );
});

test("consumer graph validation rejects duplicates, unresolved parents and cycles", () => {
  const base = buildReleaseBundle(releaseInput());

  const duplicate = contractTerritories();
  duplicate[1].territoryId = duplicate[0].territoryId;
  assert.throws(
    () => verifyConsumerRelease(repackPayload(base, duplicate)),
    (error) => /duplicate territoryId/.test(error.message) && error.report.conflicts === 1
  );

  const unresolved = contractTerritories();
  unresolved[1].parentTerritoryId = "018f0000-0000-7000-8000-999999999999";
  assert.throws(
    () => verifyConsumerRelease(repackPayload(base, unresolved)),
    (error) => /unknown parentTerritoryId/.test(error.message) && error.report.conflicts === 1
  );

  const cyclic = contractTerritories();
  cyclic[0].parentTerritoryId = cyclic[5].territoryId;
  assert.throws(
    () => verifyConsumerRelease(repackPayload(base, cyclic)),
    (error) => /hierarchy cycle/.test(error.message) && error.report.conflicts === 1
  );

  assert.throws(() => validateTerritoryGraph(cyclic), /hierarchy cycle/);
});
