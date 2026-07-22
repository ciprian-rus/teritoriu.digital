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

Exercițiul nu conține și nu accesează date de producție.

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

- restore drill local: la orice schimbare a migrațiilor și cel puțin lunar;
- verificarea backupului administrat: lunar;
- exercițiu complet într-un proiect izolat: înainte de primul release stabil și trimestrial după lansare;
- dovezi păstrate: workflow, commit, punct de restaurare, durată, controale trecute, abateri și acțiuni corective.
