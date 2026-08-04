import { foldDiacritics } from "./territory-search.mjs";

const SIRUTA_SCHEME = "ro.ins.siruta";
const ROOT_KEY = "__root__";

function sirutaOf(territory) {
  return (
    territory.identifiers.find((identifier) => identifier.scheme === SIRUTA_SCHEME)?.value ??
    territory.territoryId
  );
}

export function slugify(value) {
  const folded = foldDiacritics(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return folded || "teritoriu";
}

function baseSlug(territory) {
  return slugify(territory.shortName || territory.officialName);
}

/**
 * Groups territories by parent (root-level territories share a sentinel
 * parent key) and assigns each a slug unique among its siblings. No
 * collision exists in the current release (verified against the full
 * territory set), but a future one is broken deterministically by
 * appending the territory's SIRUTA code — sorted by territoryId (a
 * UUIDv7, so creation-ordered) so the "first" sibling always keeps the
 * clean slug across rebuilds of the same release.
 */
export function buildSlugIndex(territories) {
  const groups = new Map();
  for (const territory of territories) {
    const key = territory.parentTerritoryId ?? ROOT_KEY;
    const siblings = groups.get(key) ?? [];
    siblings.push(territory);
    groups.set(key, siblings);
  }

  const slugByTerritoryId = new Map();
  const idByParentAndSlug = new Map();

  for (const [parentKey, siblings] of groups) {
    const ordered = [...siblings].sort((a, b) =>
      a.territoryId < b.territoryId ? -1 : a.territoryId > b.territoryId ? 1 : 0
    );
    const used = new Set();
    for (const territory of ordered) {
      let slug = baseSlug(territory);
      if (used.has(slug)) slug = slugify(`${slug}-${sirutaOf(territory)}`);
      used.add(slug);
      slugByTerritoryId.set(territory.territoryId, slug);
      idByParentAndSlug.set(`${parentKey}::${slug}`, territory.territoryId);
    }
  }

  return { slugByTerritoryId, idByParentAndSlug };
}

/**
 * Walks a URL's path segments one hop at a time (root's children, then
 * that territory's children, ...), so it resolves a județ, a UAT nested
 * under it, or a localitate nested under that UAT — any depth the real
 * parentTerritoryId chain has — without the caller needing to know which
 * depth a given path represents.
 */
export function resolveBySlugPath(slugIndex, segments) {
  let parentKey = ROOT_KEY;
  let territoryId = null;
  for (const segment of segments) {
    territoryId = slugIndex.idByParentAndSlug.get(`${parentKey}::${segment}`);
    if (!territoryId) return null;
    parentKey = territoryId;
  }
  return territoryId;
}

/**
 * ancestorsRootFirst: ancestors ordered root -> immediate parent, i.e.
 * getAncestors(...).reverse() (the same order the breadcrumb already uses).
 */
export function slugPathFor(territory, ancestorsRootFirst, slugIndex) {
  const segments = [
    ...ancestorsRootFirst.map((ancestor) => slugIndex.slugByTerritoryId.get(ancestor.territoryId)),
    slugIndex.slugByTerritoryId.get(territory.territoryId)
  ];
  return `/${segments.join("/")}`;
}
