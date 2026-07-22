import { sirutaTypeDefinition } from "./siruta-types.mjs";

const BLOCKING_SEVERITIES = new Set(["error", "blocker"]);

function finding(ruleCode, severity, message, evidence = {}, entityKey = null) {
  return {
    ruleCode,
    ruleVersion: "1.0.0",
    severity,
    entityKind: entityKey ? "territory" : "import_run",
    entityKey,
    message,
    evidence
  };
}

export function sirutaChecksumIsValid(value) {
  const original = Number(value);
  if (!Number.isInteger(original) || original < 0 || original >= 1_000_000) return false;
  const weights = [1, 2, 3, 5, 7];
  let remaining = original;
  const checkDigit = remaining % 10;
  let sum = 0;
  for (const weight of weights) {
    remaining = Math.trunc(remaining / 10);
    const product = (remaining % 10) * weight;
    sum += Math.trunc(product / 10) + (product % 10);
  }
  return ((11 - (sum % 10)) % 10) === checkDigit;
}

function detectCycles(bySiruta) {
  const state = new Map();
  const cycles = [];

  function visit(code, path) {
    const currentState = state.get(code);
    if (currentState === "done") return;
    if (currentState === "visiting") {
      const start = path.indexOf(code);
      cycles.push(path.slice(start).concat(code));
      return;
    }

    state.set(code, "visiting");
    const parent = bySiruta.get(code)?.parentSiruta;
    if (parent && parent !== "0" && bySiruta.has(parent)) visit(parent, path.concat(code));
    state.set(code, "done");
  }

  for (const code of bySiruta.keys()) visit(code, []);
  return cycles;
}

export function summarizeFindings(findings) {
  const severities = { info: 0, warning: 0, error: 0, blocker: 0 };
  for (const item of findings) severities[item.severity] = (severities[item.severity] ?? 0) + 1;
  return {
    status: findings.some((item) => BLOCKING_SEVERITIES.has(item.severity)) ? "blocked" : "passed",
    severities
  };
}

export function validateSirutaRecords(parsed, configuration) {
  const findings = [...parsed.findings];
  const validRecords = parsed.records.filter((record) => record.parseStatus === "parsed");
  const bySiruta = new Map();
  const levelCounts = { "1": 0, "2": 0, "3": 0 };
  const countyByCode = new Map();
  const nutsByCountyCode = new Map();

  for (const { parsedRecord: record } of validRecords) {
    levelCounts[String(record.level)] = (levelCounts[String(record.level)] ?? 0) + 1;
    if (bySiruta.has(record.siruta)) {
      findings.push(
        finding(
          "SIRUTA_DUPLICATE_CODE",
          "blocker",
          "A SIRUTA code occurs more than once in the snapshot",
          { siruta: record.siruta },
          record.siruta
        )
      );
    } else {
      bySiruta.set(record.siruta, record);
    }

    const definition = sirutaTypeDefinition(record.typeCode, record.officialName);
    if (!definition) {
      findings.push(
        finding(
          "SIRUTA_UNKNOWN_TYPE",
          "blocker",
          "The source contains an unreviewed SIRUTA type code",
          { typeCode: record.typeCode },
          record.siruta
        )
      );
    } else if (definition.expectedLevel !== record.level) {
      findings.push(
        finding(
          "SIRUTA_TYPE_LEVEL_MISMATCH",
          "blocker",
          "The SIRUTA type is not on its reviewed hierarchy level",
          { typeCode: record.typeCode, expectedLevel: definition.expectedLevel, observedLevel: record.level },
          record.siruta
        )
      );
    }

    if (record.nuts) {
      if (!/^RO[0-9A-Z]{3}$/.test(record.nuts)) {
        findings.push(
          finding(
            "SIRUTA_NUTS_FORMAT_INVALID",
            "blocker",
            "A populated NUTS value does not match the reviewed Romanian NUTS3 format",
            { nuts: record.nuts },
            record.siruta
          )
        );
      }
      const knownNuts = nutsByCountyCode.get(record.countyCode);
      if (knownNuts && knownNuts !== record.nuts) {
        findings.push(
          finding(
            "SIRUTA_NUTS_COUNTY_CONFLICT",
            "blocker",
            "Records in one county expose conflicting NUTS3 identifiers",
            { countyCode: record.countyCode, observed: [knownNuts, record.nuts].sort() },
            record.siruta
          )
        );
      } else {
        nutsByCountyCode.set(record.countyCode, record.nuts);
      }
    }

    if (record.typeCode === 40) {
      const existing = countyByCode.get(record.countyCode);
      if (existing && existing !== record.siruta) {
        findings.push(
          finding(
            "SIRUTA_DUPLICATE_COUNTY_CODE",
            "blocker",
            "Two county-level records use the same county code",
            { countyCode: record.countyCode, sirutaCodes: [existing, record.siruta] },
            record.siruta
          )
        );
      }
      countyByCode.set(record.countyCode, record.siruta);
    }
  }

  for (const { parsedRecord: record } of validRecords) {
    if (record.level > 1 && record.parentSiruta === "0") {
      findings.push(
        finding(
          "SIRUTA_REQUIRED_PARENT_MISSING",
          "blocker",
          "A non-root SIRUTA record must reference its superior record",
          { observedLevel: record.level },
          record.siruta
        )
      );
    }
    if (record.parentSiruta !== "0" && !bySiruta.has(record.parentSiruta)) {
      findings.push(
        finding(
          "SIRUTA_PARENT_MISSING",
          "blocker",
          "The superior SIRUTA code does not exist in the same snapshot",
          { parentSiruta: record.parentSiruta },
          record.siruta
        )
      );
    }
    const parent = bySiruta.get(record.parentSiruta);
    if (record.level === 1 && record.parentSiruta !== "0") {
      findings.push(
        finding(
          "SIRUTA_ROOT_PARENT_INVALID",
          "blocker",
          "A county-level SIRUTA record must not have a superior record",
          { parentSiruta: record.parentSiruta },
          record.siruta
        )
      );
    }
    if (record.level > 1 && parent && parent.level !== record.level - 1) {
      findings.push(
        finding(
          "SIRUTA_PARENT_LEVEL_INVALID",
          "blocker",
          "The superior SIRUTA record must be exactly one hierarchy level above",
          { parentSiruta: parent.siruta, parentLevel: parent.level, childLevel: record.level },
          record.siruta
        )
      );
    }
    if (parent && parent.countyCode !== record.countyCode) {
      findings.push(
        finding(
          "SIRUTA_PARENT_COUNTY_MISMATCH",
          "blocker",
          "A SIRUTA child and its superior record must use the same county code",
          {
            parentSiruta: parent.siruta,
            parentCountyCode: parent.countyCode,
            childCountyCode: record.countyCode
          },
          record.siruta
        )
      );
    }
    if (!countyByCode.has(record.countyCode)) {
      findings.push(
        finding(
          "SIRUTA_COUNTY_MISSING",
          "blocker",
          "The county code does not resolve to a county-level record",
          { countyCode: record.countyCode },
          record.siruta
        )
      );
    }
  }

  for (const cycle of detectCycles(bySiruta)) {
    findings.push(
      finding("SIRUTA_HIERARCHY_CYCLE", "blocker", "The SIRUTA hierarchy contains a cycle", { cycle })
    );
  }

  const expectedProfile = configuration.expectedProfile;
  if (validRecords.length !== expectedProfile.totalRows) {
    findings.push(
      finding(
        "SIRUTA_TOTAL_VOLUME_CHANGED",
        "blocker",
        "The snapshot row count differs from the reviewed baseline",
        { expected: expectedProfile.totalRows, observed: validRecords.length }
      )
    );
  }
  for (const [level, expected] of Object.entries(expectedProfile.levels)) {
    if ((levelCounts[level] ?? 0) !== expected) {
      findings.push(
        finding(
          "SIRUTA_LEVEL_VOLUME_CHANGED",
          "blocker",
          "A hierarchy-level row count differs from the reviewed baseline",
          { level, expected, observed: levelCounts[level] ?? 0 }
        )
      );
    }
  }

  const invalidChecksums = validRecords
    .filter(({ parsedRecord: record }) => !sirutaChecksumIsValid(record.siruta))
    .map(({ parsedRecord: record }) => record.siruta);
  if (invalidChecksums.length > 0 || expectedProfile.checksumWarnings > 0) {
    findings.push(
      finding(
        invalidChecksums.length === expectedProfile.checksumWarnings
          ? "SIRUTA_CHECKSUM_OFFICIAL_WARNING"
          : "SIRUTA_CHECKSUM_WARNING_COUNT_CHANGED",
        "warning",
        invalidChecksums.length === expectedProfile.checksumWarnings
          ? "Official SIRUTA codes fail the literal published checksum algorithm and are preserved unchanged"
          : "The number of official SIRUTA checksum warnings differs from the reviewed baseline",
        {
          expectedCount: expectedProfile.checksumWarnings,
          observedCount: invalidChecksums.length,
          sample: invalidChecksums.slice(0, 20)
        }
      )
    );
  }

  const missingNuts = validRecords
    .filter(({ parsedRecord: record }) => !record.nuts)
    .map(({ parsedRecord: record }) => record.siruta);
  if (missingNuts.length > 0 || expectedProfile.nutsMissingValues > 0) {
    findings.push(
      finding(
        missingNuts.length === expectedProfile.nutsMissingValues
          ? "SIRUTA_NUTS_MISSING_VALUES"
          : "SIRUTA_NUTS_MISSING_COUNT_CHANGED",
        "warning",
        missingNuts.length === expectedProfile.nutsMissingValues
          ? "Missing NUTS values are retained as source-quality findings and are not inferred per locality"
          : "The number of missing NUTS values differs from the reviewed baseline",
        {
          expectedCount: expectedProfile.nutsMissingValues,
          observedCount: missingNuts.length,
          sample: missingNuts.slice(0, 20)
        }
      )
    );
  }

  const summary = summarizeFindings(findings);
  return {
    ...summary,
    findings,
    profile: {
      totalRows: validRecords.length,
      levels: levelCounts,
      uniqueSirutaCodes: bySiruta.size,
      countyCodes: countyByCode.size,
      nuts3Codes: new Set(nutsByCountyCode.values()).size,
      checksumWarnings: invalidChecksums.length,
      nutsMissingValues: missingNuts.length
    },
    bySiruta,
    countyByCode
  };
}
