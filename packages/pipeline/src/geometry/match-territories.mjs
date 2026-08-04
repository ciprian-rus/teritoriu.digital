const ADMINISTRATIVE_PREFIX = /^(?:JUDEȚUL|JUDEŢUL|MUNICIPIUL|ORAȘUL|ORAŞUL|ORAȘ|ORAŞ|COMUNA|SECTORUL)\s+/iu;

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(ADMINISTRATIVE_PREFIX, (match) => (/SECTORUL/iu.test(match) ? "SECTOR " : ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function codeCandidates(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  const candidates = new Set([raw]);
  for (const match of raw.matchAll(/\d+/g)) {
    candidates.add(match[0]);
    candidates.add(String(Number.parseInt(match[0], 10)));
  }
  return [...candidates].filter(Boolean);
}

function isSupportedGeometry(geometry) {
  return Boolean(
    geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon") && Array.isArray(geometry.coordinates)
  );
}

function bounds(geometry) {
  const points = [];
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      points.push(value);
      return;
    }
    for (const child of value) visit(child);
  };
  visit(geometry.coordinates);
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Matches ANCPI RELUAT features to this registry's own territories, using
 * the SIRUTA code first (ANCPI's own `nationalCode` field) and falling back
 * to name matching scoped by administrative level — county-level features by
 * name alone, UAT-level features by name scoped to their parent county
 * (resolved through the feature's own upperLevelUnit link, not assumed).
 *
 * Fails closed on ambiguity: if two distinct features would both claim the
 * same territory, that pair is reported as a conflict rather than one
 * silently overwriting the other — a real ANCPI/SIRUTA mismatch needs a
 * human decision, not a coin flip.
 */
export function matchFeaturesToTerritories(features, territories) {
  const bySiruta = new Map();
  const countyByName = new Map();
  const unitsByScopedName = new Map();
  for (const territory of territories) {
    for (const code of codeCandidates(territory.sirutaCode)) bySiruta.set(code, territory);
    if (territory.territoryType === "county" || territory.territoryType === "bucharest") {
      countyByName.set(normalizeName(territory.shortName || territory.officialName), territory);
    } else {
      const key = `${territory.countyTerritoryId}:${normalizeName(territory.shortName || territory.officialName)}`;
      const bucket = unitsByScopedName.get(key) ?? [];
      bucket.push(territory);
      unitsByScopedName.set(key, bucket);
    }
  }

  const featureById = new Map();
  for (const feature of features) {
    const id = feature?.properties?.featureId;
    if (id !== null && id !== undefined) featureById.set(String(id), feature);
  }

  const matchedByTerritoryId = new Map();
  const conflicts = [];
  const unmatched = [];

  for (const feature of features) {
    const properties = feature.properties ?? {};
    const geometry = feature.geometry;
    if (!isSupportedGeometry(geometry)) {
      unmatched.push({ reason: "unsupported_geometry", properties });
      continue;
    }

    let territory = null;
    for (const candidate of codeCandidates(properties.nationalCode)) {
      territory = bySiruta.get(candidate);
      if (territory) break;
    }

    const featureName = properties.name_1 || properties.name_2 || properties.name_3 || properties.nationalCode;
    const normalizedFeatureName = normalizeName(featureName);
    const level = String(properties.nationalLevel ?? "");

    if (!territory && level.includes("2ndOrder")) {
      territory = countyByName.get(normalizedFeatureName) ?? null;
    }

    if (!territory && level.includes("3rdOrder")) {
      const parentFeature = featureById.get(String(properties.upperLevelUnit ?? ""));
      const parentProperties = parentFeature?.properties ?? {};
      const parentName = normalizeName(parentProperties.name_1 || parentProperties.name_2 || parentProperties.name_3);
      const parentCounty = countyByName.get(parentName);
      if (parentCounty) {
        const scoped = unitsByScopedName.get(`${parentCounty.territoryId}:${normalizedFeatureName}`) ?? [];
        if (scoped.length === 1) territory = scoped[0];
      }
    }

    if (!territory) {
      unmatched.push({ reason: "no_match", nationalCode: properties.nationalCode, name: featureName, level });
      continue;
    }

    const featureBounds = bounds(geometry);
    if (!featureBounds) {
      unmatched.push({ reason: "empty_geometry", territoryId: territory.territoryId, name: featureName });
      continue;
    }

    const row = { territoryId: territory.territoryId, geometry, bounds: featureBounds, sourceFeatureKey: String(properties.OBJECTID ?? properties.featureId ?? "") };
    const existing = matchedByTerritoryId.get(territory.territoryId);
    if (existing && existing.sourceFeatureKey !== row.sourceFeatureKey) {
      conflicts.push({ territoryId: territory.territoryId, features: [existing.sourceFeatureKey, row.sourceFeatureKey] });
      continue;
    }
    matchedByTerritoryId.set(territory.territoryId, row);
  }

  return { matched: [...matchedByTerritoryId.values()], unmatched, conflicts };
}
