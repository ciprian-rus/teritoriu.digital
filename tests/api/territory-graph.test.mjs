import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTerritoryIndex, getAncestors, getChildren, getDescendants } from "../../lib/territory-graph.mjs";

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
    identifiers: [],
    ...overrides
  };
}

// root -> county -> uat -> locality
const fixture = [
  territory("root", null),
  territory("county", "root"),
  territory("uat-a", "county"),
  territory("uat-b", "county"),
  territory("locality-1", "uat-a")
];

test("getAncestors walks parentTerritoryId up to the root, in order", () => {
  const index = buildTerritoryIndex(fixture);
  const ancestors = getAncestors("locality-1", index).map((t) => t.territoryId);
  assert.deepEqual(ancestors, ["uat-a", "county", "root"]);
});

test("getAncestors on a root returns an empty list", () => {
  const index = buildTerritoryIndex(fixture);
  assert.deepEqual(getAncestors("root", index), []);
});

test("getChildren returns only immediate children, not grandchildren", () => {
  const index = buildTerritoryIndex(fixture);
  const children = getChildren("county", index).map((t) => t.territoryId).sort();
  assert.deepEqual(children, ["uat-a", "uat-b"]);
});

test("getChildren on a leaf returns an empty list", () => {
  const index = buildTerritoryIndex(fixture);
  assert.deepEqual(getChildren("locality-1", index), []);
});

test("an unknown territoryId does not throw", () => {
  const index = buildTerritoryIndex(fixture);
  assert.deepEqual(getAncestors("missing", index), []);
  assert.deepEqual(getChildren("missing", index), []);
});

test("a cyclic parent chain stops instead of looping forever", () => {
  const cyclic = [
    territory("a", "b"),
    territory("b", "a")
  ];
  const index = buildTerritoryIndex(cyclic);
  const ancestors = getAncestors("a", index);
  assert.ok(ancestors.length <= 32, "must be bounded by MAX_ANCESTOR_HOPS");
});

test("getDescendants returns the full transitive subtree, not just immediate children", () => {
  const index = buildTerritoryIndex(fixture);
  const descendants = getDescendants("county", index).map((t) => t.territoryId).sort();
  assert.deepEqual(descendants, ["locality-1", "uat-a", "uat-b"]);
});

test("getDescendants on a leaf returns an empty list", () => {
  const index = buildTerritoryIndex(fixture);
  assert.deepEqual(getDescendants("locality-1", index), []);
});

test("getDescendants on an unknown territoryId does not throw", () => {
  const index = buildTerritoryIndex(fixture);
  assert.deepEqual(getDescendants("missing", index), []);
});

test("getDescendants terminates on a childhood cycle instead of looping forever", () => {
  // b <-> c: b's parent is c, and c's parent is b — a direct two-node
  // cycle. Starting the traversal from inside the cycle is what would
  // loop forever without the visited-set guard.
  const cyclic = [territory("b", "c"), territory("c", "b")];
  const index = buildTerritoryIndex(cyclic);
  const descendants = getDescendants("b", index).map((t) => t.territoryId);
  assert.deepEqual(descendants, ["c"]);
});
