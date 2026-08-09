import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildSirutaCandidateFromParsed } from "../../packages/pipeline/src/canonical/build-candidate.mjs";
import {
  buildReleaseBundle,
  unchangedReleaseDiff,
  verifyReleaseBundle
} from "../../packages/pipeline/src/release/artifact-builder.mjs";
import { readReleaseBundle, writeReleaseBundle } from "../../packages/pipeline/src/release/bundle-files.mjs";
import { buildGeometriesArtifact } from "../../packages/pipeline/src/release/geometry-artifact.mjs";
import {
  CONFIGURATION,
  SNAPSHOT_ID,
  SOURCE_SHA256,
  parsedFixture,
  uuidSequence
} from "../canonical/fixture.mjs";

const IMPORT_RUN_ID = "018f0000-0000-7000-8000-0000000000cc";
const PIPELINE_COMMIT = "d".repeat(40);

function candidateResult() {
  return buildSirutaCandidateFromParsed(parsedFixture(), CONFIGURATION, {
    sourceSnapshotId: SNAPSHOT_ID,
    sourceSha256: SOURCE_SHA256,
    uuidFactory: uuidSequence()
  });
}

function releaseInput(overrides = {}) {
  const result = candidateResult();
  return {
    candidate: result.candidate,
    validationReport: {
      status: result.status,
      summary: result.summary,
      findings: result.findings
    },
    diff: result.diff,
    metadata: {
      releaseId: "2026.07.22.1",
      publishedAt: "2026-07-22T16:00:00.000Z",
      previousReleaseId: null,
      pipelineCommit: PIPELINE_COMMIT,
      repository: "ciprian-rus/teritoriu.digital",
      approval: {
        importRunId: IMPORT_RUN_ID,
        candidateSha256: result.summary.candidateSha256,
        approvedBy: "reviewer",
        approvedAt: "2026-07-22T15:30:00.000Z",
        rationale: "Profilul și identitățile au fost verificate integral."
      },
      source: {
        snapshotId: SNAPSHOT_ID,
        sha256: SOURCE_SHA256,
        sizeBytes: 1158236,
        retrievedAt: "2026-07-22T14:00:00.000Z",
        uri: "https://data.gov.ro/dataset/example/download/siruta.xlsx",
        slug: "ro.ins.siruta",
        publisher: "Institutul Național de Statistică"
      },
      ...overrides
    }
  };
}

test("builds byte-identical JSON, CSV, manifest, changelog and checksums", () => {
  const first = buildReleaseBundle(releaseInput());
  const second = buildReleaseBundle(releaseInput());
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.deepEqual([...first.artifacts.keys()].sort(), [
    "SHA256SUMS",
    "changelog.json",
    "contract.json",
    "contract.schema.json",
    "manifest.json",
    "release-manifest.schema.json",
    "territories.csv",
    "territories.json",
    "territories.ndjson",
    "territories.schema.json",
    "territory-identifiers.csv",
    "territory.schema.json",
    "validation-report.json"
  ]);
  for (const [name, bytes] of first.artifacts) assert.deepEqual(bytes, second.artifacts.get(name));

  const verification = verifyReleaseBundle(first);
  assert.equal(verification.manifest.releaseTag, "siruta-2026.07.22.1");
  assert.equal(verification.manifest.counts.territories, 3);
  assert.equal(verification.manifest.quality.status, "passed_with_warnings");
  assert.equal(verification.manifest.license.spdx, "CC-BY-4.0");
  assert.equal(verification.contract.contractVersion, "1.2.0");
  assert.equal(verification.payload.contractVersion, "1.2.0");
  const csv = first.artifacts.get("territories.csv").toString("utf8");
  assert.match(csv, /"JUDEȚUL TEST"/u);
  assert.equal(csv.endsWith("\n"), true);
  assert.equal(first.artifacts.get("territories.ndjson").toString("utf8").trimEnd().split("\n").length, 3);
  assert.match(first.artifacts.get("territory-identifiers.csv").toString("utf8"), /ro\.ins\.siruta/);
});

test("blocks provenance drift, failed validation, bad dates and unsupported removals", () => {
  const hashDrift = releaseInput();
  hashDrift.metadata.approval.candidateSha256 = "f".repeat(64);
  assert.throws(() => buildReleaseBundle(hashDrift), /approval does not match/);

  const invalid = releaseInput();
  invalid.validationReport.status = "blocked";
  assert.throws(() => buildReleaseBundle(invalid), /must have passed/);

  assert.throws(
    () => buildReleaseBundle(releaseInput({ publishedAt: "2026-07-23T00:00:00.000Z" })),
    /date must match/
  );

  const removed = releaseInput();
  removed.diff.removed = ["99"];
  assert.throws(() => buildReleaseBundle(removed), /does not retire territories/);
});

test("builds a contract-only follow-up release only as an unchanged candidate", () => {
  const input = releaseInput({
    releaseId: "2026.07.23.1",
    publishedAt: "2026-07-23T16:00:00.000Z",
    previousReleaseId: "2026.07.22.1"
  });
  input.diff = unchangedReleaseDiff(input.candidate.territories);
  const bundle = buildReleaseBundle(input);
  assert.equal(bundle.manifest.previousReleaseId, "2026.07.22.1");
  assert.equal(JSON.parse(bundle.artifacts.get("changelog.json")).unchanged, 3);
  assert.deepEqual(JSON.parse(bundle.artifacts.get("changelog.json")).changed, []);
});

test("blocks duplicate canonical identifiers before release publication", () => {
  const duplicate = releaseInput();
  const nuts = duplicate.candidate.territories[0].identifiers.find(
    (identifier) => identifier.scheme === "eu.eurostat.nuts"
  );
  duplicate.candidate.territories[1].identifiers.push(structuredClone(nuts));
  assert.throws(
    () => buildReleaseBundle(duplicate),
    /duplicate eu\.eurostat\.nuts identifier RO000/
  );
});

test("detects any modified artifact before import or promotion", () => {
  const bundle = buildReleaseBundle(releaseInput());
  const corrupted = { artifacts: new Map(bundle.artifacts) };
  corrupted.artifacts.set("territories.csv", Buffer.from("corrupted\n"));
  assert.throws(() => verifyReleaseBundle(corrupted), /checksum mismatch/);
});

test("writes create-only release files and accepts only an exact rerun", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "teritoriu-release-"));
  const bundle = buildReleaseBundle(releaseInput());
  const first = await writeReleaseBundle(directory, bundle);
  assert.equal(first.created.length, 13);
  const second = await writeReleaseBundle(directory, bundle);
  assert.equal(second.created.length, 0);
  const loaded = await readReleaseBundle(directory);
  assert.equal(loaded.manifestSha256, bundle.manifestSha256);

  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path.join(directory, "territories.csv"), "different\n")
  );
  await assert.rejects(writeReleaseBundle(directory, bundle), /differs/);
  assert.equal((await readFile(path.join(directory, "manifest.json"))).equals(bundle.artifacts.get("manifest.json")), true);
});

function geometriesFor(candidate) {
  return buildGeometriesArtifact(
    candidate.territories.map((territory) => ({
      territoryId: territory.territoryId,
      geometryKind: "source",
      detailLevel: "original",
      geometry: { type: "Polygon", coordinates: [[[23, 46], [24, 46], [24, 47], [23, 46]]] },
      sourceSnapshotId: SNAPSHOT_ID,
      sourceFeatureKey: "1"
    }))
  );
}

test("includes the optional territory-geometries artifact only when geometries are provided", () => {
  const withoutGeometries = buildReleaseBundle(releaseInput());
  assert.equal(withoutGeometries.artifacts.has("territory-geometries.geojson"), false);
  assert.equal(
    JSON.parse(withoutGeometries.artifacts.get("contract.json")).artifacts.some(
      (artifact) => artifact.purpose === "territory-geometries"
    ),
    false
  );

  const input = releaseInput();
  const withGeometries = buildReleaseBundle({ ...input, geometries: geometriesFor(input.candidate) });
  assert.deepEqual([...withGeometries.artifacts.keys()].sort(), [
    "SHA256SUMS",
    "changelog.json",
    "contract.json",
    "contract.schema.json",
    "manifest.json",
    "release-manifest.schema.json",
    "territories.csv",
    "territories.json",
    "territories.ndjson",
    "territories.schema.json",
    "territory-geometries.geojson",
    "territory-geometries.schema.json",
    "territory-identifiers.csv",
    "territory.schema.json",
    "validation-report.json"
  ]);
  const contract = JSON.parse(withGeometries.artifacts.get("contract.json"));
  const geometryArtifact = contract.artifacts.find((artifact) => artifact.purpose === "territory-geometries");
  assert.equal(geometryArtifact.required, false);
  assert.equal(contract.contractVersion, "1.2.0");

  const verification = verifyReleaseBundle(withGeometries);
  assert.equal(verification.manifest.counts.territories, 3);
  const geojson = JSON.parse(withGeometries.artifacts.get("territory-geometries.geojson"));
  assert.equal(geojson.type, "FeatureCollection");
  assert.equal(geojson.features.length, 3);
});

test("rejects a release at build time where a geometry references a territory outside the release", () => {
  const input = releaseInput();
  const geometries = geometriesFor(input.candidate);
  geometries.features[0].properties.territoryId = "019f8e0f-4c41-7999-8000-000000000099";
  assert.throws(
    () => buildReleaseBundle({ ...input, geometries }),
    /geometries reference a territory outside this release/
  );
});

test("verifyReleaseBundle rejects a geometries artifact that references an unknown territory", () => {
  const input = releaseInput();
  const bundle = buildReleaseBundle({ ...input, geometries: geometriesFor(input.candidate) });
  const geojson = JSON.parse(bundle.artifacts.get("territory-geometries.geojson"));
  geojson.features[0].properties.territoryId = "019f8e0f-4c41-7999-8000-000000000099";
  const tampered = { artifacts: new Map(bundle.artifacts) };
  tampered.artifacts.set("territory-geometries.geojson", Buffer.from(JSON.stringify(geojson), "utf8"));
  // Recompute SHA256SUMS so this fails on the referential check, not the checksum check.
  const checksumLines = [...tampered.artifacts.entries()]
    .filter(([name]) => name !== "SHA256SUMS")
    .map(([name, bytes]) => ({ name, hash: createHash("sha256").update(bytes).digest("hex") }))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => `${item.hash}  ${item.name}`);
  tampered.artifacts.set("SHA256SUMS", Buffer.from(`${checksumLines.join("\n")}\n`, "utf8"));
  assert.throws(() => verifyReleaseBundle(tampered), /references a territory outside this release/);
});

test("rejects a malformed geometries payload before it reaches the bundle", () => {
  const input = releaseInput();
  assert.throws(
    () => buildReleaseBundle({ ...input, geometries: { type: "FeatureCollection" } }),
    /territory geometries schema validation failed/
  );
});

test("round-trips a bundle with geometries through disk", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "teritoriu-release-geo-"));
  const input = releaseInput();
  const bundle = buildReleaseBundle({ ...input, geometries: geometriesFor(input.candidate) });
  const written = await writeReleaseBundle(directory, bundle);
  assert.equal(written.created.length, 15);
  const loaded = await readReleaseBundle(directory);
  assert.equal(loaded.manifestSha256, bundle.manifestSha256);
  assert.equal(loaded.artifacts.has("territory-geometries.geojson"), true);
});
