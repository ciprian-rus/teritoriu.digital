const DIACRITIC_FOLD = new Map([
  ["ă", "a"],
  ["â", "a"],
  ["î", "i"],
  ["ș", "s"],
  ["ț", "t"],
  ["ş", "s"],
  ["ţ", "t"]
]);

export function foldDiacritics(value) {
  let result = String(value ?? "").toLocaleLowerCase("ro-RO");
  for (const [from, to] of DIACRITIC_FOLD) result = result.replaceAll(from, to);
  return result;
}

const SIRUTA_SCHEME = "ro.ins.siruta";

// officialName/normalizedName are static for a given territory object, but
// foldDiacritics does a locale-aware lowercase plus several replaceAlls —
// expensive enough that folding all ~17k territories on every single search
// request (rather than once, ever, per territory) dominated request latency
// under load. Keyed by object identity so it costs nothing for callers
// (like tests) that build fresh territory objects per case.
const foldedNameCache = new WeakMap();

function foldedNames(territory) {
  let cached = foldedNameCache.get(territory);
  if (!cached) {
    cached = {
      officialName: foldDiacritics(territory.officialName),
      normalizedName: foldDiacritics(territory.normalizedName)
    };
    foldedNameCache.set(territory, cached);
  }
  return cached;
}

function matchesQuery(territory, foldedQuery) {
  if (!foldedQuery) return true;
  const folded = foldedNames(territory);
  return folded.officialName.includes(foldedQuery) || folded.normalizedName.includes(foldedQuery);
}

function matchesSiruta(territory, siruta) {
  if (!siruta) return true;
  return territory.identifiers.some(
    (identifier) => identifier.scheme === SIRUTA_SCHEME && identifier.value === siruta
  );
}

/**
 * Filters and paginates the verified territories list deterministically by
 * territoryId (UUIDv7, so insertion-ordered), using an opaque cursor. Filtering
 * happens against the same normalized/diacritic-folded fields on every call, so
 * results are stable across pages for a fixed release + query.
 */
export function searchTerritories(territories, params = {}) {
  const foldedQuery = params.q ? foldDiacritics(params.q) : null;
  const limit = clampLimit(params.limit);
  const cursor = decodeCursor(params.cursor);

  const filtered = territories.filter((territory) => {
    if (params.territoryId && territory.territoryId !== params.territoryId) return false;
    if (params.type && territory.territoryType !== params.type) return false;
    if (params.status && territory.status !== params.status) return false;
    if (params.countyTerritoryId && territory.countyTerritoryId !== params.countyTerritoryId) return false;
    if (!matchesSiruta(territory, params.siruta)) return false;
    if (!matchesQuery(territory, foldedQuery)) return false;
    return true;
  });

  filtered.sort((a, b) => (a.territoryId < b.territoryId ? -1 : a.territoryId > b.territoryId ? 1 : 0));

  const start = cursor ? filtered.findIndex((territory) => territory.territoryId > cursor) : 0;
  if (start === -1) {
    return { items: [], nextCursor: null, total: filtered.length };
  }

  const page = filtered.slice(start, start + limit);
  const nextCursor =
    start + limit < filtered.length ? encodeCursor(page[page.length - 1].territoryId) : null;

  return { items: page, nextCursor, total: filtered.length };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function encodeCursor(territoryId) {
  return Buffer.from(territoryId, "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
