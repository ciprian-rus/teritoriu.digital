import { readSheet } from "read-excel-file/node";

import { canonicalSha256 } from "./canonical-json.mjs";
import {
  normalizeHeader,
  normalizeRomanianText,
  optionalSourceText,
  sourceCode,
  sourceInteger
} from "./normalization.mjs";
import { inspectXlsxContainer } from "./xlsx-container.mjs";

export class SirutaParseError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = "SirutaParseError";
    this.code = code;
    this.context = context;
  }
}

function rawCell(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

function rowIsEmpty(row) {
  return row.every((value) => value === null || value === undefined || String(value).trim() === "");
}

function parseLevel(value) {
  if (typeof value === "string") {
    const match = value.trim().toLocaleUpperCase("ro-RO").match(/^NIVEL\s*([1-3])$/);
    if (match) return Number(match[1]);
  }
  return sourceInteger(value, "NIV", { minimum: 1, maximum: 3 });
}

function parseRecord(rawRecord) {
  const officialName = normalizeRomanianText(rawRecord.DENLOC);
  if (!officialName) throw new TypeError("DENLOC is required");
  return {
    siruta: sourceCode(rawRecord.SIRUTA, "SIRUTA", { maximum: 999999 }),
    officialName,
    postalCode: sourceCode(rawRecord.CODP, "CODP", { allowZero: true, maximum: 999999 }),
    countyCode: sourceCode(rawRecord.JUD, "JUD", { maximum: 99 }),
    parentSiruta: sourceCode(rawRecord.SIRSUP, "SIRSUP", { allowZero: true, maximum: 999999 }),
    typeCode: sourceInteger(rawRecord.TIP, "TIP", { minimum: 1, maximum: 99 }),
    level: parseLevel(rawRecord.NIV),
    environmentCode: sourceInteger(rawRecord.MED, "MED", { allowZero: true, maximum: 9 }),
    developmentRegionCode: sourceInteger(rawRecord.REGIUNE, "REGIUNE", {
      allowZero: true,
      maximum: 9
    }),
    fsj: sourceInteger(rawRecord.FSJ, "FSJ", { allowZero: true, maximum: 99 }),
    fsl: sourceInteger(rawRecord.FSL, "FSL", { allowZero: true, maximum: 99 }),
    nuts: optionalSourceText(rawRecord.NUTS)?.toLocaleUpperCase("ro-RO") ?? null
  };
}

export function parseSirutaRows(workbookRows, configuration) {
  if (!Array.isArray(workbookRows) || workbookRows.length < 2) {
    throw new SirutaParseError("SIRUTA_WORKBOOK_EMPTY", "The workbook must contain a header and data rows");
  }

  const nonEmptyRows = workbookRows
    .map((row, index) => ({ row, rowNumber: index + 1 }))
    .filter(({ row }) => Array.isArray(row) && !rowIsEmpty(row));
  if (nonEmptyRows.length < 2) {
    throw new SirutaParseError("SIRUTA_WORKBOOK_EMPTY", "The workbook must contain a header and data rows");
  }

  const headers = nonEmptyRows[0].row.map(normalizeHeader);
  const expectedHeaders = configuration.expectedHeaders.map(normalizeHeader);
  if (canonicalSha256(headers) !== canonicalSha256(expectedHeaders)) {
    throw new SirutaParseError(
      "SIRUTA_HEADERS_CHANGED",
      "The SIRUTA workbook header does not match the reviewed 2025 contract",
      { expectedHeaders, observedHeaders: headers }
    );
  }

  const records = [];
  const findings = [];
  for (const { row, rowNumber } of nonEmptyRows.slice(1)) {
    if (row.length > headers.length && !rowIsEmpty(row.slice(headers.length))) {
      findings.push({
        ruleCode: "SIRUTA_EXTRA_CELLS",
        ruleVersion: "1.0.0",
        severity: "error",
        entityKind: "source_record",
        entityKey: `row:${rowNumber}`,
        message: "The source row contains cells outside the reviewed header",
        evidence: { rowNumber, observedCellCount: row.length, expectedCellCount: headers.length }
      });
    }

    const rawRecord = Object.fromEntries(
      headers.map((header, cellIndex) => [header, rawCell(row[cellIndex] ?? null)])
    );
    const sourceRecordHash = canonicalSha256(rawRecord);
    let parsedRecord = null;
    let parseStatus = "parsed";
    try {
      parsedRecord = parseRecord(rawRecord);
    } catch (error) {
      parseStatus = "invalid";
      findings.push({
        ruleCode: "SIRUTA_RECORD_INVALID",
        ruleVersion: "1.0.0",
        severity: "error",
        entityKind: "source_record",
        entityKey: `row:${rowNumber}`,
        message: error.message,
        evidence: { rowNumber, sourceRecordHash }
      });
    }

    records.push({
      rowNumber,
      sourceRecordKey: `row:${rowNumber}`,
      sourceRecordHash,
      rawRecord,
      parsedRecord,
      parseStatus
    });
  }

  return { headers, records, findings };
}

export async function parseSirutaWorkbook(bytes, configuration, options = {}) {
  (options.containerInspector ?? inspectXlsxContainer)(bytes, configuration.xlsxLimits);
  const rows = await (options.reader ?? readSheet)(bytes, { sheet: 1 });
  return parseSirutaRows(rows, configuration);
}
