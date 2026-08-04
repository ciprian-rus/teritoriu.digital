# Raport Lighthouse — pagini publice

Măsurători locale (`lighthouse` CLI, Chromium headless, `next build && next start`),
release `2026.07.23.3`. Un singur run per pagină; folosit ca dovadă de prag, nu ca
măsurătoare de teren (p75 real necesită telemetrie din producție, ex. Vercel Analytics
sau CrUX, odată ce site-ul e live pe un domeniu public).

| Pagină | Performance | Accessibility | Best Practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| `/` | 95 | 100 | 100 | 100 | 2.3 s | 0 | 210 ms |
| `/alba` | 99 | 100 | 100 | 100 | 1.5 s | 0 | 110 ms |
| `/alba/alba-iulia` | 98 | 100 | 100 | 100 | 1.6 s | 0 | 160 ms |
| `/date` | 96 | 100 | 100 | 100 | 2.2 s | 0 | 160 ms |

Toate cele patru pagini publice trec pragul de acceptare din issue-ul M4
(LCP < 2.5 s), cu marjă confortabilă.

Re-măsurat după mutarea căutării/listei pe `/` (fostul `/teritorii`) și
trecerea la URL-uri ierarhice bazate pe slug (`/alba`, `/alba/alba-iulia`,
...) în locul UUID-urilor din fostul `/teritorii/[territoryId]`. `/` scade
ușor față de rularea anterioară (listă completă de 50 de rezultate randată
direct pe pagina principală, în loc de doar formular + link), rămânând
totuși cu marjă mare sub pragul de 2,5 s.

## Notă despre `errors-in-console` (best-practices)

Prima rulare a semnalat un 404 pe `/favicon.ico` (browserul îl cere implicit,
indiferent de `<link rel="icon">`). Fixat prin `app/icon.svg` (convenția Next.js
App Router), care generează automat tag-ul de icon corect; scorul best-practices
a urcat de la 96 la 100 pe toate paginile după fix.

## Reproducere

```
npm run build
npm run start -- -p 3100
CHROME_PATH=/cale/spre/chromium npx lighthouse http://localhost:3100/ \
  --output=json --output-path=home.json \
  --chrome-flags="--headless=new --no-sandbox" \
  --only-categories=performance,accessibility,best-practices,seo
```
