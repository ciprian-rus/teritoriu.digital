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
  assert.match(parsed.records[0].sourceRecordHash, /^[0-9a-f]{64}$/);
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
  assert.equal(parsed.records[2].parsedRecord.level, 3);
});

test("validates the hierarchy and reports the reviewed source-quality warnings", () => {
  const result = validateSirutaRecords(parsedFixture(), CONFIGURATION);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.profile.levels, { "1": 1, "2": 1, "3": 1 });
  assert.equal(result.profile.uniqueSirutaCodes, 3);
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
