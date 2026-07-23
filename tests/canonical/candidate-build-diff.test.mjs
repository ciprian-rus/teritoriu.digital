import test from "node:test";
import assert from "node:assert/strict";

import { buildSirutaCandidateFromParsed } from "../../packages/pipeline/src/canonical/build-candidate.mjs";
import { diffTerritoryCandidates } from "../../packages/pipeline/src/canonical/candidate-diff.mjs";
import {
  CONFIGURATION,
  SNAPSHOT_ID,
  SOURCE_SHA256,
  cloneRows,
  parsedFixture,
  uuidSequence
} from "./fixture.mjs";

function build(options = {}) {
  return buildSirutaCandidateFromParsed(
    options.parsed ?? parsedFixture(),
    CONFIGURATION,
    {
      sourceSnapshotId: options.sourceSnapshotId ?? SNAPSHOT_ID,
      sourceSha256: options.sourceSha256 ?? SOURCE_SHA256,
      identityLedger: options.identityLedger,
      previousCandidate: options.previousCandidate,
      uuidFactory: options.uuidFactory ?? uuidSequence()
    }
  );
}

test("builds a deterministic canonical candidate with hierarchy, roles and provenance", () => {
  const first = build();
  assert.equal(first.status, "passed");
  assert.equal(first.candidate.territories.length, 3);
  assert.match(first.summary.candidateSha256, /^[0-9a-f]{64}$/);

  const [county, commune, village] = first.candidate.territories;
  assert.equal(county.administrativeRole, "county_uat");
  assert.equal(county.countyTerritoryId, county.territoryId);
  assert.equal(county.parentTerritoryId, null);
  assert.equal(commune.parentTerritoryId, county.territoryId);
  assert.equal(village.parentTerritoryId, commune.territoryId);
  assert.equal(village.countyTerritoryId, county.territoryId);
  assert.equal(county.identifiers.some((item) => item.scheme === "eu.eurostat.nuts"), true);
  assert.equal(commune.identifiers.some((item) => item.scheme === "eu.eurostat.nuts"), false);
  assert.equal(village.provenance.sourceSnapshotId, SNAPSHOT_ID);

  const second = build({
    identityLedger: first.identityLedger,
    uuidFactory: () => { throw new Error("identity ledger must be reused"); }
  });
  assert.equal(second.summary.candidateSha256, first.summary.candidateSha256);
  assert.deepEqual(second.candidate, first.candidate);
});

test("applies the reviewed Bucharest type definition only to SIRUTA 179132", () => {
  const rows = cloneRows();
  rows[2] = [
    179132,
    "MUNICIPIUL BUCUREȘTI",
    0,
    1,
    1,
    9,
    2,
    1,
    1,
    42,
    "0101000000000",
    "RO000"
  ];
  rows[3][4] = 179132;
  const configuration = structuredClone(CONFIGURATION);
  configuration.expectedProfile.checksumWarnings = 1;
  configuration.reviewedSourceExceptions.recordTypeDefinitions = {
    "179132": {
      sourceTypeCode: 9,
      sourceLevel: 2,
      territoryType: "municipality",
      administrativeRole: "local_uat",
      isUat: true,
      isLocality: true,
      isCountySeat: true
    }
  };
  const result = buildSirutaCandidateFromParsed(
    parsedFixture(rows, configuration),
    configuration,
    {
      sourceSnapshotId: SNAPSHOT_ID,
      sourceSha256: SOURCE_SHA256,
      uuidFactory: uuidSequence()
    }
  );

  assert.equal(result.status, "passed");
  const bucharest = result.candidate.territories.find((item) =>
    item.identifiers.some(
      (identifier) =>
        identifier.scheme === "ro.ins.siruta" && identifier.value === "179132"
    )
  );
  assert.equal(bucharest.territoryType, "municipality");
  assert.equal(bucharest.administrativeRole, "local_uat");
  assert.equal(bucharest.isUat, true);
  assert.notEqual(bucharest.parentTerritoryId, null);

  const driftedRows = structuredClone(rows);
  driftedRows[2][5] = 10;
  const drifted = buildSirutaCandidateFromParsed(
    parsedFixture(driftedRows, configuration),
    configuration,
    {
      sourceSnapshotId: SNAPSHOT_ID,
      sourceSha256: SOURCE_SHA256,
      uuidFactory: uuidSequence()
    }
  );
  assert.equal(drifted.status, "blocked");
  assert.ok(
    drifted.findings.some(
      (item) => item.ruleCode === "SIRUTA_REVIEWED_TYPE_OVERRIDE_MISMATCH"
    )
  );
});

test("ignores provenance-only changes but reports semantic field changes", () => {
  const first = build();
  const provenanceOnly = build({
    identityLedger: first.identityLedger,
    previousCandidate: first.candidate,
    sourceSnapshotId: "018f0000-0000-7000-8000-0000000000bb",
    sourceSha256: "b".repeat(64)
  });
  assert.equal(provenanceOnly.diff.changed.length, 0);
  assert.equal(provenanceOnly.diff.sourceRecordChanged.length, 0);
  assert.equal(provenanceOnly.diff.unchanged, 3);

  const rows = cloneRows();
  rows[3][1] = "SAT REDENUMIT";
  const renamed = build({
    parsed: parsedFixture(rows),
    identityLedger: first.identityLedger,
    previousCandidate: first.candidate
  });
  assert.deepEqual(renamed.diff.changed, [
    { siruta: "3", fields: ["normalizedName", "officialName", "shortName"] }
  ]);
  assert.deepEqual(renamed.diff.sourceRecordChanged, ["3"]);
});

test("blocks mass changes above the configured thresholds", () => {
  const territory = (value) => ({
    territoryId: `018f0000-0000-7000-8000-${value.padStart(12, "0")}`,
    officialName: `T${value}`,
    identifiers: [{ scheme: "ro.ins.siruta", value }],
    provenance: { sourceSnapshotId: SNAPSHOT_ID }
  });
  const previous = { territories: Array.from({ length: 10 }, (_, index) => territory(String(index + 1))) };
  const result = diffTerritoryCandidates(previous, [territory("1")], CONFIGURATION.diffThresholds);
  assert.equal(result.removed.length, 9);
  assert.ok(result.findings.some((item) => item.ruleCode === "SIRUTA_DIFF_REMOVALS_MASS_CHANGE"));
});

test("rejects malformed diff thresholds and duplicate identifiers", () => {
  const territory = {
    territoryId: "018f0000-0000-7000-8000-000000000001",
    identifiers: [{ scheme: "ro.ins.siruta", value: "1" }]
  };
  assert.throws(
    () => diffTerritoryCandidates(null, [territory], { maxRemovedRatio: 1 }),
    /maxTotalDeltaRatio/
  );
  assert.throws(
    () => diffTerritoryCandidates(
      { territories: [territory, structuredClone(territory)] },
      [territory],
      CONFIGURATION.diffThresholds
    ),
    /duplicate SIRUTA/
  );
});

test("does not fabricate a diff or candidate after structural validation blocks", () => {
  const rows = cloneRows();
  rows[3][0] = 2;
  const result = build({ parsed: parsedFixture(rows) });
  assert.equal(result.status, "blocked");
  assert.equal(result.candidate, null);
  assert.equal(result.diff.skipped, true);
  assert.equal(result.decisions.length, 2);
});

test("requires immutable snapshot provenance before building", () => {
  assert.throws(
    () => buildSirutaCandidateFromParsed(parsedFixture(), CONFIGURATION, {
      sourceSnapshotId: "not-a-uuid",
      sourceSha256: SOURCE_SHA256
    }),
    /UUIDv7/
  );
  assert.throws(
    () => buildSirutaCandidateFromParsed(parsedFixture(), CONFIGURATION, {
      sourceSnapshotId: SNAPSHOT_ID,
      sourceSha256: "bad"
    }),
    /SHA-256/
  );
});
