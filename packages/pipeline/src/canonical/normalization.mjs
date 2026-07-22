const DIACRITIC_FIXES = new Map([
  ["Ş", "Ș"],
  ["ş", "ș"],
  ["Ţ", "Ț"],
  ["ţ", "ț"]
]);

const ADMINISTRATIVE_PREFIX = /^(?:JUDEȚUL|JUDEŢUL|MUNICIPIUL|ORAȘUL|ORAŞUL|ORAȘ|ORAŞ|COMUNA|SECTORUL)\s+/iu;

export function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("ro-RO");
}

export function normalizeRomanianText(value) {
  let result = String(value ?? "").normalize("NFKC");
  for (const [from, to] of DIACRITIC_FIXES) result = result.replaceAll(from, to);
  return result.trim().replace(/\s+/g, " ");
}

export function normalizeSearchName(value) {
  return normalizeRomanianText(value).toLocaleLowerCase("ro-RO");
}

export function shortAdministrativeName(value) {
  const official = normalizeRomanianText(value);
  const short = official.replace(ADMINISTRATIVE_PREFIX, "").trim();
  return short || official;
}

export function sourceInteger(value, field, options = {}) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (options.optional) return null;
    throw new TypeError(`${field} is required`);
  }

  const asText = typeof value === "number" ? String(value) : String(value).trim();
  if (!/^\d+(?:\.0+)?$/.test(asText)) throw new TypeError(`${field} must be an integer`);
  const normalized = asText.replace(/\.0+$/, "");
  const number = Number(normalized);
  if (!Number.isSafeInteger(number)) throw new TypeError(`${field} is outside the safe integer range`);
  if (!options.allowZero && number === 0) throw new TypeError(`${field} must be greater than zero`);
  if (options.minimum !== undefined && number < options.minimum) {
    throw new TypeError(`${field} must be at least ${options.minimum}`);
  }
  if (options.maximum !== undefined && number > options.maximum) {
    throw new TypeError(`${field} must be at most ${options.maximum}`);
  }
  return number;
}

export function sourceCode(value, field, options = {}) {
  const number = sourceInteger(value, field, options);
  return number === null ? null : String(number);
}

export function optionalSourceText(value) {
  if (value === null || value === undefined) return null;
  const normalized = normalizeRomanianText(value);
  return normalized === "" ? null : normalized;
}
