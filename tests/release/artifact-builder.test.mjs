import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(verification.contract.contractVersion, "1.0.0");
  assert.equal(verification.payload.contractVersion, "1.0.0");
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
