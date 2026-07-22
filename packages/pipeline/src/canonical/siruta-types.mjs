const TYPE_DEFINITIONS = new Map([
  [1, { territoryType: "municipality", administrativeRole: "local_uat", expectedLevel: 2, isUat: true, isLocality: true, isCountySeat: true }],
  [2, { territoryType: "city", administrativeRole: "local_uat", expectedLevel: 2, isUat: true, isLocality: true, isCountySeat: false }],
  [3, { territoryType: "commune", administrativeRole: "local_uat", expectedLevel: 2, isUat: true, isLocality: false, isCountySeat: false }],
  [4, { territoryType: "municipality", administrativeRole: "local_uat", expectedLevel: 2, isUat: true, isLocality: true, isCountySeat: false }],
  [5, { territoryType: "city", administrativeRole: "local_uat", expectedLevel: 2, isUat: true, isLocality: true, isCountySeat: true }],
  [6, { territoryType: "sector", administrativeRole: "administrative_subdivision", expectedLevel: 3, isUat: false, isLocality: false, isCountySeat: false }],
  [9, { territoryType: "component_locality", administrativeRole: "locality", expectedLevel: 3, isUat: false, isLocality: true, isCountySeat: false }],
  [10, { territoryType: "component_locality", administrativeRole: "locality", expectedLevel: 3, isUat: false, isLocality: true, isCountySeat: false }],
  [11, { territoryType: "village", administrativeRole: "locality", expectedLevel: 3, isUat: false, isLocality: true, isCountySeat: false }],
  [17, { territoryType: "component_locality", administrativeRole: "locality", expectedLevel: 3, isUat: false, isLocality: true, isCountySeat: false }],
  [18, { territoryType: "component_locality", administrativeRole: "locality", expectedLevel: 3, isUat: false, isLocality: true, isCountySeat: false }],
  [19, { territoryType: "village", administrativeRole: "locality", expectedLevel: 3, isUat: false, isLocality: true, isCountySeat: false }],
  [22, { territoryType: "village", administrativeRole: "locality", expectedLevel: 3, isUat: false, isLocality: true, isCountySeat: false }],
  [23, { territoryType: "village", administrativeRole: "locality", expectedLevel: 3, isUat: false, isLocality: true, isCountySeat: false }],
  [40, { territoryType: "county", administrativeRole: "county_uat", expectedLevel: 1, isUat: true, isLocality: false, isCountySeat: false }]
]);

export function sirutaTypeDefinition(typeCode, officialName = "") {
  const definition = TYPE_DEFINITIONS.get(typeCode);
  if (!definition) return null;
  if (typeCode === 40 && /BUCUREȘTI|BUCUREŞTI/iu.test(officialName)) {
    return { ...definition, territoryType: "bucharest", isLocality: true };
  }
  return { ...definition };
}

export function knownSirutaTypeCodes() {
  return [...TYPE_DEFINITIONS.keys()].sort((left, right) => left - right);
}
