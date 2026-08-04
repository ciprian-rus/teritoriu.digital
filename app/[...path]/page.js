import { notFound } from "next/navigation";
import { loadVerifiedRelease } from "@/lib/release-source.mjs";
import { buildTerritoryIndex, getAncestors, getChildren } from "@/lib/territory-graph.mjs";
import { buildSlugIndex, resolveBySlugPath, slugPathFor } from "@/lib/territory-slug.mjs";
import { TERRITORY_TYPE_LABELS } from "@/lib/territory-labels.mjs";
import { UatMap } from "@/app/_components/uat-map.js";

export const dynamic = "force-dynamic";

async function resolve(pathSegments) {
  const release = await loadVerifiedRelease();
  const index = buildTerritoryIndex(release.territories);
  const slugIndex = buildSlugIndex(release.territories);
  const territoryId = resolveBySlugPath(slugIndex, pathSegments);
  const territory = territoryId ? index.byId.get(territoryId) : null;
  return { release, index, slugIndex, territory };
}

export async function generateMetadata({ params }) {
  const { path } = await params;

  let resolved;
  try {
    resolved = await resolve(path);
  } catch {
    return { title: "Teritoriu" };
  }

  if (!resolved.territory) return { title: "Teritoriu negăsit" };

  const { territory } = resolved;
  const typeLabel = TERRITORY_TYPE_LABELS[territory.territoryType] ?? territory.territoryType;
  return {
    title: territory.officialName,
    description: `${territory.officialName} — ${typeLabel}, stare ${territory.status}. Identificatori, strămoși și subdiviziuni din registrul teritorial.`,
    alternates: { canonical: `/${path.join("/")}` }
  };
}

export default async function TerritoryDetailPage({ params }) {
  const { path } = await params;

  let resolved;
  try {
    resolved = await resolve(path);
  } catch {
    return (
      <p className="error-state" role="alert">
        Release-ul public nu poate fi încărcat momentan. Încearcă din nou în câteva minute.
      </p>
    );
  }

  const { release, index, slugIndex, territory } = resolved;
  if (!territory) notFound();

  const ancestors = getAncestors(territory.territoryId, index).reverse();
  const children = getChildren(territory.territoryId, index).sort((a, b) =>
    a.officialName.localeCompare(b.officialName, "ro")
  );

  return (
    <>
      <ol className="breadcrumb">
        <li>
          <a href="/">Registru</a>
        </li>
        {ancestors.map((ancestor, position) => (
          <li key={ancestor.territoryId}>
            <a href={slugPathFor(ancestor, ancestors.slice(0, position), slugIndex)}>
              {ancestor.officialName}
            </a>
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

      {!territory.parentTerritoryId && children.length > 0 && (
        <>
          <h2>Hartă interactivă</h2>
          <UatMap
            countyGeometry={release.geometriesByTerritoryId?.get(territory.territoryId) ?? null}
            label={territory.officialName}
            units={children.map((child) => ({
              ...child,
              geometry: release.geometriesByTerritoryId?.get(child.territoryId) ?? null,
              path: slugPathFor(child, [...ancestors, territory], slugIndex)
            }))}
          />
        </>
      )}

      {children.length > 0 && (
        <>
          <h2>Subdiviziuni ({children.length})</h2>
          <ul>
            {children.map((child) => (
              <li key={child.territoryId}>
                <a href={slugPathFor(child, [...ancestors, territory], slugIndex)}>{child.officialName}</a>{" "}
                — {TERRITORY_TYPE_LABELS[child.territoryType] ?? child.territoryType}
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
