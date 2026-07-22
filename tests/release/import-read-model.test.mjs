import test from "node:test";
import assert from "node:assert/strict";

import { buildSirutaCandidateFromParsed } from "../../packages/pipeline/src/canonical/build-candidate.mjs";
import { diffTerritoryCandidates } from "../../packages/pipeline/src/canonical/candidate-diff.mjs";
import { importReleaseReadModel } from "../../packages/consumer/src/import-release.mjs";
import { buildReleaseBundle } from "../../packages/pipeline/src/release/artifact-builder.mjs";
import {
  CONFIGURATION,
  SNAPSHOT_ID,
  SOURCE_SHA256,
  parsedFixture,
  uuidSequence
} from "../canonical/fixture.mjs";

function buildInput(releaseId, publishedAt, previousReleaseId = null, previousCandidate = null) {
  const result = buildSirutaCandidateFromParsed(parsedFixture(), CONFIGURATION, {
    sourceSnapshotId: SNAPSHOT_ID,
    sourceSha256: SOURCE_SHA256,
    uuidFactory: uuidSequence(),
    identityLedger: previousCandidate
      ? Object.fromEntries(previousCandidate.territories.map((territory) => [
          territory.identifiers.find((item) => item.scheme === "ro.ins.siruta").value,
          territory.territoryId
        ]))
      : undefined,
    previousCandidate
  });
  const diff = previousCandidate
    ? diffTerritoryCandidates(previousCandidate, result.candidate.territories, CONFIGURATION.diffThresholds)
    : result.diff;
  return {
    candidate: result.candidate,
    validationReport: { status: result.status, summary: result.summary, findings: result.findings },
    diff,
    metadata: {
      releaseId,
      publishedAt,
      previousReleaseId,
      pipelineCommit: "d".repeat(40),
      repository: "ciprian-rus/teritoriu.digital",
      approval: {
        importRunId: "018f0000-0000-7000-8000-0000000000cc",
        candidateSha256: result.summary.candidateSha256,
        approvedBy: "reviewer",
        approvedAt: "2026-07-22T15:00:00.000Z",
        rationale: "Candidatul a trecut revizia completă și controlul de identitate."
      },
      source: {
        snapshotId: SNAPSHOT_ID,
        sha256: SOURCE_SHA256,
        sizeBytes: 1158236,
        retrievedAt: "2026-07-22T14:00:00.000Z",
        uri: "https://data.gov.ro/dataset/example/download/siruta.xlsx",
        slug: "ro.ins.siruta",
        publisher: "Institutul Național de Statistică"
      }
    }
  };
}

test("imports atomically and preserves an explicit rollback target", () => {
  const firstInput = buildInput("2026.07.22.1", "2026-07-22T16:00:00.000Z");
  const first = importReleaseReadModel(buildReleaseBundle(firstInput));
  assert.equal(first.releaseId, "2026.07.22.1");
  assert.equal(first.rollback, null);

  const secondInput = buildInput(
    "2026.07.23.1",
    "2026-07-23T16:00:00.000Z",
    first.releaseId,
    firstInput.candidate
  );
  const second = importReleaseReadModel(buildReleaseBundle(secondInput), first);
  assert.deepEqual(second.rollback, {
    releaseId: first.releaseId,
    manifestSha256: first.manifestSha256
  });
  assert.equal(second.bySiruta.get("3"), first.bySiruta.get("3"));
});

test("a corrupt import cannot replace the active read-model", () => {
  const active = importReleaseReadModel(buildReleaseBundle(
    buildInput("2026.07.22.1", "2026-07-22T16:00:00.000Z")
  ));
  const bundle = buildReleaseBundle(buildInput("2026.07.23.1", "2026-07-23T16:00:00.000Z"));
  bundle.artifacts.set("territories.json", Buffer.from("{}\n"));
  assert.throws(() => importReleaseReadModel(bundle, active), /checksum mismatch/);
  assert.equal(active.releaseId, "2026.07.22.1");
  assert.equal(active.territories.length, 3);
});
