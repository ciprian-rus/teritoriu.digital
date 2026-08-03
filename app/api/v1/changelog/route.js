import { checkRateLimit, clientKey } from "@/lib/rate-limit.mjs";
import { loadVerifiedRelease } from "@/lib/release-source.mjs";
import { computeEtag, toReleaseView } from "@/lib/territory-view.mjs";

export async function GET(request) {
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

  const etag = computeEtag(release, searchParams);
  const rateHeaders = { "X-RateLimit-Remaining": String(rate.remaining) };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...rateHeaders } });
  }

  const { changelog } = release;

  return Response.json(
    {
      release: toReleaseView(release),
      previousReleaseId: changelog.previousReleaseId ?? null,
      baseline: Boolean(changelog.baseline),
      added: changelog.added,
      changed: changelog.changed,
      removed: changelog.removed,
      sourceRecordChanged: changelog.sourceRecordChanged,
      unchanged: changelog.unchanged,
      ratios: changelog.ratios
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
