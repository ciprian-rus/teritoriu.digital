# Roadmap

| Milestone | Rezultat verificabil | Stare |
|---|---|---|
| M0 — Fundație | ADR-uri, contract inițial, schemă Supabase, CI și guvernanță | finalizat — LICENSE (AGPL-3.0-only, #33), branch protection pe `main` și aprobarea ADR-urilor 0001-0003 confirmate de owner (#2) |
| M1 — Surse | registru de surse și downloader controlat, reluabil | finalizat pe snapshotul oficial |
| M2 — Model | parser, reconciliere UUIDv7 și validări canonice | finalizat; 16.978 identități promovate |
| M3 — Primul release | snapshot SIRUTA verificat, JSON/CSV, manifest, SHA-256 și diff | finalizat prin release-ul public `2026.07.23.2` și drill-ul izolat; `stable` curent este `2026.07.23.3` (contract v1, #8) |
| M4 — Site | căutare și navigare ierarhică accesibilă | finalizat — căutare/listare/detaliu (#39), pagină Date/API (#46), audit axe + Lighthouse (98-100 pe toate categoriile), verificare stratificată pe toate cele 42 județe/3181 UAT (#49) și navigare completă doar-tastatură (#50) |
| M5 — API | `/api/v1`, OpenAPI, ETag, paginare și teste de contract | finalizat — listare/căutare/ierarhie/subarbore (#36, #38, #45), OpenAPI cu exemple validate (#37, #44), rate limiting (#40), benchmark de sarcină cu 2 fixuri reale de performanță (#47) și fuzz testing pe parametri (#48) |
| M6 — Geometrii | ANCPI, validare PostGIS, GeoJSON/TopoJSON și hărți | blocat — sursa ANCPI (geoportal/arcgis) inaccesibilă din mediul curent de execuție automatizat; necesită rulare dintr-un mediu cu acces la rețea la acele domenii |
| M7 — Istoric | revizii, predecesori/succesori și comparații temporale | în lucru — modelul canonic e deja bitemporal (`valid_from`/`valid_to` + `recorded_at`/`recorded_to`) din migrația inițială; prima felie publică e live (`/versiuni`, `GET /api/v1/changelog`, #52) cu diff-ul determinist deja calculat de pipeline; relațiile predecessor/succesor există în schemă (`territory_relations`) dar nu sunt încă populate de niciun cod de reconciliere — rămâne un gol documentat, nu o presupunere |
| M8 — Inventar | contract v1, import controlat și rollback demonstrat | în lucru — consumatorul fail-closed ([inventar-digital-stat#122](https://github.com/ciprian-rus/inventar-digital-stat/pull/122)) și orchestratorul de staging pe Supabase real ([inventar-digital-stat#129](https://github.com/ciprian-rus/inventar-digital-stat/pull/129)) sunt mergeate; o rulare `execute` a eșuat curat înainte de orice scriere din lipsa secretelor de Production (`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SECRET_KEY`) — activarea și rollbackul rămân checkpointuri separate |
| M9 — Deliberativ | contract teritorial și hărți UAT | planificat — depinde de M6 (geometrii) |
| M10 — Alte aplicații | Transparenta și Examene pe același `territory_id` | planificat — lucru în alte repository-uri, în afara scopului acestei sesiuni |
| M11 — Hardening | observabilitate, backup/restore, incidente și SLA | în lucru — Actions pinned pe commit SHA, `dependabot.yml`, SBOM (CycloneDX) în CI, gate `npm audit --audit-level=high`, threat model documentat (#51, #59); branch protection și secret scanning rămân la deținătorul repo-ului (necesită acces admin din GitHub Settings) |
| M12 — Stabil | release public stabil și minimum un consumator activ | planificat — depinde de M6–M11 |

## Poarta M0

M0 se închide numai după:

- rularea migrației într-un proiect Supabase Preview;
- trecerea testelor pgTAP și a lintului bazei;
- confirmarea licenței codului;
- configurarea branch protection;
- aprobarea explicită a ADR-urilor;
- demonstrarea că schema `registry` nu este expusă anonim.
