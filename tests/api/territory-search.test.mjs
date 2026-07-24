import assert from "node:assert/strict";
import { test } from "node:test";
import { foldDiacritics, searchTerritories } from "../../lib/territory-search.mjs";

function territory(overrides) {
  return {
    territoryId: "019f8e0f-4c41-7000-0000-000000000000",
    officialName: "TERITORIU DE TEST",
    normalizedName: "teritoriu de test",
    shortName: "TEST",
    territoryType: "county",
    administrativeRole: "county_uat",
    administrativeLevel: 1,
    parentTerritoryId: null,
    countyTerritoryId: null,
    status: "active",
    identifiers: [{ scheme: "ro.ins.siruta", value: "10", status: "active", validFrom: null, validTo: null }],
    ...overrides
  };
}

const fixture = [
  territory({
    territoryId: "019f8e0f-4c41-0000-0000-000000000001",
    officialName: "JUDEȚUL BRAȘOV",
    normalizedName: "județul brașov",
    shortName: "BRAȘOV",
    identifiers: [{ scheme: "ro.ins.siruta", value: "8", status: "active", validFrom: null, validTo: null }]
  }),
  territory({
    territoryId: "019f8e0f-4c41-0000-0000-000000000002",
    officialName: "MUNICIPIUL BRAȘOV",
    normalizedName: "municipiul brașov",
    shortName: "BRAȘOV",
    territoryType: "municipality",
    administrativeRole: "local_uat",
    administrativeLevel: 2,
    countyTerritoryId: "019f8e0f-4c41-0000-0000-000000000001",
    identifiers: [{ scheme: "ro.ins.siruta", value: "40276", status: "active", validFrom: null, validTo: null }]
  }),
  territory({
    territoryId: "019f8e0f-4c41-0000-0000-000000000003",
    officialName: "JUDEȚUL ALBA",
    normalizedName: "județul alba",
    shortName: "ALBA",
    status: "inactive",
    identifiers: [{ scheme: "ro.ins.siruta", value: "1", status: "historical", validFrom: null, validTo: null }]
  })
];

test("foldDiacritics strips Romanian diacritics and lowercases", () => {
  assert.equal(foldDiacritics("JUDEȚUL BRAȘOV"), "judetul brasov");
  assert.equal(foldDiacritics("Câmpina"), "campina");
});

test("q matches regardless of diacritics in query or data", () => {
  const { items } = searchTerritories(fixture, { q: "brasov" });
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.officialName.includes("BRAȘOV")));
});

test("type filter narrows to a single administrative level", () => {
  const { items } = searchTerritories(fixture, { type: "municipality" });
  assert.equal(items.length, 1);
  assert.equal(items[0].officialName, "MUNICIPIUL BRAȘOV");
});

test("status filter excludes non-matching records", () => {
  const { items } = searchTerritories(fixture, { status: "inactive" });
  assert.equal(items.length, 1);
  assert.equal(items[0].officialName, "JUDEȚUL ALBA");
});

test("siruta filter matches only the exact active code", () => {
  const { items } = searchTerritories(fixture, { siruta: "40276" });
  assert.equal(items.length, 1);
  assert.equal(items[0].officialName, "MUNICIPIUL BRAȘOV");
});

test("countyTerritoryId filter scopes to a single county", () => {
  const { items } = searchTerritories(fixture, {
    countyTerritoryId: "019f8e0f-4c41-0000-0000-000000000001"
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].officialName, "MUNICIPIUL BRAȘOV");
});

test("pagination walks the full result set without gaps or duplicates", () => {
  const seen = [];
  let cursor;
  for (let i = 0; i < 10; i += 1) {
    const { items, nextCursor } = searchTerritories(fixture, { limit: 1, cursor });
    if (items.length === 0) break;
    seen.push(...items.map((item) => item.territoryId));
    cursor = nextCursor;
    if (!nextCursor) break;
  }
  assert.deepEqual(
    seen,
    [...fixture].sort((a, b) => (a.territoryId < b.territoryId ? -1 : 1)).map((item) => item.territoryId)
  );
});

test("an unknown cursor yields no matches instead of throwing", () => {
  const { items, nextCursor } = searchTerritories(fixture, {
    cursor: Buffer.from("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", "utf8").toString("base64url")
  });
  assert.deepEqual(items, []);
  assert.equal(nextCursor, null);
});

test("limit is clamped to the documented maximum", () => {
  const { items } = searchTerritories(fixture, { limit: "99999" });
  assert.equal(items.length, fixture.length);
});
