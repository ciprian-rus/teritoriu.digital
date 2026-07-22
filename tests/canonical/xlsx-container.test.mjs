import test from "node:test";
import assert from "node:assert/strict";

import { inspectXlsxContainer } from "../../packages/pipeline/src/canonical/xlsx-container.mjs";

const limits = {
  maxEntries: 10,
  maxUncompressedBytes: 10_000,
  maxEntryUncompressedBytes: 5_000,
  maxCompressionRatio: 100
};

function centralDirectory(entries) {
  let localOffset = 0;
  const locals = [];
  const records = entries.map((entry) => {
    const name = Buffer.from(entry.name);
    const flags = 0x0800 | (entry.encrypted ? 1 : 0);
    const method = entry.method ?? 8;
    const compressedBytes = entry.compressedBytes ?? 10;
    const uncompressedBytes = entry.uncompressedBytes ?? 20;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(compressedBytes, 18);
    local.writeUInt32LE(uncompressedBytes, 22);
    local.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([local, name, Buffer.alloc(compressedBytes)]);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(compressedBytes, 20);
    header.writeUInt32LE(uncompressedBytes, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(localOffset, 42);
    locals.push(localRecord);
    localOffset += localRecord.length;
    return Buffer.concat([header, name]);
  });
  const localData = Buffer.concat(locals);
  const directory = Buffer.concat(records);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, directory, eocd]);
}

function requiredEntries(overrides = {}) {
  return [
    { name: "[Content_Types].xml", ...overrides.contentTypes },
    { name: "xl/workbook.xml", ...overrides.workbook },
    { name: "xl/worksheets/sheet1.xml", ...overrides.sheet }
  ];
}

test("accepts a bounded single-disk XLSX central directory", () => {
  const result = inspectXlsxContainer(centralDirectory(requiredEntries()), limits);
  assert.deepEqual(result, {
    entryCount: 3,
    totalUncompressedBytes: 60,
    requiredEntriesPresent: true
  });
});

test("rejects encrypted entries, unsafe paths and missing workbook parts", () => {
  assert.throws(
    () => inspectXlsxContainer(
      centralDirectory(requiredEntries({ sheet: { encrypted: true } })),
      limits
    ),
    { code: "XLSX_ZIP_ENCRYPTED" }
  );
  assert.throws(
    () => inspectXlsxContainer(
      centralDirectory([...requiredEntries(), { name: "../escape.xml" }]),
      limits
    ),
    { code: "XLSX_ZIP_PATH_UNSAFE" }
  );
  assert.throws(
    () => inspectXlsxContainer(
      centralDirectory(requiredEntries().filter((entry) => entry.name !== "xl/workbook.xml")),
      limits
    ),
    { code: "XLSX_REQUIRED_ENTRY_MISSING" }
  );
});

test("rejects decompression bombs by entry, total and compression ratio", () => {
  assert.throws(
    () => inspectXlsxContainer(
      centralDirectory(requiredEntries({ sheet: { uncompressedBytes: 5001 } })),
      limits
    ),
    { code: "XLSX_ZIP_ENTRY_SIZE_LIMIT" }
  );
  assert.throws(
    () => inspectXlsxContainer(
      centralDirectory(requiredEntries({ sheet: { compressedBytes: 1, uncompressedBytes: 101 } })),
      limits
    ),
    { code: "XLSX_ZIP_RATIO_LIMIT" }
  );
  assert.throws(
    () => inspectXlsxContainer(
      centralDirectory(requiredEntries({
        contentTypes: { uncompressedBytes: 4000 },
        workbook: { uncompressedBytes: 4000 },
        sheet: { uncompressedBytes: 4000 }
      })),
      { ...limits, maxUncompressedBytes: 10_000, maxCompressionRatio: 1000 }
    ),
    { code: "XLSX_ZIP_TOTAL_SIZE_LIMIT" }
  );
});
