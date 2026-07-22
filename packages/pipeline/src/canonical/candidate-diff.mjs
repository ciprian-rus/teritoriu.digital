import { canonicalJson } from "./canonical-json.mjs";

function sirutaIdentifier(territory) {
  return territory.identifiers?.find((identifier) => identifier.scheme === "ro.ins.siruta")?.value ?? null;
}

function semanticProjection(territory) {
  const { provenance: _provenance, ...semantic } = territory;
  return semantic;
}

function changedFields(previous, current) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return [...keys]
    .filter((key) => canonicalJson(previous[key]) !== canonicalJson(current[key]))
    .sort();
}

function assertThresholds(thresholds) {
  for (const field of ["maxTotalDeltaRatio", "maxRemovedRatio", "maxChangedRatio"]) {
    if (!Number.isFinite(thresholds?.[field]) || thresholds[field] < 0 || thresholds[field] > 1) {
      throw new TypeError(`${field} must be a number between 0 and 1`);
    }
  }
}

function indexBySiruta(territories, label) {
  const index = new Map();
  for (const territory of territories) {
    const siruta = sirutaIdentifier(territory);
    if (!/^\d{1,6}$/.test(siruta ?? "")) {
      throw new TypeError(`${label} contains a territory without a valid SIRUTA identifier`);
    }
    if (index.has(siruta)) {
      throw new TypeError(`${label} contains duplicate SIRUTA identifier ${siruta}`);
    }
    index.set(siruta, territory);
  }
  return index;
}

export function diffTerritoryCandidates(previousCandidate, currentTerritories, thresholds) {
  assertThresholds(thresholds);
  if (!previousCandidate) {
    indexBySiruta(currentTerritories, "current candidate");
    return {
      baseline: false,
      added: currentTerritories.map(sirutaIdentifier).sort((left, right) => Number(left) - Number(right)),
      removed: [],
      changed: [],
      sourceRecordChanged: [],
      unchanged: 0,
      findings: []
    };
  }

  const previousTerritories = Array.isArray(previousCandidate)
    ? previousCandidate
    : previousCandidate.territories ?? [];
  const previousBySiruta = indexBySiruta(previousTerritories, "previous candidate");
  const currentBySiruta = indexBySiruta(currentTerritories, "current candidate");
  const added = [];
  const removed = [];
  const changed = [];
  const sourceRecordChanged = [];
  let unchanged = 0;

  for (const [siruta, territory] of currentBySiruta) {
    if (!previousBySiruta.has(siruta)) {
      added.push(siruta);
      continue;
    }
    const before = semanticProjection(previousBySiruta.get(siruta));
    const after = semanticProjection(territory);
    if (
      previousBySiruta.get(siruta).provenance?.sourceRecordHash !==
      territory.provenance?.sourceRecordHash
    ) sourceRecordChanged.push(siruta);
    if (canonicalJson(before) === canonicalJson(after)) unchanged += 1;
    else changed.push({ siruta, fields: changedFields(before, after) });
  }
  for (const siruta of previousBySiruta.keys()) {
    if (!currentBySiruta.has(siruta)) removed.push(siruta);
  }

  added.sort((left, right) => Number(left) - Number(right));
  removed.sort((left, right) => Number(left) - Number(right));
  changed.sort((left, right) => Number(left.siruta) - Number(right.siruta));
  sourceRecordChanged.sort((left, right) => Number(left) - Number(right));

  const previousTotal = previousBySiruta.size || 1;
  const totalDeltaRatio = Math.abs(currentBySiruta.size - previousBySiruta.size) / previousTotal;
  const removedRatio = removed.length / previousTotal;
  const changedRatio = changed.length / previousTotal;
  const findings = [];
  const measures = [
    ["SIRUTA_DIFF_TOTAL_MASS_CHANGE", totalDeltaRatio, thresholds.maxTotalDeltaRatio, "Total volume changed beyond the approved threshold"],
    ["SIRUTA_DIFF_REMOVALS_MASS_CHANGE", removedRatio, thresholds.maxRemovedRatio, "Too many SIRUTA identifiers disappeared in one candidate"],
    ["SIRUTA_DIFF_RECORDS_MASS_CHANGE", changedRatio, thresholds.maxChangedRatio, "Too many territory records changed in one candidate"]
  ];
  for (const [ruleCode, observed, maximum, message] of measures) {
    if (observed > maximum) {
      findings.push({
        ruleCode,
        ruleVersion: "1.0.0",
        severity: "blocker",
        entityKind: "import_run",
        entityKey: null,
        message,
        evidence: { observedRatio: observed, maximumRatio: maximum }
      });
    }
  }

  return {
    baseline: true,
    added,
    removed,
    changed,
    sourceRecordChanged,
    unchanged,
    ratios: { totalDeltaRatio, removedRatio, changedRatio },
    findings
  };
}

export function skippedCandidateDiff(reason) {
  return {
    skipped: true,
    reason,
    baseline: null,
    added: [],
    removed: [],
    changed: [],
    sourceRecordChanged: [],
    unchanged: 0,
    findings: []
  };
}
