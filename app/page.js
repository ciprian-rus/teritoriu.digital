import { loadVerifiedRelease } from "@/lib/release-source.mjs";
import { searchTerritories } from "@/lib/territory-search.mjs";
import { buildTerritoryIndex, getAncestors } from "@/lib/territory-graph.mjs";
import { buildSlugIndex, slugPathFor } from "@/lib/territory-slug.mjs";
import { TERRITORY_TYPE_LABELS } from "@/lib/territory-labels.mjs";

export const dynamic = "force-dynamic";

// Filter/search combinations aren't distinct pages worth indexing
// separately, and would otherwise read as near-duplicate content.
export const metadata = {
  alternates: { canonical: "/" }
};

function buildQueryString(params, overrides) {
  const merged = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value !== undefined && value !== null && value !== "") merged.set(key, String(value));
  }
  return merged.toString();
}

export default async function HomePage({ searchParams }) {
  const params = await searchParams;
  const q = params.q ?? "";
  const type = params.type ?? "";
  const status = params.status ?? "";
  const cursor = params.cursor ?? undefined;

  let release = null;
  let error = null;
  try {
    release = await loadVerifiedRelease();
  } catch (cause) {
    error = cause;
  }

  if (error) {
    return (
      <>
        <h1>Registrul teritorial deschis al României</h1>
        <p className="error-state" role="alert">
          Release-ul public nu poate fi încărcat momentan. Încearcă din nou în câteva minute.
        </p>
      </>
    );
  }

  const trimmedQuery = q.trim();
  const isSirutaLike = /^\d+$/.test(trimmedQuery);

  const { items, nextCursor, total } = searchTerritories(release.territories, {
    q: isSirutaLike ? undefined : q || undefined,
    siruta: isSirutaLike ? trimmedQuery : undefined,
    type: type || undefined,
    status: status || undefined,
    cursor,
    limit: 50
  });

  const counties = release.territories
    .filter((territory) => !territory.parentTerritoryId)
    .sort((a, b) => a.officialName.localeCompare(b.officialName, "ro"));

  const index = buildTerritoryIndex(release.territories);
  const slugIndex = buildSlugIndex(release.territories);
  const pathFor = (territory) =>
    slugPathFor(territory, getAncestors(territory.territoryId, index).reverse(), slugIndex);

  return (
    <>
      <h1>Registrul teritorial deschis al României</h1>
      <p>
        Caută județe, UAT-uri și localități după denumire sau cod SIRUTA, cu identificatori persistenți
        și proveniență verificabilă.
      </p>

      <form className="search-form" action="/" method="get">
        <label htmlFor="q">
          Denumire sau cod SIRUTA
          <input id="q" name="q" type="text" defaultValue={q} placeholder="ex. Brașov sau 40276" />
        </label>
        <label htmlFor="type">
          Tip
          <select id="type" name="type" defaultValue={type}>
            <option value="">Toate</option>
            {Object.entries(TERRITORY_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="status">
          Stare
          <select id="status" name="status" defaultValue={status}>
            <option value="">Toate</option>
            <option value="active">activ</option>
            <option value="inactive">inactiv</option>
            <option value="provisional">provizoriu</option>
          </select>
        </label>
        <button type="submit">Caută</button>
      </form>

      <p aria-live="polite">
        <span className="badge">
          Release {release.releaseId} — {release.territories.length.toLocaleString("ro-RO")} unități
          teritoriale
        </span>
        {" · "}
        {total.toLocaleString("ro-RO")} rezultate pentru filtrele alese.
      </p>

      {items.length === 0 ? (
        <p className="empty-state">Niciun rezultat pentru filtrele alese.</p>
      ) : (
        <table className="results">
          <caption className="visually-hidden">Unități teritoriale</caption>
          <thead>
            <tr>
              <th scope="col">Denumire</th>
              <th scope="col">Tip</th>
              <th scope="col">Stare</th>
              <th scope="col">Cod SIRUTA</th>
            </tr>
          </thead>
          <tbody>
            {items.map((territory) => {
              const siruta = territory.identifiers.find(
                (identifier) => identifier.scheme === "ro.ins.siruta"
              );
              return (
                <tr key={territory.territoryId}>
                  <td>
                    <a href={pathFor(territory)}>{territory.officialName}</a>
                  </td>
                  <td>{TERRITORY_TYPE_LABELS[territory.territoryType] ?? territory.territoryType}</td>
                  <td>{territory.status}</td>
                  <td>{siruta?.value ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {nextCursor && (
        <p className="pagination">
          <a href={`/?${buildQueryString(params, { cursor: nextCursor })}`}>Pagina următoare →</a>
        </p>
      )}

      <details>
        <summary>Județe ({counties.length})</summary>
        <ul>
          {counties.map((county) => (
            <li key={county.territoryId}>
              <a href={pathFor(county)}>{county.officialName}</a>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
