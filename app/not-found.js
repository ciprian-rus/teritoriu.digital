// Forced dynamic so this participates in the per-request CSP nonce from
// middleware.js — a statically pre-rendered fallback would ship with a
// stale nonce baked in, and every one of Next.js's own bootstrap scripts
// would be blocked on every 404.
export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <>
      <h1>Nu am găsit pagina</h1>
      <p className="empty-state">
        Verifică adresa sau <a href="/">caută în registru</a>.
      </p>
    </>
  );
}
