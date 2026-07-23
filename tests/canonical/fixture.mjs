import { parseSirutaRows } from "../../packages/pipeline/src/canonical/siruta-parser.mjs";

export const HEADERS = [
  "SIRUTA",
  "DENLOC",
  "CODP",
  "JUD",
  "SIRSUP",
  "TIP",
  "NIV",
  "MED",
  "REGIUNE",
  "FSJ",
  "FSL",
  "NUTS"
];

export const ROWS = [
  HEADERS,
  [1, "JUDEȚUL TEST", 0, 1, 1, 40, 1, 0, 1, 0, "0100000000000", "RO000"],
  [2, "COMUNA TEST", 0, 1, 1, 3, 2, 3, 1, 0, "0101000000000", null],
  [3, "SAT TEST", 0, 1, 2, 22, 3, 3, 1, 0, "0101010000000", null]
];

export const CONFIGURATION = {
  schemaVersion: 1,
  transformationVersion: "siruta-test.1.0.0",
  expectedHeaders: HEADERS,
  expectedProfile: {
    totalRows: 3,
    levels: { "1": 1, "2": 1, "3": 1 },
    checksumWarnings: 2,
    nutsMissingValues: 2
  },
  reviewedSourceExceptions: {
    rootParentSentinel: {
      value: "1",
      sourceLevel: 1,
      expectedCount: 1
    },
    recordTypeDefinitions: {}
  },
  xlsxLimits: {
    maxEntries: 32,
    maxUncompressedBytes: 1024 * 1024,
    maxEntryUncompressedBytes: 512 * 1024,
    maxCompressionRatio: 200
  },
  diffThresholds: {
    maxTotalDeltaRatio: 0.02,
    maxRemovedRatio: 0.01,
    maxChangedRatio: 0.25
  }
};

export const SNAPSHOT_ID = "018f0000-0000-7000-8000-0000000000aa";
export const SOURCE_SHA256 = "a".repeat(64);

export function cloneRows() {
  return structuredClone(ROWS);
}

export function parsedFixture(rows = cloneRows(), configuration = CONFIGURATION) {
  return parseSirutaRows(rows, configuration);
}

export function uuidSequence(start = 1) {
  let value = start;
  return () => {
    const suffix = value.toString(16).padStart(12, "0");
    value += 1;
    return `018f0000-0000-7000-8000-${suffix}`;
  };
}
