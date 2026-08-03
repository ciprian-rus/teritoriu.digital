import assert from "node:assert/strict";
import { test } from "node:test";
import { searchTerritories } from "../../lib/territory-search.mjs";
import { buildTerritoryIndex, getAncestors, getChildren, getDescendants } from "../../lib/territory-graph.mjs";
import { computeEtag } from "../../lib/territory-view.mjs";

function territory(id, parentId, overrides = {}) {
  return {
    territoryId: id,
    parentTerritoryId: parentId,
    officialName: `Județul ${id}`,
    normalizedName: `judetul ${id}`,
    shortName: null,
    territoryType: "county",
    administrativeRole: "county_uat",
    administrativeLevel: 1,
    countyTerritoryId: null,
    status: "active",
    identifiers: [{ scheme: "ro.ins.siruta", value: "10", status: "active", validFrom: null, validTo: null }],
    ...overrides
  };
}

const fixture = [
  territory("root", null),
  territory("county", "root"),
  territory("uat-a", "county"),
  territory("locality-1", "uat-a")
];
const index = buildTerritoryIndex(fixture);
const release = { manifestSha256: "test-sha", territories: fixture };

// The only values a route handler can ever pass through from an HTTP
// request are: a string (whatever the client sent, including anything
// below) or undefined/null (the param was absent). Never a number, array,
// or object — Next.js's URLSearchParams.get()/dynamic route params only
// ever yield strings or null. Fuzzing is scoped to that real contract, not
// to type confusion nothing can trigger over HTTP.
const ADVERSARIAL_STRINGS = [
  "",
  " ",
  "\0",
  "\n\r\t",
  "a".repeat(200000),
  "'; DROP TABLE territories; --",
  "<script>alert(1)</script>",
  "../../../etc/passwd",
  "%00",
  "%2e%2e%2f",
  "NaN",
  "Infinity",
  "-Infinity",
  "🇷🇴💥emoji",
  "true",
  "false",
  "null",
  "undefined",
  "0",
  "-1",
  "999999999999999999999999",
  "1e309",
  "1.5",
  "-0",
  "῎".repeat(200),
  String.fromCharCode(0xd800), // lone UTF-16 surrogate
  "%",
  "%%",
  "&",
  "=",
  "[object Object]",
  "root", // a value that happens to collide with a real territoryId
  "0000-0000-0000-0000" // a value shaped like a territoryId but absent
];

const QUERY_PARAM_NAMES = ["q", "siruta", "territoryId", "type", "status", "countyTerritoryId", "cursor", "limit"];

test("searchTerritories never throws on any adversarial string in any parameter, and always returns a well-formed page", () => {
  for (const paramName of QUERY_PARAM_NAMES) {
    for (const value of ADVERSARIAL_STRINGS) {
      const params = { limit: "10", [paramName]: value };
      let result;
      assert.doesNotThrow(() => {
        result = searchTerritories(fixture, params);
      }, `searchTerritories threw for ${paramName}=${JSON.stringify(value).slice(0, 60)}`);
      assert.ok(Array.isArray(result.items));
      assert.ok(result.nextCursor === null || typeof result.nextCursor === "string");
      assert.ok(Number.isInteger(result.total) && result.total >= 0);
      assert.ok(result.items.length <= 200, "must respect MAX_LIMIT regardless of input");
    }
  }
});

test("searchTerritories never throws when a parameter is absent (undefined/null, matching URLSearchParams.get())", () => {
  for (const paramName of QUERY_PARAM_NAMES) {
    for (const absent of [undefined, null]) {
      assert.doesNotThrow(() => searchTerritories(fixture, { [paramName]: absent }));
    }
  }
});

test("getAncestors/getChildren/getDescendants never throw on any adversarial territoryId string", () => {
  for (const value of [...ADVERSARIAL_STRINGS, undefined, null]) {
    let ancestors;
    let children;
    let descendants;
    assert.doesNotThrow(() => {
      ancestors = getAncestors(value, index);
    }, `getAncestors threw for ${JSON.stringify(value)}`);
    assert.doesNotThrow(() => {
      children = getChildren(value, index);
    }, `getChildren threw for ${JSON.stringify(value)}`);
    assert.doesNotThrow(() => {
      descendants = getDescendants(value, index);
    }, `getDescendants threw for ${JSON.stringify(value)}`);
    assert.ok(Array.isArray(ancestors));
    assert.ok(Array.isArray(children));
    assert.ok(Array.isArray(descendants));
  }
});

test("computeEtag never throws on any adversarial query string value and always returns a quoted etag", () => {
  for (const value of ADVERSARIAL_STRINGS) {
    let etag;
    assert.doesNotThrow(() => {
      etag = computeEtag(release, new URLSearchParams({ q: value }));
    }, `computeEtag threw for q=${JSON.stringify(value).slice(0, 60)}`);
    assert.ok(etag.startsWith('"') && etag.endsWith('"'));
  }
});

test("limit accepts only sane bounds regardless of how it's spelled", () => {
  const cases = [
    ["", 50],
    ["abc", 50],
    ["-5", 50],
    ["0", 50],
    ["1.9", 1],
    ["NaN", 50],
    ["Infinity", 50], // Number.parseInt("Infinity", 10) is NaN, not the numeric Infinity
    ["-Infinity", 50],
    ["999999999999999999999999", 200],
    ["3", 3]
  ];
  for (const [limit, expectedItems] of cases) {
    const { items } = searchTerritories(fixture, { limit });
    assert.equal(items.length, Math.min(expectedItems, fixture.length), `limit=${JSON.stringify(limit)}`);
  }
});
