import { canonicalSha256 } from "./canonical-json.mjs";
import { diffTerritoryCandidates, skippedCandidateDiff } from "./candidate-diff.mjs";
import {
  identityIndexFromLedger,
  ledgerFromDecisions,
  reconcileSirutaIdentities
} from "./identity-reconciliation.mjs";
import {
  normalizeSearchName,
  shortAdministrativeName
} from "./normalization.mjs";
import { parseSirutaWorkbook } from "./siruta-parser.mjs";
import { sirutaRecordTypeDefinition } from "./siruta-types.mjs";
import {
  resolvedSirutaNuts,
  resolvedSirutaParent,
  summarizeFindings,
  validateSirutaRecords
} from "./siruta-validation.mjs";

function buildTerritories(parsed, validation, identities, configuration, options) {
  return parsed.records
    .filter((record) => record.parseStatus === "parsed")
    .map((sourceRecord) => {
      const record = sourceRecord.parsedRecord;
      const definition = sirutaRecordTypeDefinition(record, configuration);
      const territoryId = identities.territoryIds.get(record.siruta);
      const parentSiruta = resolvedSirutaParent(record, configuration);
      const parentTerritoryId = parentSiruta
        ? identities.territoryIds.get(parentSiruta) ?? null
        : null;
      const countySiruta = validation.countyByCode.get(record.countyCode);
      const countyTerritoryId = countySiruta ? identities.territoryIds.get(countySiruta) ?? null : null;
      const nutsResolution = resolvedSirutaNuts(record, configuration);
      const identifiers = [
        { scheme: "ro.ins.siruta", value: record.siruta, status: "active", validFrom: null, validTo: null }
      ];
      if (definition.administrativeRole === "county_uat" && nutsResolution.value) {
        identifiers.push({
          scheme: "eu.eurostat.nuts",
          value: nutsResolution.value,
          status: "active",
          validFrom: null,
          validTo: null
        });
      }
      identifiers.sort((left, right) => left.scheme.localeCompare(right.scheme));
      const provenance = {
        sourceSnapshotId: options.sourceSnapshotId,
        sourceRecordHash: sourceRecord.sourceRecordHash,
        transformationVersion: options.transformationVersion
      };
      if (definition.administrativeRole === "county_uat" && nutsResolution.correction) {
        provenance.sourceCorrections = [nutsResolution.correction];
      }

      return {
        territoryId,
        officialName: record.officialName,
        normalizedName: normalizeSearchName(record.officialName),
        shortName: shortAdministrativeName(record.officialName),
        territoryType: definition.territoryType,
        administrativeRole: definition.administrativeRole,
        administrativeLevel: record.level,
        parentTerritoryId,
        countyTerritoryId,
        isUat: definition.isUat,
        isLocality: definition.isLocality,
        isCountySeat: definition.isCountySeat,
        rank: null,
        status: "active",
        validFrom: null,
        validTo: null,
        identifiers,
        provenance
      };
    })
    .sort((left, right) => Number(sirutaIdentifier(left)) - Number(sirutaIdentifier(right)));
}

function sirutaIdentifier(territory) {
  return territory.identifiers.find((identifier) => identifier.scheme === "ro.ins.siruta").value;
}

export function buildSirutaCandidateFromParsed(parsed, configuration, options) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(options?.sourceSnapshotId ?? "")) {
    throw new TypeError("sourceSnapshotId must be a lowercase UUIDv7");
  }
  if (!/^[0-9a-f]{64}$/.test(options?.sourceSha256 ?? "")) {
    throw new TypeError("sourceSha256 must be lowercase SHA-256");
  }
  const structural = validateSirutaRecords(parsed, configuration);
  const parsedRecords = [
    ...new Map(
      parsed.records
        .filter((record) => record.parseStatus === "parsed")
        .map((record) => [record.parsedRecord.siruta, record])
    ).values()
  ];
  const existingIndex = options.existingIdentityIndex ?? identityIndexFromLedger(options.identityLedger);
  const identities = reconcileSirutaIdentities(parsedRecords, existingIndex, {
    uuidFactory: options.uuidFactory
  });
  let findings = [...structural.findings, ...identities.findings];
  let territories = [];

  if (summarizeFindings(findings).status === "passed") {
    territories = buildTerritories(
      parsed,
      structural,
      identities,
      configuration,
      {
        sourceSnapshotId: options.sourceSnapshotId,
        transformationVersion: configuration.transformationVersion
      }
    );
  }

  const diff = territories.length > 0
    ? diffTerritoryCandidates(options.previousCandidate, territories, configuration.diffThresholds)
    : skippedCandidateDiff("Canonical construction was blocked before a meaningful diff could be computed");
  findings = findings.concat(diff.findings);
  const summary = summarizeFindings(findings);
  const candidate = summary.status === "passed"
    ? {
        schemaVersion: "1.0.0",
        transformationVersion: configuration.transformationVersion,
        sourceSnapshotId: options.sourceSnapshotId,
        sourceSha256: options.sourceSha256,
        territories
      }
    : null;

  return {
    status: summary.status,
    summary: {
      ...summary,
      profile: structural.profile,
      territoryCount: candidate?.territories.length ?? 0,
      candidateSha256: candidate ? canonicalSha256(candidate) : null
    },
    stagingRecords: parsed.records,
    decisions: identities.decisions,
    identityLedger: ledgerFromDecisions(identities.decisions, options.identityLedger),
    findings,
    diff,
    candidate
  };
}

export async function buildSirutaCandidate(bytes, configuration, options) {
  const parsed = await parseSirutaWorkbook(bytes, configuration, options);
  return buildSirutaCandidateFromParsed(parsed, configuration, options);
}

export async function validateSirutaSnapshot(bytes, configuration, options = {}) {
  const parsed = await parseSirutaWorkbook(bytes, configuration, options);
  const validation = validateSirutaRecords(parsed, configuration);
  return {
    status: validation.status,
    profile: validation.profile,
    findings: validation.findings
  };
}
