import { uuidV7 } from "../acquisition/uuid-v7.mjs";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireUuidV7(value, field) {
  if (!UUID_V7.test(value ?? "")) throw new TypeError(`${field} must be a lowercase UUIDv7`);
  return value;
}

function asCandidates(index, siruta) {
  if (index instanceof Map) return index.get(siruta) ?? [];
  const value = index?.[siruta] ?? [];
  return Array.isArray(value) ? value : [value];
}

function decisionFinding(siruta, code, message, candidates) {
  return {
    ruleCode: code,
    ruleVersion: "1.0.0",
    severity: "blocker",
    entityKind: "territory",
    entityKey: siruta,
    message,
    evidence: {
      candidates: candidates.map((candidate) => ({
        territoryId: candidate.territoryId,
        status: candidate.status,
        origin: candidate.origin ?? "identifier"
      }))
    }
  };
}

export function reconcileSirutaIdentities(records, existingIndex = {}, options = {}) {
  const uuidFactory = options.uuidFactory ?? uuidV7;
  const territoryIds = new Map();
  const decisions = [];
  const findings = [];

  for (const record of records) {
    const siruta = record.parsedRecord.siruta;
    const candidates = asCandidates(existingIndex, siruta)
      .filter(Boolean)
      .map((candidate) => ({
        ...candidate,
        territoryId: requireUuidV7(candidate.territoryId, `identity candidate for SIRUTA ${siruta}`)
      }));
    const active = candidates.filter(
      (candidate) => candidate.status === "active" && !candidate.validTo && candidate.origin !== "proposal"
    );
    const proposals = candidates.filter(
      (candidate) => candidate.origin === "proposal" && candidate.status !== "rejected"
    );
    const historical = candidates.filter(
      (candidate) => candidate.origin !== "proposal" && !active.includes(candidate)
    );

    if (active.length === 1) {
      const conflictingProposals = proposals.filter(
        (candidate) => candidate.territoryId !== active[0].territoryId
      );
      if (conflictingProposals.length > 0) {
        findings.push(
          decisionFinding(
            siruta,
            "IDENTITY_ACTIVE_PROPOSAL_CONFLICT",
            "The active identity conflicts with a pending identity proposal",
            [active[0], ...conflictingProposals]
          )
        );
        decisions.push({
          sourceRecordKey: siruta,
          decision: "needs_review",
          candidateTerritoryId: null,
          proposedTerritoryId: null,
          confidence: null,
          rationale: "Active identity and pending proposal disagree"
        });
        continue;
      }
      territoryIds.set(siruta, active[0].territoryId);
      decisions.push({
        sourceRecordKey: siruta,
        decision: "matched",
        candidateTerritoryId: active[0].territoryId,
        proposedTerritoryId: null,
        confidence: 1,
        rationale: "Matched the single active ro.ins.siruta identifier"
      });
      continue;
    }

    if (active.length > 1) {
      findings.push(
        decisionFinding(
          siruta,
          "IDENTITY_AMBIGUOUS_ACTIVE",
          "More than one active territory claims the same SIRUTA identifier",
          active
        )
      );
      decisions.push({
        sourceRecordKey: siruta,
        decision: "needs_review",
        candidateTerritoryId: null,
        proposedTerritoryId: null,
        confidence: null,
        rationale: "Multiple active SIRUTA identifier matches"
      });
      continue;
    }

    if (proposals.length === 1 && historical.length === 0) {
      territoryIds.set(siruta, proposals[0].territoryId);
      decisions.push({
        sourceRecordKey: siruta,
        decision: "create",
        candidateTerritoryId: null,
        proposedTerritoryId: proposals[0].territoryId,
        confidence: 1,
        rationale: "Reused the single reviewed pending identity proposal"
      });
      continue;
    }

    if (proposals.length > 0 && historical.length > 0) {
      findings.push(
        decisionFinding(
          siruta,
          "IDENTITY_PROPOSAL_HISTORICAL_CONFLICT",
          "A pending identity proposal cannot bypass a historical SIRUTA continuity review",
          [...proposals, ...historical]
        )
      );
      decisions.push({
        sourceRecordKey: siruta,
        decision: "needs_review",
        candidateTerritoryId: null,
        proposedTerritoryId: null,
        confidence: null,
        rationale: "Pending proposal conflicts with a historical SIRUTA identifier"
      });
      continue;
    }

    if (proposals.length > 1) {
      findings.push(
        decisionFinding(
          siruta,
          "IDENTITY_AMBIGUOUS_PROPOSAL",
          "More than one pending identity proposal exists for the SIRUTA record",
          proposals
        )
      );
      decisions.push({
        sourceRecordKey: siruta,
        decision: "needs_review",
        candidateTerritoryId: null,
        proposedTerritoryId: null,
        confidence: null,
        rationale: "Multiple pending identity proposals"
      });
      continue;
    }

    if (candidates.length > 0) {
      findings.push(
        decisionFinding(
          siruta,
          "IDENTITY_HISTORICAL_REUSE_REVIEW",
          "The SIRUTA code exists only as a historical identifier and cannot be reactivated automatically",
          candidates
        )
      );
      decisions.push({
        sourceRecordKey: siruta,
        decision: "needs_review",
        candidateTerritoryId: null,
        proposedTerritoryId: null,
        confidence: null,
        rationale: "Historical SIRUTA identifier requires a continuity decision"
      });
      continue;
    }

    const proposedTerritoryId = requireUuidV7(
      uuidFactory(),
      `generated identity for SIRUTA ${siruta}`
    );
    territoryIds.set(siruta, proposedTerritoryId);
    decisions.push({
      sourceRecordKey: siruta,
      decision: "create",
      candidateTerritoryId: null,
      proposedTerritoryId,
      confidence: 1,
      rationale: "No prior SIRUTA identifier or proposal exists"
    });
  }

  return { territoryIds, decisions, findings };
}

export function identityIndexFromLedger(ledger = {}) {
  return Object.fromEntries(
    Object.entries(ledger).map(([siruta, territoryId]) => [
      siruta,
      [{ territoryId, status: "proposed", origin: "proposal" }]
    ])
  );
}

export function ledgerFromDecisions(decisions, previous = {}) {
  const ledger = { ...previous };
  for (const decision of decisions) {
    const territoryId = decision.candidateTerritoryId ?? decision.proposedTerritoryId;
    if (territoryId) ledger[decision.sourceRecordKey] = territoryId;
  }
  return Object.fromEntries(Object.entries(ledger).sort(([left], [right]) => Number(left) - Number(right)));
}
