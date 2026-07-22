import { verifyReleaseBundle } from "../../pipeline/src/release/artifact-builder.mjs";

function sirutaIdentifier(territory) {
  return territory.identifiers.find((item) => item.scheme === "ro.ins.siruta")?.value ?? null;
}

export function importReleaseReadModel(bundle, currentModel = null) {
  const { manifest, manifestSha256 } = verifyReleaseBundle(bundle);
  const payload = JSON.parse(bundle.artifacts.get("territories.json").toString("utf8"));
  if (payload.releaseId !== manifest.releaseId || payload.territories.length !== manifest.counts.territories) {
    throw new Error("Release payload metadata does not match its manifest");
  }

  const byTerritoryId = new Map();
  const bySiruta = new Map();
  for (const territory of payload.territories) {
    const siruta = sirutaIdentifier(territory);
    if (byTerritoryId.has(territory.territoryId) || bySiruta.has(siruta)) {
      throw new Error("Release payload contains duplicate identities");
    }
    byTerritoryId.set(territory.territoryId, territory);
    bySiruta.set(siruta, territory.territoryId);
  }
  for (const territory of payload.territories) {
    for (const field of ["parentTerritoryId", "countyTerritoryId"]) {
      if (territory[field] !== null && !byTerritoryId.has(territory[field])) {
        throw new Error(`Release payload contains an unresolved ${field}`);
      }
    }
  }

  return {
    releaseId: manifest.releaseId,
    manifestSha256,
    previousReleaseId: manifest.previousReleaseId,
    importedAt: manifest.publishedAt,
    territories: payload.territories,
    byTerritoryId,
    bySiruta,
    rollback: currentModel
      ? { releaseId: currentModel.releaseId, manifestSha256: currentModel.manifestSha256 }
      : null
  };
}
