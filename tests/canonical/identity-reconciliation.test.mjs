import test from "node:test";
import assert from "node:assert/strict";

import {
  identityIndexFromLedger,
  ledgerFromDecisions,
  reconcileSirutaIdentities
} from "../../packages/pipeline/src/canonical/identity-reconciliation.mjs";
import { parsedFixture, uuidSequence } from "./fixture.mjs";

const ACTIVE_ID = "018f0000-0000-7000-8000-000000000101";
const OTHER_ID = "018f0000-0000-7000-8000-000000000102";

function records() {
  return parsedFixture().records;
}

test("proposes one UUIDv7 per new SIRUTA identity and reuses the resulting ledger", () => {
  const first = reconcileSirutaIdentities(records(), {}, { uuidFactory: uuidSequence() });
  assert.equal(first.findings.length, 0);
  assert.equal(first.decisions.every((item) => item.decision === "create"), true);
  const ledger = ledgerFromDecisions(first.decisions);

  const second = reconcileSirutaIdentities(records(), identityIndexFromLedger(ledger), {
    uuidFactory: () => {
      throw new Error("must not generate a new identity");
    }
  });
  assert.deepEqual(ledgerFromDecisions(second.decisions), ledger);
  assert.equal(second.decisions[0].proposedTerritoryId, first.decisions[0].proposedTerritoryId);
});

test("matches exactly one active identifier without generating a replacement", () => {
  const result = reconcileSirutaIdentities(
    records().slice(0, 1),
    { "1": [{ territoryId: ACTIVE_ID, status: "active", validTo: null, origin: "identifier" }] },
    { uuidFactory: () => { throw new Error("must not run"); } }
  );
  assert.equal(result.decisions[0].decision, "matched");
  assert.equal(result.territoryIds.get("1"), ACTIVE_ID);
});

test("blocks ambiguous active identities and historical SIRUTA reuse", () => {
  const ambiguous = reconcileSirutaIdentities(records().slice(0, 1), {
    "1": [
      { territoryId: ACTIVE_ID, status: "active", validTo: null },
      { territoryId: OTHER_ID, status: "active", validTo: null }
    ]
  });
  assert.equal(ambiguous.decisions[0].decision, "needs_review");
  assert.equal(ambiguous.findings[0].ruleCode, "IDENTITY_AMBIGUOUS_ACTIVE");

  const historical = reconcileSirutaIdentities(records().slice(0, 1), {
    "1": [{ territoryId: ACTIVE_ID, status: "historical", validTo: "2020-01-01" }]
  });
  assert.equal(historical.decisions[0].decision, "needs_review");
  assert.equal(historical.findings[0].ruleCode, "IDENTITY_HISTORICAL_REUSE_REVIEW");
});

test("does not let a pending proposal bypass a historical continuity review", () => {
  const result = reconcileSirutaIdentities(records().slice(0, 1), {
    "1": [
      { territoryId: ACTIVE_ID, status: "proposed", origin: "proposal" },
      { territoryId: OTHER_ID, status: "historical", validTo: "2020-01-01", origin: "identifier" }
    ]
  });
  assert.equal(result.decisions[0].decision, "needs_review");
  assert.equal(result.findings[0].ruleCode, "IDENTITY_PROPOSAL_HISTORICAL_CONFLICT");
});

test("rejects malformed generated or imported territory IDs before candidate creation", () => {
  assert.throws(
    () => reconcileSirutaIdentities(records().slice(0, 1), {}, { uuidFactory: () => "not-a-uuid" }),
    /UUIDv7/
  );
  assert.throws(
    () => reconcileSirutaIdentities(records().slice(0, 1), {
      "1": [{ territoryId: "018f0000-0000-4000-8000-000000000101", status: "active" }]
    }),
    /UUIDv7/
  );
});
