import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The search + list that used to live here now lives on the home page.
// Old links and bookmarks still work: this redirects permanently, carrying
// any query string (q, type, status, cursor) straight through to /.
export default async function LegacyTerritoriesRedirect({ searchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams(params).toString();
  permanentRedirect(qs ? `/?${qs}` : "/");
}
