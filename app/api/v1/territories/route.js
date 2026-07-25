import { createHash } from "node:crypto";
import { loadVerifiedRelease } from "@/lib/release-source.mjs";
import { searchTerritories } from "@/lib/territory-search.mjs";

function toTerritoryView(territory) {
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

function computeEtag(release, searchParams) {
  const hash = createHash("sha256");
  hash.update(release.manifestSha256);
  hash.update(searchParams.toString());
  return `"${hash.digest("hex").slice(0, 32)}"`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  let release;
  try {
    release = await loadVerifiedRelease();
  } catch (error) {
    return Response.json(
      { error: { code: "RELEASE_UNAVAILABLE", message: error.message } },
      { status: 503 }
    );
  }

  const etag = computeEtag(release, searchParams);
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const { items, nextCursor, total } = searchTerritories(release.territories, {
    q: searchParams.get("q") ?? undefined,
    siruta: searchParams.get("siruta") ?? undefined,
    territoryId: searchParams.get("territoryId") ?? undefined,
    type: searchParams.get("type") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    countyTerritoryId: searchParams.get("countyTerritoryId") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
    limit: searchParams.get("limit") ?? undefined
  });

  return Response.json(
    {
      release: {
        releaseId: release.releaseId,
        schemaVersion: release.schemaVersion,
        manifestSha256: release.manifestSha256
      },
      total,
      nextCursor,
      items: items.map(toTerritoryView)
    },
    {
      headers: {
        ETag: etag,
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300"
      }
    }
  );
}
