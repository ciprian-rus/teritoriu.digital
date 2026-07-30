import { loadVerifiedRelease } from "@/lib/release-source.mjs";

export const dynamic = "force-dynamic";

export const metadata = {
  alternates: { canonical: "/" }
};

export default async function HomePage() {
  let release = null;
  let error = null;
  try {
    release = await loadVerifiedRelease();
  } catch (cause) {
    error = cause;
  }

  return (
    <>
      <h1>Registrul teritorial deschis al României</h1>
      <p>
        Caută județe, UAT-uri și localități după denumire sau cod SIRUTA, cu identificatori persistenți
        și proveniență verificabilă.
      </p>

      <form className="search-form" action="/teritorii" method="get">
        <label htmlFor="q">
          Denumire sau cod SIRUTA
          <input id="q" name="q" type="text" placeholder="ex. Brașov sau 40276" />
        </label>
        <button type="submit">Caută</button>
      </form>

      {error ? (
        <p className="error-state" role="alert">
          Release-ul public nu poate fi încărcat momentan. Încearcă din nou în câteva minute.
        </p>
      ) : (
        <p>
          <span className="badge">
            Release {release.releaseId} — {release.territories.length.toLocaleString("ro-RO")} unități
            teritoriale
          </span>
        </p>
      )}

      <p>
        <a href="/teritorii">Vezi tot registrul →</a>
      </p>
    </>
  );
}
