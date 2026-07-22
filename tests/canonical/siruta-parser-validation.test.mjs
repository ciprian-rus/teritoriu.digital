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

test("delegates workbook decoding through an injectable reader", async () => {
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
