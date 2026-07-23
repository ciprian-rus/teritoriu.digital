import test from "node:test";
import assert from "node:assert/strict";

import {
  parseSirutaRows,
  parseSirutaWorkbook
} from "../../packages/pipeline/src/canonical/siruta-parser.mjs";
import {
  sirutaChecksumIsValid,
  validateSirutaRecords
} from "../../packages/pipeline/src/canonical/siruta-validation.mjs";
import {
  CONFIGURATION,
  HEADERS,
  cloneRows,
  parsedFixture
} from "./fixture.mjs";

test("parses the reviewed columns, normalizes Romanian text and preserves physical row numbers", () => {
  const rows = cloneRows();
  rows.splice(1, 0, []);
  rows[2][1] = "  JUDEŢUL   TEST  ";

  const parsed = parseSirutaRows(rows, CONFIGURATION);
  assert.deepEqual(parsed.headers, HEADERS);
  assert.equal(parsed.records[0].rowNumber, 3);
  assert.equal(parsed.records[0].sourceRecordKey, "row:3");
  assert.equal(parsed.records[0].parsedRecord.officialName, "JUDEȚUL TEST");
  assert.equal(parsed.records[0].parsedRecord.siruta, "1");
  assert.equal(parsed.records[0].parsedRecord.parentSiruta, "1");
  assert.equal(parsed.records[0].parsedRecord.fsl, "0100000000000");
  assert.match(parsed.records[0].sourceRecordHash, /^[0-9a-f]{64}$/);
});

test("preserves FSL as a 13-digit textual classification code and rejects lossy values", () => {
  const parsed = parseSirutaRows(cloneRows(), CONFIGURATION);
  assert.equal(parsed.records[0].parsedRecord.fsl, "0100000000000");

  const shortCodeRows = cloneRows();
  shortCodeRows[1][10] = "100";
  const shortCode = parseSirutaRows(shortCodeRows, CONFIGURATION);
  assert.equal(shortCode.records[0].parseStatus, "invalid");
  assert.equal(
    shortCode.findings.find((item) => item.ruleCode === "SIRUTA_RECORD_INVALID")?.message,
    "FSL must be a 13-digit classification code"
  );

  const numericRows = cloneRows();
  numericRows[1][10] = 100000000000;
  const numeric = parseSirutaRows(numericRows, CONFIGURATION);
  assert.equal(numeric.records[0].parseStatus, "invalid");
});

test("fails closed when the workbook header changes", () => {
  const rows = cloneRows();
  rows[0][1] = "DENUMIRE_NOUA";
  assert.throws(() => parseSirutaRows(rows, CONFIGURATION), {
    code: "SIRUTA_HEADERS_CHANGED"
  });
});

test("keeps malformed and over-wide source rows as auditable invalid staging evidence", () => {
  const rows = cloneRows();
  rows[1][0] = "not-a-code";
  rows[2].push("unexpected");
  const parsed = parseSirutaRows(rows, CONFIGURATION);

  assert.equal(parsed.records[0].parseStatus, "invalid");
  assert.equal(parsed.records[0].parsedRecord, null);
  assert.ok(parsed.findings.some((item) => item.ruleCode === "SIRUTA_RECORD_INVALID"));
  assert.ok(parsed.findings.some((item) => item.ruleCode === "SIRUTA_EXTRA_CELLS"));
});

test("delegates workbook decoding through an injectable sheet reader", async () => {
  let observedOptions;
  const parsed = await parseSirutaWorkbook(Buffer.from("fixture"), CONFIGURATION, {
    containerInspector: () => ({ entryCount: 3 }),
    reader: async (_bytes, options) => {
      observedOptions = options;
      return cloneRows();
    }
  });
  assert.deepEqual(observedOptions, { sheet: 1 });
  assert.equal(parsed.records.length, 3);
});

test("decodes a real XLSX worksheet with the reviewed 12-column contract", async () => {
  const workbook = Buffer.from("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", "base64");
  const parsed = await parseSirutaWorkbook(workbook, CONFIGURATION);

  assert.deepEqual(parsed.headers, HEADERS);
  assert.equal(parsed.headers.length, 12);
  assert.equal(parsed.records.length, CONFIGURATION.expectedProfile.totalRows);
  assert.equal(parsed.records[0].parsedRecord.officialName, "JUDEȚUL TEST");
  assert.equal(parsed.records[0].parsedRecord.fsl, "0100000000000");
  assert.equal(parsed.records[2].parsedRecord.level, 3);
});

test("validates the hierarchy and reports the reviewed source-quality warnings", () => {
  const result = validateSirutaRecords(parsedFixture(), CONFIGURATION);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.profile.levels, { "1": 1, "2": 1, "3": 1 });
  assert.equal(result.profile.uniqueSirutaCodes, 3);
  assert.equal(result.profile.rootParentSentinels, 1);
  assert.equal(result.findings.some((item) => item.ruleCode === "SIRUTA_PARENT_MISSING"), false);
  assert.equal(result.findings.some((item) => item.ruleCode === "SIRUTA_ROOT_PARENT_INVALID"), false);
  assert.ok(result.findings.some((item) => item.ruleCode === "SIRUTA_CHECKSUM_OFFICIAL_WARNING"));
  assert.ok(result.findings.some((item) => item.ruleCode === "SIRUTA_NUTS_MISSING_VALUES"));
});

test("blocks duplicate identifiers, broken parents and unreviewed type codes", () => {
  const duplicateRows = cloneRows();
  duplicateRows[3][0] = 2;
  const duplicate = validateSirutaRecords(parseSirutaRows(duplicateRows, CONFIGURATION), CONFIGURATION);
  assert.equal(duplicate.status, "blocked");
  assert.ok(duplicate.findings.some((item) => item.ruleCode === "SIRUTA_DUPLICATE_CODE"));

  const parentRows = cloneRows();
  parentRows[3][4] = 1;
  const parent = validateSirutaRecords(parseSirutaRows(parentRows, CONFIGURATION), CONFIGURATION);
  assert.ok(parent.findings.some((item) => item.ruleCode === "SIRUTA_PARENT_LEVEL_INVALID"));

  const rootRows = cloneRows();
  rootRows[1][4] = 2;
  const root = validateSirutaRecords(parseSirutaRows(rootRows, CONFIGURATION), CONFIGURATION);
  assert.ok(root.findings.some((item) => item.ruleCode === "SIRUTA_ROOT_PARENT_INVALID"));

  const orphanRows = cloneRows();
  orphanRows[2][4] = 0;
  const orphan = validateSirutaRecords(parseSirutaRows(orphanRows, CONFIGURATION), CONFIGURATION);
  assert.ok(orphan.findings.some((item) => item.ruleCode === "SIRUTA_REQUIRED_PARENT_MISSING"));

  const typeRows = cloneRows();
  typeRows[2][5] = 99;
  const type = validateSirutaRecords(parseSirutaRows(typeRows, CONFIGURATION), CONFIGURATION);
  assert.ok(type.findings.some((item) => item.ruleCode === "SIRUTA_UNKNOWN_TYPE"));

  const nutsRows = cloneRows();
  nutsRows[2][11] = "RO999";
  const nuts = validateSirutaRecords(parseSirutaRows(nutsRows, CONFIGURATION), CONFIGURATION);
  assert.ok(nuts.findings.some((item) => item.ruleCode === "SIRUTA_NUTS_COUNTY_CONFLICT"));
});

test("implements the published checksum algorithm without rewriting official codes", () => {
  assert.equal(sirutaChecksumIsValid("1"), true);
  assert.equal(sirutaChecksumIsValid("2"), false);
  assert.equal(sirutaChecksumIsValid("1000000"), false);
});
