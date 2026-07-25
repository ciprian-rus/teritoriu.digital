/**
 * Builds lookup indexes once per request over the verified release's flat
 * territory list, so ancestor/child traversal doesn't re-scan 16,978 records
 * per hop.
 */
export function buildTerritoryIndex(territories) {
  const byId = new Map();
  const childrenByParent = new Map();
  for (const territory of territories) {
    byId.set(territory.territoryId, territory);
  }
  for (const territory of territories) {
    if (!territory.parentTerritoryId) continue;
    const siblings = childrenByParent.get(territory.parentTerritoryId) ?? [];
    siblings.push(territory);
    childrenByParent.set(territory.parentTerritoryId, siblings);
  }
  return { byId, childrenByParent };
}

const MAX_ANCESTOR_HOPS = 32;

/**
 * Walks parentTerritoryId to the root. Stops after MAX_ANCESTOR_HOPS instead
 * of looping forever — the release contract already forbids cycles
 * (verifyReleaseBundle rejects them before publish), this is just a
 * fail-closed backstop against a corrupted or future release format.
 */
export function getAncestors(territoryId, index) {
  const ancestors = [];
  let current = index.byId.get(territoryId);
  let hops = 0;
  while (current?.parentTerritoryId && hops < MAX_ANCESTOR_HOPS) {
    const parent = index.byId.get(current.parentTerritoryId);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
    hops += 1;
  }
  return ancestors;
}

export function getChildren(territoryId, index) {
  return index.childrenByParent.get(territoryId) ?? [];
}
