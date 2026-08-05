import { loadVerifiedRelease } from "@/lib/release-source.mjs";

/**
 * Not part of the versioned public contract (no OpenAPI entry, no
 * contractVersion guarantee) — an operational probe for uptime monitoring.
 * Deliberately checks only the GitHub Releases read path, never Supabase:
 * a healthy response here is proof the site serves the public registry
 * without the control plane, matching the non-negotiable in README.md.
 */
export async function GET() {
  try {
    const release = await loadVerifiedRelease();
    return Response.json(
      {
        status: "ok",
        releaseId: release.releaseId,
        schemaVersion: release.schemaVersion,
        publishedAt: release.publishedAt,
        territoryCount: release.territories.length
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { status: "error", message: error.message },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
