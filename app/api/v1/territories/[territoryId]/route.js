import { checkRateLimit, clientKey } from "@/lib/rate-limit.mjs";
import { loadVerifiedRelease } from "@/lib/release-source.mjs";
import { buildTerritoryIndex, getAncestors, getChildren } from "@/lib/territory-graph.mjs";
import { computeEtag, toReleaseView, toTerritoryView } from "@/lib/territory-view.mjs";

export async function GET(request, { params }) {
  const { territoryId } = await params;

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

  const etag = computeEtag(release, new URLSearchParams({ territoryId }));
  const rateHeaders = { "X-RateLimit-Remaining": String(rate.remaining) };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...rateHeaders } });
  }

  const index = buildTerritoryIndex(release.territories);
  const territory = index.byId.get(territoryId);
  if (!territory) {
    return Response.json(
      { error: { code: "TERRITORY_NOT_FOUND", message: `no territory with territoryId ${territoryId} in release ${release.releaseId}` } },
      { status: 404 }
    );
  }

  const ancestors = getAncestors(territoryId, index);
  const children = getChildren(territoryId, index);

  return Response.json(
    {
      release: toReleaseView(release),
      territory: toTerritoryView(territory),
      ancestors: ancestors.map(toTerritoryView),
      children: children.map(toTerritoryView)
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
