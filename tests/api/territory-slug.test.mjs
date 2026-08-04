import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSlugIndex, resolveBySlugPath, slugify, slugPathFor } from "../../lib/territory-slug.mjs";

function territory(id, parentId, overrides = {}) {
  return {
    territoryId: id,
    parentTerritoryId: parentId,
    officialName: `T-${id}`,
    normalizedName: `t-${id}`,
    shortName: null,
    territoryType: "county",
    administrativeRole: "county_uat",
    administrativeLevel: 1,
    countyTerritoryId: null,
    status: "active",
    identifiers: [{ scheme: "ro.ins.siruta", value: id, status: "active", validFrom: null, validTo: null }],
    ...overrides
  };
}

test("slugify folds diacritics, lowercases and hyphenates", () => {
  assert.equal(slugify("JUDEȚUL ALBA"), "judetul-alba");
  assert.equal(slugify("ALBA IULIA"), "alba-iulia");
  assert.equal(slugify("Sântă-Mărie"), "santa-marie");
});

test("slugify falls back to a stable placeholder for an all-punctuation name", () => {
  assert.equal(slugify("!!!"), "teritoriu");
});

// alba (county, top-level) -> alba-iulia (municipality) -> alba iulia (component_locality)
const fixture = [
  territory("alba", null, { shortName: "ALBA", officialName: "JUDEȚUL ALBA" }),
  territory("alba-iulia-uat", "alba", {
    shortName: "ALBA IULIA",
    officialName: "MUNICIPIUL ALBA IULIA",
    territoryType: "municipality",
    administrativeLevel: 2
  }),
  territory("alba-iulia-loc", "alba-iulia-uat", {
    shortName: "ALBA IULIA",
    officialName: "ALBA IULIA",
    territoryType: "component_locality",
    administrativeLevel: 3
  })
];

test("buildSlugIndex assigns the same base slug at different depths without collision", () => {
  const index = buildSlugIndex(fixture);
  assert.equal(index.slugByTerritoryId.get("alba"), "alba");
  assert.equal(index.slugByTerritoryId.get("alba-iulia-uat"), "alba-iulia");
  assert.equal(index.slugByTerritoryId.get("alba-iulia-loc"), "alba-iulia");
});

test("resolveBySlugPath walks segments through the real parent chain", () => {
  const index = buildSlugIndex(fixture);
  assert.equal(resolveBySlugPath(index, ["alba"]), "alba");
  assert.equal(resolveBySlugPath(index, ["alba", "alba-iulia"]), "alba-iulia-uat");
  assert.equal(resolveBySlugPath(index, ["alba", "alba-iulia", "alba-iulia"]), "alba-iulia-loc");
});

test("resolveBySlugPath returns null for an unknown segment at any depth", () => {
  const index = buildSlugIndex(fixture);
  assert.equal(resolveBySlugPath(index, ["nu-exista"]), null);
  assert.equal(resolveBySlugPath(index, ["alba", "nu-exista"]), null);
  assert.equal(resolveBySlugPath(index, ["alba", "alba-iulia", "nu-exista"]), null);
});

test("resolveBySlugPath does not let a UAT slug be reached at județ depth", () => {
  const index = buildSlugIndex(fixture);
  // "alba-iulia" is a level-2 slug under "alba", not a root-level slug.
  assert.equal(resolveBySlugPath(index, ["alba-iulia"]), null);
});

test("slugPathFor builds the full canonical path from root-first ancestors", () => {
  const index = buildSlugIndex(fixture);
  const locality = fixture.find((t) => t.territoryId === "alba-iulia-loc");
  const uat = fixture.find((t) => t.territoryId === "alba-iulia-uat");
  const county = fixture.find((t) => t.territoryId === "alba");
  assert.equal(slugPathFor(county, [], index), "/alba");
  assert.equal(slugPathFor(uat, [county], index), "/alba/alba-iulia");
  assert.equal(slugPathFor(locality, [county, uat], index), "/alba/alba-iulia/alba-iulia");
});

test("buildSlugIndex disambiguates a real slug collision deterministically by SIRUTA code", () => {
  const withCollision = [
    territory("a", null, {
      shortName: "RECEA",
      officialName: "COMUNA RECEA",
      identifiers: [{ scheme: "ro.ins.siruta", value: "1111", status: "active", validFrom: null, validTo: null }]
    }),
    territory("b", null, {
      shortName: "RECEA",
      officialName: "COMUNA RECEA (ALT JUDEȚ ÎN ACELAȘI GRUP DE FRAȚI)",
      identifiers: [{ scheme: "ro.ins.siruta", value: "2222", status: "active", validFrom: null, validTo: null }]
    })
  ];
  const index = buildSlugIndex(withCollision);
  const slugA = index.slugByTerritoryId.get("a");
  const slugB = index.slugByTerritoryId.get("b");
  assert.notEqual(slugA, slugB);
  // Lower territoryId ("a" < "b") keeps the clean slug.
  assert.equal(slugA, "recea");
  assert.equal(slugB, "recea-2222");
  assert.equal(resolveBySlugPath(index, [slugA]), "a");
  assert.equal(resolveBySlugPath(index, [slugB]), "b");
});

test("buildSlugIndex lets identically-named UATs coexist under different județe", () => {
  const twoRecea = [
    territory("cluj", null, { shortName: "CLUJ", officialName: "JUDEȚUL CLUJ" }),
    territory("maramures", null, { shortName: "MARAMUREȘ", officialName: "JUDEȚUL MARAMUREȘ" }),
    territory("recea-cluj", "cluj", { shortName: "RECEA", officialName: "COMUNA RECEA", territoryType: "commune" }),
    territory("recea-mm", "maramures", {
      shortName: "RECEA",
      officialName: "ORAȘ RECEA",
      territoryType: "city"
    })
  ];
  const index = buildSlugIndex(twoRecea);
  assert.equal(resolveBySlugPath(index, ["cluj", "recea"]), "recea-cluj");
  assert.equal(resolveBySlugPath(index, ["maramures", "recea"]), "recea-mm");
});
