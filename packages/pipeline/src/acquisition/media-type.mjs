const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function normalizeMediaType(value) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

export function detectMediaType(bytes) {
  const buffer = Buffer.from(bytes);
  const hasZipSignature =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(buffer[2]) &&
    [0x04, 0x06, 0x08].includes(buffer[3]);

  if (
    hasZipSignature &&
    buffer.includes(Buffer.from("[Content_Types].xml")) &&
    buffer.includes(Buffer.from("xl/workbook.xml"))
  ) {
    return XLSX_MEDIA_TYPE;
  }
  if (hasZipSignature) {
    return "application/zip";
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  const text = sample.toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      JSON.parse(buffer.toString("utf8"));
      return "application/json";
    } catch {
      // Fall through to the conservative binary/text checks.
    }
  }
  if (text.startsWith("<?xml") || text.startsWith("<")) {
    return "application/xml";
  }
  if (!sample.includes(0) && /[;,\t]/.test(text) && /\r?\n/.test(text)) {
    return "text/csv";
  }
  return "application/octet-stream";
}

export function assertExpectedMediaType(bytes, declaredMediaType, expectedMediaTypes) {
  const detectedMediaType = detectMediaType(bytes);
  if (!expectedMediaTypes.includes(detectedMediaType)) {
    const error = new Error(`Detected media type ${detectedMediaType} is not expected`);
    error.code = "MEDIA_TYPE_UNEXPECTED";
    throw error;
  }
  const declared = normalizeMediaType(declaredMediaType);
  return {
    declaredMediaType: declared,
    detectedMediaType,
    declaredTypeMismatch: declared !== null && declared !== detectedMediaType
  };
}

export { XLSX_MEDIA_TYPE };
