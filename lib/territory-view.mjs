import { createHash } from "node:crypto";

export function toTerritoryView(territory) {
  return {
    territoryId: territory.territoryId,
    officialName: territory.officialName,
    normalizedName: territory.normalizedName,
    shortName: territory.shortName,
    territoryType: territory.territoryType,
    administrativeRole: territory.administrativeRole,
    administrativeLevel: territory.administrativeLevel,
    parentTerritoryId: territory.parentTerritoryId,
    countyTerritoryId: territory.countyTerritoryId,
    status: territory.status,
    identifiers: territory.identifiers
  };
}

export function toReleaseView(release) {
  return {
    releaseId: release.releaseId,
    schemaVersion: release.schemaVersion,
    manifestSha256: release.manifestSha256
  };
}

export function computeEtag(release, searchParams) {
  const hash = createHash("sha256");
  hash.update(release.manifestSha256);
  hash.update(searchParams.toString());
  return `"${hash.digest("hex").slice(0, 32)}"`;
}
