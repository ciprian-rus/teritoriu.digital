import { notFound } from "next/navigation";
import { loadVerifiedRelease } from "@/lib/release-source.mjs";
import { buildTerritoryIndex, getAncestors, getChildren } from "@/lib/territory-graph.mjs";

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

export default async function TerritoryDetailPage({ params }) {
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

  const ancestors = getAncestors(territoryId, index).reverse();
  const children = getChildren(territoryId, index).sort((a, b) =>
    a.officialName.localeCompare(b.officialName, "ro")
  );

  return (
    <>
      <ol className="breadcrumb">
        <li>
          <a href="/teritorii">Registru</a>
        </li>
        {ancestors.map((ancestor) => (
          <li key={ancestor.territoryId}>
            <a href={`/teritorii/${ancestor.territoryId}`}>{ancestor.officialName}</a>
          </li>
        ))}
        <li aria-current="page">{territory.officialName}</li>
      </ol>

      <h1>{territory.officialName}</h1>
      <p>
        <span className="badge">
          {TERRITORY_TYPE_LABELS[territory.territoryType] ?? territory.territoryType}
        </span>{" "}
        <span className="badge">{territory.status}</span>
      </p>

      <h2>Identificatori</h2>
      <table className="results">
        <thead>
          <tr>
            <th scope="col">Schemă</th>
            <th scope="col">Valoare</th>
            <th scope="col">Stare</th>
          </tr>
        </thead>
        <tbody>
          {territory.identifiers.map((identifier) => (
            <tr key={`${identifier.scheme}:${identifier.value}`}>
              <td>{identifier.scheme}</td>
              <td>{identifier.value}</td>
              <td>{identifier.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {children.length > 0 && (
        <>
          <h2>Subdiviziuni ({children.length})</h2>
          <ul>
            {children.map((child) => (
              <li key={child.territoryId}>
                <a href={`/teritorii/${child.territoryId}`}>{child.officialName}</a> —{" "}
                {TERRITORY_TYPE_LABELS[child.territoryType] ?? child.territoryType}
              </li>
            ))}
          </ul>
        </>
      )}

      <p>
        <span className="badge">
          Release {release.releaseId} · schema {release.schemaVersion}
        </span>
      </p>
    </>
  );
}
