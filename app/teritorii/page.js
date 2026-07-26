import { loadVerifiedRelease } from "@/lib/release-source.mjs";
import { searchTerritories } from "@/lib/territory-search.mjs";

export const dynamic = "force-dynamic";

const TERRITORY_TYPE_LABELS = {
  country: "țară",
  macroregion: "macroregiune",
  development_region: "regiune de dezvoltare",
  county: "județ",
  bucharest: "București",
  sector: "sector",
  municipality: "municipiu",
  city: "oraș",
  commune: "comună",
  component_locality: "localitate componentă",
  village: "sat",
  other: "altul"
};

function buildQueryString(params, overrides) {
  const merged = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value !== undefined && value !== null && value !== "") merged.set(key, String(value));
  }
  return merged.toString();
}

export default async function TerritoriesPage({ searchParams }) {
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
      <p className="error-state" role="alert">
        Release-ul public nu poate fi încărcat momentan. Datele afișate în mod normal aici rămân
        neschimbate — încearcă din nou în câteva minute.
      </p>
    );
  }

  const { items, nextCursor, total } = searchTerritories(release.territories, {
    q: q || undefined,
    type: type || undefined,
    status: status || undefined,
    cursor,
    limit: 50
  });

  const counties = release.territories
    .filter((territory) => territory.territoryType === "county" || territory.territoryType === "bucharest")
    .sort((a, b) => a.officialName.localeCompare(b.officialName, "ro"));

  return (
    <>
      <h1>Registrul teritorial</h1>

      <form className="search-form" action="/teritorii" method="get">
        <label htmlFor="q">
          Denumire sau cod SIRUTA
          <input id="q" name="q" type="text" defaultValue={q} />
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
        <button type="submit">Filtrează</button>
      </form>

      <p aria-live="polite">
        {total.toLocaleString("ro-RO")} rezultate din release-ul {release.releaseId}.
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
                    <a href={`/teritorii/${territory.territoryId}`}>{territory.officialName}</a>
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
          <a href={`/teritorii?${buildQueryString(params, { cursor: nextCursor })}`}>
            Pagina următoare →
          </a>
        </p>
      )}

      <details>
        <summary>Județe și sectoare ({counties.length})</summary>
        <ul>
          {counties.map((county) => (
            <li key={county.territoryId}>
              <a href={`/teritorii/${county.territoryId}`}>{county.officialName}</a>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
