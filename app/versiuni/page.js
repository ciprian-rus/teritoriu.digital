import { loadVerifiedRelease } from "@/lib/release-source.mjs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Versiuni și modificări",
  description:
    "Diferențele dintre release-ul curent și cel anterior al registrului teritorial: unități adăugate, modificate și retrase.",
  alternates: { canonical: "/versiuni" }
};

function CodeList({ title, codes }) {
  if (codes.length === 0) {
    return (
      <p>
        <strong>{title}:</strong> niciunul
      </p>
    );
  }
  return (
    <details>
      <summary>
        {title} ({codes.length.toLocaleString("ro-RO")})
      </summary>
      <ul>
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function VersionsPage() {
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
        Release-ul public nu poate fi încărcat momentan. Încearcă din nou în câteva minute.
      </p>
    );
  }

  const { changelog } = release;

  return (
    <>
      <h1>Versiuni și modificări</h1>
      <p>
        Release curent: <strong>{release.releaseId}</strong>, publicat la{" "}
        <time dateTime={release.publishedAt}>{new Date(release.publishedAt).toLocaleString("ro-RO")}</time>.
        {changelog.previousReleaseId && (
          <>
            {" "}
            Comparat cu release-ul anterior <strong>{changelog.previousReleaseId}</strong>.
          </>
        )}
      </p>

      {changelog.baseline && (
        <p className="badge">
          Acesta e un release de referință (baseline) — nu are un release anterior comparabil în mod
          semnificativ.
        </p>
      )}

      <h2>Rezumat</h2>
      <table className="results">
        <thead>
          <tr>
            <th scope="col">Categorie</th>
            <th scope="col">Număr coduri SIRUTA</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Adăugate</td>
            <td>{changelog.added.length.toLocaleString("ro-RO")}</td>
          </tr>
          <tr>
            <td>Modificate</td>
            <td>{changelog.changed.length.toLocaleString("ro-RO")}</td>
          </tr>
          <tr>
            <td>Retrase</td>
            <td>{changelog.removed.length.toLocaleString("ro-RO")}</td>
          </tr>
          <tr>
            <td>Neschimbate</td>
            <td>{changelog.unchanged.toLocaleString("ro-RO")}</td>
          </tr>
          {changelog.sourceRecordChanged.length > 0 && (
            <tr>
              <td>Înregistrare sursă modificată (fără schimbare de identitate)</td>
              <td>{changelog.sourceRecordChanged.length.toLocaleString("ro-RO")}</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Detalii pe coduri SIRUTA</h2>
      <CodeList title="Adăugate" codes={changelog.added} />
      <CodeList title="Modificate" codes={changelog.changed} />
      <CodeList title="Retrase" codes={changelog.removed} />
      {changelog.sourceRecordChanged.length > 0 && (
        <CodeList title="Înregistrare sursă modificată" codes={changelog.sourceRecordChanged} />
      )}

      <h2>Ce nu arată încă această pagină</h2>
      <p>
        Diff-ul de mai sus e determinist și calculat automat la fiecare release (adăugat/modificat/retras
        pe cod SIRUTA), dar nu clasifică încă redenumiri, divizări sau comasări ca atare — acele relații
        (predecesor/succesor) există deja în modelul de date canonic, dar nu sunt încă publicate ca parte a
        release-ului. Rămâne un element deschis din foaia de parcurs (M7).
      </p>

      <p>
        <a href="/api/v1/changelog">API: /api/v1/changelog</a> · <a href="/date">Descărcări și schemă</a>
      </p>

      <p>
        <span className="badge">
          Release {release.releaseId} · schema {release.schemaVersion}
        </span>
      </p>
    </>
  );
}
