import { checkRateLimit, clientKey } from "@/lib/rate-limit.mjs";
import { loadVerifiedRelease } from "@/lib/release-source.mjs";
import { buildTerritoryIndex, getDescendants } from "@/lib/territory-graph.mjs";
import { searchTerritories } from "@/lib/territory-search.mjs";
import { computeEtag, toReleaseView, toTerritoryView } from "@/lib/territory-view.mjs";

export async function GET(request, { params }) {
  const { territoryId } = await params;
  const { searchParams } = new URL(request.url);

  const rate = checkRateLimit(clientKey(request));
  if (rate.limited) {
    return Response.json(
      { error: { code: "RATE_LIMITED", message: "too many requests" } },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) }
      }
    );
  }

  let release;
  try {
    release = await loadVerifiedRelease();
  } catch (error) {
    return Response.json(
      { error: { code: "RELEASE_UNAVAILABLE", message: error.message } },
      { status: 503 }
    );
  }

  const index = buildTerritoryIndex(release.territories);
  const rateHeaders = { "X-RateLimit-Remaining": String(rate.remaining) };

  if (!index.byId.has(territoryId)) {
    return Response.json(
      {
        error: {
          code: "TERRITORY_NOT_FOUND",
          message: `no territory with territoryId ${territoryId} in release ${release.releaseId}`
        }
      },
      { status: 404, headers: rateHeaders }
    );
  }

  const etag = computeEtag(release, new URLSearchParams({ territoryId, ...Object.fromEntries(searchParams) }));
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...rateHeaders } });
  }

  const descendants = getDescendants(territoryId, index);
  const { items, nextCursor, total } = searchTerritories(descendants, {
    type: searchParams.get("type") ?? undefined,
    status: searchParams.get("status") ?? undefined,
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
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        ...rateHeaders
      }
    }
  );
}
