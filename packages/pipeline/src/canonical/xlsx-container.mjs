const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_ZIP_COMMENT_BYTES = 65535;
const REQUIRED_ENTRIES = new Set([
  "[Content_Types].xml",
  "xl/workbook.xml",
  "xl/worksheets/sheet1.xml"
]);

export class XlsxContainerError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = "XlsxContainerError";
    this.code = code;
    this.context = context;
  }
}

function fail(code, message, context) {
  throw new XlsxContainerError(code, message, context);
}

function findEndOfCentralDirectory(buffer) {
  const lowerBound = Math.max(0, buffer.length - 22 - MAX_ZIP_COMMENT_BYTES);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (
      buffer.readUInt32LE(offset) === EOCD_SIGNATURE &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) return offset;
  }
  fail("XLSX_ZIP_DIRECTORY_MISSING", "The XLSX ZIP central directory is missing");
}

function assertSafeEntryName(name) {
  if (
    !name ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").includes("..") ||
    name.includes("\0")
  ) {
    fail("XLSX_ZIP_PATH_UNSAFE", "The XLSX container contains an unsafe entry path", { name });
  }
}

function assertLimits(limits) {
  for (const field of [
    "maxEntries",
    "maxUncompressedBytes",
    "maxEntryUncompressedBytes",
    "maxCompressionRatio"
  ]) {
    if (!Number.isFinite(limits?.[field]) || limits[field] <= 0) {
      throw new TypeError(`xlsxLimits.${field} must be a positive number`);
    }
  }
}

export function inspectXlsxContainer(bytes, limits) {
  assertLimits(limits);
  const buffer = Buffer.from(bytes);
  if (buffer.length < 22) {
    fail("XLSX_ZIP_TRUNCATED", "The XLSX container is too short to contain a ZIP directory");
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const commentLength = buffer.readUInt16LE(eocdOffset + 20);

  if (eocdOffset + 22 + commentLength !== buffer.length) {
    fail("XLSX_ZIP_TRAILING_DATA", "The XLSX ZIP directory has an invalid comment or trailing data");
  }
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    fail("XLSX_ZIP_MULTIDISK_UNSUPPORTED", "Multi-disk XLSX containers are not accepted");
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    fail("XLSX_ZIP64_UNSUPPORTED", "ZIP64 XLSX containers require a separate reviewed limit policy");
  }
  if (totalEntries === 0 || totalEntries > limits.maxEntries) {
    fail("XLSX_ZIP_ENTRY_LIMIT", "The XLSX entry count exceeds the approved limit", {
      observed: totalEntries,
      maximum: limits.maxEntries
    });
  }

  const centralEnd = centralOffset + centralSize;
  if (centralOffset > eocdOffset || centralEnd !== eocdOffset) {
    fail("XLSX_ZIP_DIRECTORY_INVALID", "The XLSX central directory boundaries are invalid");
  }

  const names = new Set();
  const localRanges = [];
  let totalUncompressedBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralEnd || buffer.readUInt32LE(cursor) !== CENTRAL_FILE_SIGNATURE) {
      fail("XLSX_ZIP_DIRECTORY_INVALID", "The XLSX central directory contains an invalid file header", {
        index
      });
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedBytes = buffer.readUInt32LE(cursor + 20);
    const uncompressedBytes = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const entryCommentLength = buffer.readUInt16LE(cursor + 32);
    const entryDisk = buffer.readUInt16LE(cursor + 34);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const headerLength = 46 + nameLength + extraLength + entryCommentLength;
    if (cursor + headerLength > centralEnd) {
      fail("XLSX_ZIP_DIRECTORY_INVALID", "An XLSX central-directory entry is truncated", { index });
    }
    if (entryDisk !== 0) {
      fail("XLSX_ZIP_MULTIDISK_UNSUPPORTED", "An XLSX entry points to another ZIP disk", { index });
    }
    if ((flags & 0x0001) !== 0) {
      fail("XLSX_ZIP_ENCRYPTED", "Encrypted XLSX entries are not accepted", { index });
    }
    if (![0, 8].includes(compressionMethod)) {
      fail("XLSX_ZIP_COMPRESSION_UNSUPPORTED", "The XLSX uses an unreviewed compression method", {
        index,
        compressionMethod
      });
    }
    if (
      compressedBytes === 0xffffffff ||
      uncompressedBytes === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      fail("XLSX_ZIP64_UNSUPPORTED", "ZIP64 XLSX entries are not accepted", { index });
    }

    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    if (nameBytes.some((value) => value > 0x7f)) {
      fail("XLSX_ZIP_NAME_ENCODING", "XLSX entry names must use the reviewed ASCII OOXML paths", {
        index
      });
    }
    const name = nameBytes.toString("ascii");
    assertSafeEntryName(name);
    if (names.has(name)) {
      fail("XLSX_ZIP_DUPLICATE_ENTRY", "The XLSX contains duplicate ZIP entry names", { name });
    }
    names.add(name);

    if (localHeaderOffset + 30 > centralOffset || buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
      fail("XLSX_ZIP_LOCAL_HEADER_INVALID", "An XLSX entry has an invalid local file header", {
        name
      });
    }
    const localFlags = buffer.readUInt16LE(localHeaderOffset + 6);
    const localMethod = buffer.readUInt16LE(localHeaderOffset + 8);
    const localCompressedBytes = buffer.readUInt32LE(localHeaderOffset + 18);
    const localUncompressedBytes = buffer.readUInt32LE(localHeaderOffset + 22);
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const localNameStart = localHeaderOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedBytes;
    if (dataStart > centralOffset || dataEnd > centralOffset) {
      fail("XLSX_ZIP_LOCAL_HEADER_INVALID", "An XLSX entry points outside the local-data area", {
        name
      });
    }
    const localName = buffer.subarray(localNameStart, localNameStart + localNameLength);
    if (!localName.equals(nameBytes) || localFlags !== flags || localMethod !== compressionMethod) {
      fail("XLSX_ZIP_HEADER_MISMATCH", "The XLSX local and central ZIP headers disagree", { name });
    }
    const usesDataDescriptor = (flags & 0x0008) !== 0;
    if (
      !usesDataDescriptor &&
      (localCompressedBytes !== compressedBytes || localUncompressedBytes !== uncompressedBytes)
    ) {
      fail("XLSX_ZIP_HEADER_MISMATCH", "The XLSX local and central entry sizes disagree", { name });
    }
    if (
      usesDataDescriptor &&
      ((localCompressedBytes !== 0 && localCompressedBytes !== compressedBytes) ||
        (localUncompressedBytes !== 0 && localUncompressedBytes !== uncompressedBytes))
    ) {
      fail("XLSX_ZIP_HEADER_MISMATCH", "The XLSX data-descriptor sizes are inconsistent", { name });
    }
    localRanges.push({ start: localHeaderOffset, end: dataEnd, name });

    if (uncompressedBytes > limits.maxEntryUncompressedBytes) {
      fail("XLSX_ZIP_ENTRY_SIZE_LIMIT", "An XLSX entry exceeds the decompressed size limit", {
        name,
        observed: uncompressedBytes,
        maximum: limits.maxEntryUncompressedBytes
      });
    }
    if (compressedBytes === 0 && uncompressedBytes > 0) {
      fail("XLSX_ZIP_RATIO_LIMIT", "A non-empty XLSX entry declares zero compressed bytes", {
        name
      });
    }
    if (compressionMethod === 0 && compressedBytes !== uncompressedBytes) {
      fail("XLSX_ZIP_HEADER_MISMATCH", "A stored XLSX entry must have equal compressed and raw sizes", {
        name
      });
    }
    const compressionRatio = uncompressedBytes / Math.max(compressedBytes, 1);
    if (compressionRatio > limits.maxCompressionRatio) {
      fail("XLSX_ZIP_RATIO_LIMIT", "An XLSX entry exceeds the approved compression ratio", {
        name,
        observed: compressionRatio,
        maximum: limits.maxCompressionRatio
      });
    }
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > limits.maxUncompressedBytes) {
      fail("XLSX_ZIP_TOTAL_SIZE_LIMIT", "The XLSX exceeds the total decompressed size limit", {
        observed: totalUncompressedBytes,
        maximum: limits.maxUncompressedBytes
      });
    }
    cursor += headerLength;
  }

  if (cursor !== centralEnd) {
    fail("XLSX_ZIP_DIRECTORY_INVALID", "The XLSX central directory contains unparsed bytes");
  }
  localRanges.sort((left, right) => left.start - right.start);
  if (localRanges[0]?.start !== 0) {
    fail("XLSX_ZIP_LEADING_DATA", "The XLSX container has unreviewed data before its first ZIP entry");
  }
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index].start < localRanges[index - 1].end) {
      fail("XLSX_ZIP_LOCAL_OVERLAP", "XLSX local file entries overlap", {
        previous: localRanges[index - 1].name,
        current: localRanges[index].name
      });
    }
  }
  for (const required of REQUIRED_ENTRIES) {
    if (!names.has(required)) {
      fail("XLSX_REQUIRED_ENTRY_MISSING", "The ZIP container is not the reviewed XLSX workbook shape", {
        required
      });
    }
  }

  return {
    entryCount: totalEntries,
    totalUncompressedBytes,
    requiredEntriesPresent: true
  };
}
