import { notFound, permanentRedirect } from "next/navigation";
import { loadVerifiedRelease } from "@/lib/release-source.mjs";
import { buildTerritoryIndex, getAncestors } from "@/lib/territory-graph.mjs";
import { buildSlugIndex, slugPathFor } from "@/lib/territory-slug.mjs";

export const dynamic = "force-dynamic";

// This route predates human-readable URLs: territories used to be served
// at /teritorii/{uuid}. Old links and bookmarks still resolve — this looks
// the UUID up and redirects permanently to the current canonical slug path.
export default async function LegacyTerritoryRedirect({ params }) {
  const { territoryId } = await params;

  let release = null;
  try {
    release = await loadVerifiedRelease();
  } catch {
    return (
      <p className="error-state" role="alert">
        Release-ul public nu poate fi încărcat momentan. Încearcă din nou în câteva minute.
      </p>
    );
  }

  const index = buildTerritoryIndex(release.territories);
  const territory = index.byId.get(territoryId);
  if (!territory) notFound();

  const slugIndex = buildSlugIndex(release.territories);
  const ancestors = getAncestors(territoryId, index).reverse();
  permanentRedirect(slugPathFor(territory, ancestors, slugIndex));
}
