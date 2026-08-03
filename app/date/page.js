import { loadVerifiedRelease } from "@/lib/release-source.mjs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Date și API",
  description:
    "Descarcă registrul teritorial ca JSON, NDJSON sau CSV, verifică checksumurile publicate și consultă documentația OpenAPI a API-ului public.",
  alternates: { canonical: "/date" }
};

const REPO = "ciprian-rus/teritoriu.digital";

function assetUrl(releaseTag, name) {
  return `https://github.com/${REPO}/releases/download/${releaseTag}/${name}`;
}

export default async function DatePage() {
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
        Release-ul public nu poate fi încărcat momentan. Linkurile de descărcare de mai jos rămân
        neschimbate — încearcă din nou în câteva minute.
      </p>
    );
  }

  const downloads = [
    { name: "territories.json", label: "Toate unitățile teritoriale (JSON)" },
    { name: "territories.ndjson", label: "Toate unitățile teritoriale (NDJSON, o linie per unitate)" },
    { name: "territories.csv", label: "Toate unitățile teritoriale (CSV)" },
    { name: "territory-identifiers.csv", label: "Identificatori externi (CSV)" },
    { name: "manifest.json", label: "Manifestul release-ului" },
    { name: "contract.json", label: "Contractul de date" },
    { name: "changelog.json", label: "Jurnalul de modificări" },
    { name: "validation-report.json", label: "Raportul de validare" },
    { name: "SHA256SUMS", label: "Checksumuri SHA-256 pentru toate fișierele" }
  ];

  return (
    <>
      <h1>Date și API</h1>
      <p>
        Release curent: <strong>{release.releaseId}</strong> ({release.territories.length.toLocaleString("ro-RO")}{" "}
        unități teritoriale), publicat la{" "}
        <time dateTime={release.publishedAt}>{new Date(release.publishedAt).toLocaleString("ro-RO")}</time>.
      </p>
      <p>
        Manifest SHA-256: <code>{release.manifestSha256}</code>
      </p>

      <h2>Descărcări</h2>
      <p>
        Fiecare fișier de mai jos aparține release-ului GitHub <code>{release.releaseTag}</code> și este
        verificabil independent față de <code>SHA256SUMS</code> și schema publicată.
      </p>
      <ul>
        {downloads.map((file) => (
          <li key={file.name}>
            <a href={assetUrl(release.releaseTag, file.name)}>{file.label}</a> (<code>{file.name}</code>)
          </li>
        ))}
      </ul>

      <h2>API</h2>
      <p>
        API-ul public <code>/api/v1</code> servește exact aceleași date, verificate la pornire, cu paginare,
        ETag și rate limiting.
      </p>
      <ul>
        <li>
          <a href="/api/v1/openapi.json">Documentație OpenAPI (JSON)</a>
        </li>
        <li>
          <a href="/api/v1/territories">GET /api/v1/territories</a> — listare și căutare
        </li>
      </ul>

      <h2>Licență</h2>
      <p>
        Codul sursă este licențiat AGPL-3.0. Datele publicate în release-uri sunt licențiate CC-BY-4.0.
        Detalii complete în <a href="https://github.com/ciprian-rus/teritoriu.digital/blob/main/LICENSE">LICENSE</a>.
      </p>
    </>
  );
}
