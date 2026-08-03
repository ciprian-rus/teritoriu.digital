import "./globals.css";

// metadataBase lets every page below declare a relative
// `alternates.canonical` and have Next.js resolve it to an absolute URL.
// Configurable because there's no production domain wired up yet —
// defaults to the project's own name, not a claim that domain is live.
export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://teritoriu.digital"),
  title: { default: "Teritoriu.digital", template: "%s — Teritoriu.digital" },
  description: "Registrul teritorial deschis al României"
};

export default function RootLayout({ children }) {
  return (
    <html lang="ro">
      <body>
        <a className="skip-link" href="#main">
          Sari la conținut
        </a>
        <header className="site-header">
          <nav aria-label="Principal">
            <a className="brand" href="/">
              Teritoriu.digital
            </a>
            <a href="/teritorii">Registru</a>
            <a href="/date">Date și API</a>
            <a href="/versiuni">Versiuni</a>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <p>
            Teritoriu.digital nu este, în acest moment, un registru juridic oficial. Publică un model
            canonic derivat din surse oficiale, împreună cu proveniența și limitele sale.
          </p>
        </footer>
      </body>
    </html>
  );
}
