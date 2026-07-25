import { loadVerifiedRelease } from "@/lib/release-source.mjs";
import { searchTerritories } from "@/lib/territory-search.mjs";
import { computeEtag, toReleaseView, toTerritoryView } from "@/lib/territory-view.mjs";

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
      release: toReleaseView(release),
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
