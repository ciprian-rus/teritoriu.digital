import test from "node:test";
import assert from "node:assert/strict";

import { buildSirutaCandidateFromParsed } from "../../packages/pipeline/src/canonical/build-candidate.mjs";
import { buildReleaseBundle } from "../../packages/pipeline/src/release/artifact-builder.mjs";
import {
  approveSirutaCandidate,
  moveStableReleaseChannel,
  promoteSirutaRelease
} from "../../packages/pipeline/src/release/postgres-release.mjs";
import {
  CONFIGURATION,
  SNAPSHOT_ID,
  SOURCE_SHA256,
  parsedFixture,
  uuidSequence
} from "../canonical/fixture.mjs";

const IMPORT_RUN_ID = "018f0000-0000-7000-8000-0000000000cc";
const CANDIDATE_SHA = "c".repeat(64);
const PIPELINE_COMMIT = "d".repeat(40);
const APPROVED_AT = "2026-07-22T15:30:00.000Z";

function candidateAndBundle() {
  const result = buildSirutaCandidateFromParsed(parsedFixture(), CONFIGURATION, {
    sourceSnapshotId: SNAPSHOT_ID,
    sourceSha256: SOURCE_SHA256,
    uuidFactory: uuidSequence()
  });
  const bundle = buildReleaseBundle({
    candidate: result.candidate,
    validationReport: { status: result.status, summary: result.summary, findings: result.findings },
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
        approvedAt: APPROVED_AT,
        rationale: "Identitățile și raportul de calitate au fost revizuite."
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
  });
  return { result, bundle };
}

function approvalClient({ blockers = 0, existing = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (sql.includes("from registry.import_runs") && sql.includes("for update")) {
        return { rows: [{ import_run_id: IMPORT_RUN_ID, status: "review", summary: { candidateSha256: CANDIDATE_SHA } }] };
      }
      if (sql.includes("from registry.validation_findings")) return { rows: [{ blocking_count: blockers }] };
      if (sql.includes("from registry.identity_decisions") && sql.includes("staging_count")) {
        return { rows: [{ decision_count: 3, resolved_count: 3, staging_count: 3 }] };
      }
      if (sql.includes("from registry.release_candidate_approvals")) return { rows: existing ? [existing] : [] };
      return { rows: [] };
    }
  };
}

test("records an immutable candidate approval only after every gate passes", async () => {
  const client = approvalClient();
  const result = await approveSirutaCandidate({
    importRunId: IMPORT_RUN_ID,
    candidateSha256: CANDIDATE_SHA,
    actor: "reviewer",
    rationale: "Toate identitățile au fost verificate manual."
  }, {
    client,
    now: () => new Date(APPROVED_AT),
    uuidFactory: uuidSequence(100)
  });
  assert.equal(result.created, true);
  assert.equal(client.calls[0], "begin");
  assert.equal(client.calls.at(-1), "commit");
  assert.ok(client.calls.some((sql) => sql.includes("insert into registry.release_candidate_approvals")));
  assert.ok(client.calls.some((sql) => sql.includes("siruta_candidate_approved")));
});

test("a blocking finding rolls back approval without changing status", async () => {
  const client = approvalClient({ blockers: 1 });
  await assert.rejects(approveSirutaCandidate({
    importRunId: IMPORT_RUN_ID,
    candidateSha256: CANDIDATE_SHA,
    actor: "reviewer",
    rationale: "Acest text este suficient de lung pentru validare."
  }, { client }), { code: "CANDIDATE_HAS_BLOCKERS" });
  assert.equal(client.calls.at(-1), "rollback");
  assert.equal(client.calls.some((sql) => sql.includes("set status = 'approved'")), false);
});

function promotionClient(candidate, bundle, { existing = false } = {}) {
  const calls = [];
  const decisions = candidate.territories.map((territory) => ({
    source_record_key: territory.identifiers.find((item) => item.scheme === "ro.ins.siruta").value,
    decision: "create",
    candidate_territory_id: null,
    proposed_territory_id: territory.territoryId
  }));
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (sql.includes("from registry.releases") && sql.includes("for update")) {
        return existing
          ? { rows: [{ release_id: bundle.manifest.releaseId, status: "published", manifest_sha256: bundle.manifestSha256 }] }
          : { rows: [] };
      }
      if (sql.includes("join registry.release_candidate_approvals")) {
        return { rows: [{
          import_run_id: IMPORT_RUN_ID,
          snapshot_id: SNAPSHOT_ID,
          pipeline_commit: PIPELINE_COMMIT,
          parser_version: CONFIGURATION.transformationVersion,
          import_status: "approved",
          summary: { candidateSha256: bundle.manifest.candidateSha256 },
          candidate_sha256: bundle.manifest.candidateSha256,
          approved_by: "reviewer",
          approved_at: APPROVED_AT,
          rationale: "Identitățile și raportul de calitate au fost revizuite.",
          source_sha256: SOURCE_SHA256,
          size_bytes: 1158236,
          retrieved_at: "2026-07-22T14:00:00.000Z",
          resolved_url: "https://data.gov.ro/dataset/example/download/siruta.xlsx",
          source_slug: "ro.ins.siruta",
          publisher: "Institutul Național de Statistică"
        }] };
      }
      if (sql.includes("from registry.release_channels") && sql.includes("for update")) return { rows: [] };
      if (sql.includes("from registry.identity_decisions") && sql.includes("order by")) return { rows: decisions };
      if (sql.includes("from registry.territory_identifiers existing")) return { rows: [] };
      return { rows: [] };
    }
  };
}

test("promotes canonical rows, artifacts and stable in one database transaction", async () => {
  const { result, bundle } = candidateAndBundle();
  const client = promotionClient(result.candidate, bundle);
  const promoted = await promoteSirutaRelease({
    importRunId: IMPORT_RUN_ID,
    actor: "publisher",
    rationale: "Release-ul public a fost verificat independent înainte de promovare.",
    candidate: result.candidate,
    manifest: bundle.manifest,
    manifestSha256: bundle.manifestSha256,
    bundleArtifacts: bundle.artifacts
  }, { client, uuidFactory: uuidSequence(200) });
  assert.equal(promoted.created, true);
  assert.equal(client.calls[0], "begin");
  assert.equal(client.calls.at(-1), "commit");
  for (const fragment of [
    "insert into registry.releases",
    "insert into registry.territories",
    "insert into registry.territory_revisions",
    "insert into registry.territory_identifiers",
    "insert into registry.release_artifacts",
    "set status = 'published'",
    "insert into registry.release_channels",
    "insert into registry.release_channel_events"
  ]) assert.ok(client.calls.some((sql) => sql.includes(fragment)), fragment);
});

test("an exact promotion rerun is a no-op and never moves stable again", async () => {
  const { result, bundle } = candidateAndBundle();
  const client = promotionClient(result.candidate, bundle, { existing: true });
  const promoted = await promoteSirutaRelease({
    importRunId: IMPORT_RUN_ID,
    actor: "publisher",
    rationale: "Release-ul public a fost verificat independent înainte de promovare.",
    candidate: result.candidate,
    manifest: bundle.manifest,
    manifestSha256: bundle.manifestSha256,
    bundleArtifacts: bundle.artifacts
  }, { client, requireExistingPromotion: true });
  assert.equal(promoted.created, false);
  assert.equal(client.calls.at(-1), "commit");
  assert.equal(client.calls.some((sql) => sql.includes("insert into registry.release_channels")), false);
});

test("a pre-existing public GitHub release cannot initiate a missing database promotion", async () => {
  const { result, bundle } = candidateAndBundle();
  const client = promotionClient(result.candidate, bundle);
  await assert.rejects(
    promoteSirutaRelease({
      importRunId: IMPORT_RUN_ID,
      actor: "publisher",
      rationale: "Verific o reluare sigură după publicarea release-ului GitHub.",
      candidate: result.candidate,
      manifest: bundle.manifest,
      manifestSha256: bundle.manifestSha256,
      bundleArtifacts: bundle.artifacts
    }, { client, requireExistingPromotion: true }),
    { code: "PUBLIC_RELEASE_WITHOUT_PROMOTION" }
  );
  assert.equal(client.calls.at(-1), "rollback");
  assert.equal(
    client.calls.some((sql) => sql.includes("join registry.release_candidate_approvals")),
    false
  );
});

test("moves stable backward with an append-only rollback event", async () => {
  const calls = [];
  const client = {
    calls,
    async query(sql) {
      calls.push(sql);
      if (sql.includes("from registry.releases") && !sql.includes("for update")) {
        return { rows: [{ release_id: "2026.07.22.1", status: "published", published_at: "2026-07-22T16:00:00.000Z" }] };
      }
      if (sql.includes("join registry.releases") && sql.includes("for update")) {
        return { rows: [{ release_id: "2026.07.23.1", published_at: "2026-07-23T16:00:00.000Z" }] };
      }
      return { rows: [] };
    }
  };
  const result = await moveStableReleaseChannel({
    releaseId: "2026.07.22.1",
    actor: "operator",
    rationale: "Exercițiu controlat de rollback către ultima versiune validă."
  }, {
    client,
    now: () => new Date("2026-07-24T10:00:00.000Z"),
    uuidFactory: uuidSequence(500)
  });
  assert.equal(result.eventType, "rollback");
  assert.ok(calls.some((sql) => sql.includes("update registry.release_channels")));
  assert.ok(calls.some((sql) => sql.includes("insert into registry.release_channel_events")));
  assert.equal(calls.at(-1), "commit");
});
