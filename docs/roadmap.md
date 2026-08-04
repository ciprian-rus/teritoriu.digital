# Roadmap

| Milestone | Rezultat verificabil | Stare |
|---|---|---|
| M0 — Fundație | ADR-uri, contract inițial, schemă Supabase, CI și guvernanță | finalizat — LICENSE (AGPL-3.0-only, #33), branch protection pe `main` și aprobarea ADR-urilor 0001-0003 confirmate de owner (#2) |
| M1 — Surse | registru de surse și downloader controlat, reluabil | finalizat pe snapshotul oficial |
| M2 — Model | parser, reconciliere UUIDv7 și validări canonice | finalizat; 16.978 identități promovate |
| M3 — Primul release | snapshot SIRUTA verificat, JSON/CSV, manifest, SHA-256 și diff | finalizat prin release-ul public `2026.07.23.2` și drill-ul izolat; `stable` curent este `2026.07.23.3` (contract v1, #8) |
| M4 — Site | căutare și navigare ierarhică accesibilă | finalizat — căutare/listare/detaliu (#39), pagină Date/API (#46), audit axe + Lighthouse (98-100 pe toate categoriile), verificare stratificată pe toate cele 42 județe/3181 UAT (#49) și navigare completă doar-tastatură (#50) |
| M5 — API | `/api/v1`, OpenAPI, ETag, paginare și teste de contract | finalizat — listare/căutare/ierarhie/subarbore (#36, #38, #45), OpenAPI cu exemple validate (#37, #44), rate limiting (#40), benchmark de sarcină cu 2 fixuri reale de performanță (#47) și fuzz testing pe parametri (#48) |
| M6 — Geometrii | ANCPI, validare PostGIS, GeoJSON/TopoJSON și hărți | în lucru — pipeline de achiziție implementat (`scripts/acquire-geometries.mjs`), contractul public v1 extins aditiv (`contractVersion` 1.1.0) cu `territory-geometries.geojson`, opțional, `required: false`, și harta interactivă (județe pe prima pagină, UAT-uri pe pagina fiecărui județ) construită direct pe acest contract, fără Leaflet/tile server. Sursa ANCPI RELUAT rămâne inaccesibilă din sandbox-ul interactiv de dezvoltare, dar accesul din GitHub Actions a fost verificat direct (HTTP 200). Matching SIRUTA→geometrie, scrierea în `registry.territory_geometries` și includerea în bundle sunt testate unitar; rularea reală (dry-run + publish + un release cu geometrii) încă neexecutată, deci harta afișează în prezent o stare de fallback ("contururile nu sunt încă disponibile") — se activează automat la primul release cu geometrii |
| M7 — Istoric | revizii, predecesori/succesori și comparații temporale | în lucru — modelul canonic e deja bitemporal (`valid_from`/`valid_to` + `recorded_at`/`recorded_to`) din migrația inițială; prima felie publică e live (`/versiuni`, `GET /api/v1/changelog`, #52) cu diff-ul determinist deja calculat de pipeline; relațiile predecessor/succesor există în schemă (`territory_relations`) dar nu sunt încă populate de niciun cod de reconciliere — rămâne un gol documentat, nu o presupunere |
| M8 — Contract consumator | contract v1 documentat, verificat și demonstrat printr-un consumator real | finalizat — contractul public v1 e închis prin #8; Inventar.digital l-a consumat cu succes ca prim exemplu real (import fail-closed și orchestrator de staging, [inventar-digital-stat#122](https://github.com/ciprian-rus/inventar-digital-stat/pull/122)/[#129](https://github.com/ciprian-rus/inventar-digital-stat/pull/129)). Teritoriu.digital e producătorul canonic — activarea, rollbackul și restul integrării interne a oricărui consumator (Inventar sau altul) sunt urmărite exclusiv în tracker-ul acelui proiect, nu aici |
| M9 — Deliberativ | ~~integrarea Deliberativ.digital~~ | închis, not_planned (#15) — descria muncă internă din alt repo, nu ceva ce teritoriu.digital produce. Partea reală (geometrii versionate, GeoJSON/TopoJSON) rămâne acoperită de M6; orice consumator le poate integra din contractul public, fără ca teritoriu.digital să urmărească integrarea lui ca milestone propriu |
| M10 — Alte aplicații | ~~integrarea Transparenta/Examene~~ | închis, not_planned (#17) — aceeași motivare ca M9; contractul public (M5) e deja suficient pentru orice consumator, integrarea lor nu e tracked aici |
| M11 — Hardening | observabilitate, backup/restore, incidente și SLA | în lucru — Actions pinned pe commit SHA, `dependabot.yml`, SBOM (CycloneDX) în CI, gate `npm audit --audit-level=high`, threat model documentat (#51, #59); branch protection și secret scanning rămân la deținătorul repo-ului (necesită acces admin din GitHub Settings) |
| M12 — Stabil | release public stabil, verificat end-to-end | planificat — depinde de M6–M11; **nu** mai depinde de starea vreunui consumator extern (#18 rescopat) — dovada că un consumator poate importa contractul public a fost deja obținută prin #8 |

## Poarta M0

M0 se închide numai după:

- rularea migrației într-un proiect Supabase Preview;
- trecerea testelor pgTAP și a lintului bazei;
- confirmarea licenței codului;
- configurarea branch protection;
- aprobarea explicită a ADR-urilor;
- demonstrarea că schema `registry` nu este expusă anonim.
