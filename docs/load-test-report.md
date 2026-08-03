# Test de sarcină (load test) — API v1

Metodologie: `autocannon`, 50 conexiuni concurente, 15s per endpoint, împotriva unui
build de producție (`next build && next start`) rulat local (loopback, proces Node
unic, fără clustering). Release `2026.07.23.3` (16.978 unități teritoriale).

Numerele de mai jos izolează costul aplicației (nu rețeaua/CDN-ul din producție) și
sunt gândite ca reper relativ pentru regresii, nu ca SLA absolut — o desfășurare reală
pe Vercel are altă topologie (edge regional, instanțe multiple, cold starts).

Pentru endpointurile de listare/căutare, rate limiting-ul a fost ridicat temporar
(`RATE_LIMIT_MAX_REQUESTS=1000000`) ca să măsurăm performanța reală a handler-elor,
nu cât de repede răspunde cu 429. Comportamentul limiter-ului sub sarcină e verificat
separat, mai jos.

## Rezultate finale (după cele două fixuri de mai jos)

| Endpoint | req/s | latență medie | p50 | p99 |
|---|---|---|---|---|
| `GET /api/v1/territories` | 260 | 191 ms | 185 ms | 267 ms |
| `GET /api/v1/territories?q=cluj` | 197 | 251 ms | 241 ms | 333 ms |
| `GET /api/v1/territories/{id}` | 159 | 312 ms | 308 ms | 415 ms |
| `GET /api/v1/territories/{id}/descendants` | 146 | 338 ms | 336 ms | 453 ms |
| `GET /api/v1/openapi.json` | 578 | 86 ms | 85 ms | 112 ms |

Zero erori sau timeout-uri pe niciun run. Node rulează pe un singur thread, deci la
50 de conexiuni concurente, latența reflectă în bună parte coadă de execuție
(request-urile se procesează secvențial pe același event loop), nu un defect —
throughput-ul crește liniar cu numărul de instanțe într-o desfășurare reală.

## Două probleme reale găsite și fixate în timpul benchmark-ului

### 1. Sortare completă recalculată la fiecare cerere

`searchTerritories` sorta întregul array filtrat (până la 16.978 elemente) la
**fiecare** apel, deși ordinea (după `territoryId`) e aceeași pentru orice request
împotriva aceluiași release. Fix: sortare o singură dată, la încărcarea release-ului
(`lib/release-source.mjs`), nu la fiecare căutare. TimSort-ul din V8 e adaptiv, deci
re-sortarea unui array deja sortat costă ~O(n) în loc de O(n log n):

- sortare pe date "brute": ~6 ms
- re-sortare pe date deja sortate: ~1.4 ms

### 2. Foldarea diacriticelor recalculată la fiecare căutare

`matchesQuery` apela `foldDiacritics` (care folosește `toLocaleLowerCase("ro-RO")`,
sensibil mai lentă decât un `toLowerCase` simplu) pe `officialName` și
`normalizedName` pentru **toate** cele 16.978 teritorii, la fiecare cerere cu
parametrul `q`. La 50 de conexiuni concurente, asta a dus la o coadă masivă:

| | înainte de fix | după fix |
|---|---|---|
| `?q=cluj` req/s | 11.5 | 197 |
| `?q=cluj` latență medie | 3731 ms | 251 ms |
| `?q=cluj` latență p99 | 4545 ms | 333 ms |

Fix: memoizare cu `WeakMap` cheiată pe obiectul teritoriu
(`lib/territory-search.mjs`), astfel încât foldarea se calculează o singură dată per
teritoriu, per proces — nu la fiecare request. Nu schimbă forma datelor sau
contractul funcțiilor existente (cele 119 teste au rămas neschimbate și trec).

## Verificarea rate limiting-ului sub sarcină

Rulat separat, cu limita implicită (120 request-uri / 60s per client), 20 conexiuni
concurente, 10s, un singur client (fără `X-Forwarded-For`, deci o singură cheie
`"unknown"` — exact scenariul pentru care limiter-ul există):

```
total requests: 3322
200: 120
429: 3202
```

Exact 120 de request-uri au trecut, restul au primit `429` cu header-ul
`Retry-After` prezent și corect. Comportament conform așteptărilor.

## Reproducere

```
RATE_LIMIT_MAX_REQUESTS=1000000 npm run build && npm run start -- -p 3100
npx autocannon -c 50 -d 15 -j http://localhost:3100/api/v1/territories
```
