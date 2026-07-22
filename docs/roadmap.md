# Roadmap

| Milestone | Rezultat verificabil | Stare |
|---|---|---|
| M0 — Fundație | ADR-uri, contract inițial, schemă Supabase, CI și guvernanță | în lucru — tehnic validat; rămân licența și branch protection |
| M1 — Surse | registru de surse și downloader controlat, reluabil | implementat; rămân dovezile live de publicare idempotentă |
| M2 — Model | parser, reconciliere UUIDv7 și validări canonice | implementat; rămâne stagingul oficial live |
| M3 — Primul release | snapshot SIRUTA verificat, JSON/CSV, manifest, SHA-256 și diff | în implementare — builder, aprobare și rollback validate local |
| M4 — Site | căutare și navigare ierarhică accesibilă | planificat |
| M5 — API | `/api/v1`, OpenAPI, ETag, paginare și teste de contract | planificat |
| M6 — Geometrii | ANCPI, validare PostGIS, GeoJSON/TopoJSON și hărți | planificat |
| M7 — Istoric | revizii, predecesori/succesori și comparații temporale | planificat |
| M8 — Inventar | import controlat și rollback demonstrat | planificat |
| M9 — Deliberativ | contract teritorial și hărți UAT | planificat |
| M10 — Alte aplicații | Transparenta și Examene pe același `territory_id` | planificat |
| M11 — Hardening | observabilitate, backup/restore, incidente și SLA | planificat |
| M12 — Stabil | release public stabil și minimum un consumator activ | planificat |

## Poarta M0

M0 se închide numai după:

- rularea migrației într-un proiect Supabase Preview;
- trecerea testelor pgTAP și a lintului bazei;
- confirmarea licenței codului;
- configurarea branch protection;
- aprobarea explicită a ADR-urilor;
- demonstrarea că schema `registry` nu este expusă anonim.
