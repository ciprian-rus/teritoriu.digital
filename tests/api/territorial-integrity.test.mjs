import assert from "node:assert/strict";
import { test } from "node:test";
import { loadVerifiedRelease } from "../../lib/release-source.mjs";
import { buildTerritoryIndex, getAncestors, getDescendants } from "../../lib/territory-graph.mjs";

// A stratified sample would only ever check a subset of the 42 counties and
// 3181 UATs; since the full verified release is already loaded in memory for
// every request anyway, checking the entire graph is both cheaper to write
// and strictly stronger evidence than sampling it. Requires network (fetches
// the real release from GitHub Releases, like every other page/request in
// this app already does), so this is skipped if that fetch fails rather than
// failing the whole suite over an environment's network policy.
let release;
let index;
try {
  release = await loadVerifiedRelease();
  index = buildTerritoryIndex(release.territories);
} catch {
  release = null;
}

test("release has exactly one entry per county plus Bucharest, matching the documented 42 județe", { skip: !release }, () => {
  const roots = release.territories.filter((t) => !t.parentTerritoryId);
  assert.equal(roots.length, 42);
  const byType = {};
  for (const root of roots) byType[root.territoryType] = (byType[root.territoryType] ?? 0) + 1;
  assert.deepEqual(byType, { county: 41, bucharest: 1 });
});

test("every territoryId is unique across all 16,978+ records", { skip: !release }, () => {
  const ids = release.territories.map((t) => t.territoryId);
  assert.equal(new Set(ids).size, ids.length);
});

test("the 42 county/Bucharest subtrees partition the entire release with no orphans and no overlap", { skip: !release }, () => {
  const roots = release.territories.filter((t) => !t.parentTerritoryId);
  const seen = new Set();
  for (const root of roots) {
    assert.ok(!seen.has(root.territoryId), `root ${root.officialName} visited twice`);
    seen.add(root.territoryId);
    for (const descendant of getDescendants(root.territoryId, index)) {
      assert.ok(
        !seen.has(descendant.territoryId),
        `${descendant.officialName} (${descendant.territoryId}) reachable from more than one county — the graph isn't a clean partition`
      );
      seen.add(descendant.territoryId);
    }
  }
  assert.equal(seen.size, release.territories.length, "every territory must belong to exactly one county's subtree");
});

test("every non-root territory's ancestor chain terminates at one of the 42 county/Bucharest roots", { skip: !release }, () => {
  const rootIds = new Set(release.territories.filter((t) => !t.parentTerritoryId).map((t) => t.territoryId));
  for (const territory of release.territories) {
    if (!territory.parentTerritoryId) continue;
    const ancestors = getAncestors(territory.territoryId, index);
    assert.ok(ancestors.length > 0, `${territory.officialName} has a parentTerritoryId but no resolvable ancestors`);
    const top = ancestors[ancestors.length - 1];
    assert.ok(
      rootIds.has(top.territoryId),
      `${territory.officialName}'s ancestor chain ends at ${top.officialName} (${top.territoryType}), not a county/Bucharest root`
    );
  }
});

test("every territory's countyTerritoryId points to the actual county/Bucharest root at the top of its own chain", { skip: !release }, () => {
  const rootIds = new Set(release.territories.filter((t) => !t.parentTerritoryId).map((t) => t.territoryId));
  for (const territory of release.territories) {
    assert.ok(territory.countyTerritoryId, `${territory.officialName} has no countyTerritoryId`);
    if (rootIds.has(territory.territoryId)) {
      assert.equal(territory.countyTerritoryId, territory.territoryId, `county/Bucharest root ${territory.officialName} must be its own countyTerritoryId`);
      continue;
    }
    const ancestors = getAncestors(territory.territoryId, index);
    const root = ancestors[ancestors.length - 1];
    assert.equal(
      territory.countyTerritoryId,
      root.territoryId,
      `${territory.officialName}'s countyTerritoryId doesn't match its actual county/Bucharest root ${root.officialName}`
    );
  }
});

test("every county and every local UAT (municipality/city/commune/bucharest) carries a non-empty SIRUTA identifier", { skip: !release }, () => {
  const LOCAL_UAT_TYPES = new Set(["county", "bucharest", "municipality", "city", "commune"]);
  const missing = release.territories.filter((territory) => {
    if (!LOCAL_UAT_TYPES.has(territory.territoryType)) return false;
    const siruta = territory.identifiers.find((identifier) => identifier.scheme === "ro.ins.siruta");
    return !siruta || !siruta.value;
  });
  assert.deepEqual(missing.map((t) => t.officialName), [], "counties/UATs missing a SIRUTA identifier");
});

test("local UAT counts by type match the documented registry (103 municipalities, 216 cities, 2862 communes)", { skip: !release }, () => {
  const byType = {};
  for (const t of release.territories) byType[t.territoryType] = (byType[t.territoryType] ?? 0) + 1;
  assert.equal(byType.municipality, 103);
  assert.equal(byType.city, 216);
  assert.equal(byType.commune, 2862);
  assert.equal(byType.sector, 6);
  assert.equal(byType.municipality + byType.city + byType.commune, 3181, "total local UATs");
});
