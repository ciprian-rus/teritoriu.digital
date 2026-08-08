# Runbook: backup și restaurare

## Obiective

Baza Supabase este planul de control. Pierderea ei nu trebuie să facă indisponibile release-urile publice, iar restaurarea ei nu înlocuiește rollback-ul public. Obiectivele inițiale sunt:

- RPO operațional: maximum 24 de ore după existența datelor canonice;
- RTO de control: 4 ore pentru un incident de severitate ridicată;
- release-urile și snapshoturile brute au copii independente de rândurile bazei;
- un restore este considerat valid numai după verificarea schemei, numărului de obiecte și integrității referințelor.

Supabase furnizează backupurile platformei conform planului proiectului; politica curentă se verifică periodic în [documentația oficială](https://supabase.com/docs/guides/platform/backups). Aceste backupuri nu înlocuiesc exercițiul reproductibil al schemei `registry`.

## Restore drill automat

Workflow-ul `Database` execută `scripts/restore-drill.sh` într-un mediu Supabase local izolat:

1. introduce o înregistrare-santinelă;
2. exportă separat schema și datele `registry`;
3. creează o bază temporară curată;
4. instalează PostGIS în schema `gis`;
5. restaurează schema și datele;
6. compară numărul de tabele și verifică santinela;
7. șterge baza temporară.

Exercițiul nu conține și nu accesează date de producție — folosește o santinelă fabricată, nu confirmă restaurabilitatea datelor reale.

## Drill real de producție

Workflow-ul `Production restore drill` (`.github/workflows/production-restore-drill.yml`,
`scripts/production-restore-drill.sh`) completează drill-ul de mai sus cu date
reale: rulează `pg_dump --data-only` direct din producție (`SUPABASE_DB_URL`,
strict citire — `pg_dump` nu poate scrie), restaurează rândurile reale ale
schemei `registry` într-o instanță locală Supabase efemeră (pornită de la zero
prin `supabase db start`, distrusă la finalul job-ului) și verifică: numărul
de rânduri per tabel se potrivește cu producția, toate geometriile *curente*
(cea mai recentă per teritoriu/tip, nu tot istoricul append-only — rânduri
vechi, înlocuite, pot rămâne intenționat invalide ca parte a istoricului
onest) trec `gis.ST_IsValid`, iar `gis.ST_Area` calculează o arie pozitivă
pentru fiecare. Nu scrie niciodată înapoi în producție.

„Curentă" e rezolvată în doi pași, aceeași convenție ca `resolveGeometriesByTerritoryId` din `lib/release-source.mjs` (codul care decide ce serveşte de fapt site-ul/API-ul): mai întâi cel mai recent rând per `(territory_id, geometry_kind)`, apoi, dintre acestea, geometria pe care registrul o servește azi per teritoriu — `source_corrected` (corecție tehnică de validitate peste un poligon `source` ANCPI invalid, vezi `scripts/correct-source-geometries.mjs`) câștigă în fața lui `source` pentru același teritoriu. Rândul `source` original rămâne neschimbat în bază; fără acest al doilea pas, drill-ul ar semnala la nesfârșit acel rând intenționat păstrat, chiar și după ce corecția pe care contractul public o servește deja există.

Scop limitat, explicit: acoperă doar rândurile schemei `registry`. Octeții
fișierelor din Storage (arhivele brute SIRUTA/ANCPI, referențiate prin hash
din `source_snapshots`) rămân acoperiți de backupurile administrate de
Supabase însuși, nu de acest drill.

Declanșare: manual (`workflow_dispatch`) oricând, plus programat trimestrial
(1 ianuarie/aprilie/iulie/octombrie), conform cadenței de mai jos.

## Restaurare operațională

1. Data Owner declară incidentul și îngheață promovările.
2. Custodele tehnic identifică punctul de restaurare și păstrează dovada incidentului.
3. Restaurarea se face inițial într-un proiect/branch izolat, niciodată direct peste singura copie disponibilă.
4. Se rulează migrațiile repository-ului și testele pgTAP.
5. Se verifică: snapshoturi, identități, revizii, identificatori, geometrii, findings, release-uri, artefacte și audit.
6. Hashurile obiectelor Storage se compară cu `source_snapshots` și `release_artifacts`.
7. Reviewerul aprobă revenirea planului de control.
8. Canalul public `stable` se schimbă numai prin procedura separată de rollback și numai dacă este necesar.

## Frecvență și dovezi

- restore drill local (santinelă fabricată): la orice schimbare a migrațiilor și cel puțin lunar;
- drill real de producție (date reale, `production-restore-drill.yml`): manual oricând, programat trimestrial (1 ian/apr/iul/oct) — înlocuiește obiectivul anterior "înainte de primul release stabil și trimestrial după lansare" cu o execuție automată, nu doar o intenție;
- verificarea backupului administrat de Supabase (octeții din Storage): lunar;
- dovezi păstrate: workflow, commit, punct de restaurare, durată, controale trecute, abateri și acțiuni corective.
