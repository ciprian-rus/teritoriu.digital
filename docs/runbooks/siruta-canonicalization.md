# Runbook: construirea candidatului canonic SIRUTA

## Scop

Acest flux transformă un snapshot SIRUTA arhivat într-un candidat canonic auditabil. Nu scrie în tabelele canonice și nu schimbă niciun release sau canal public. Rezultatul admis este numai `passed` sau `blocked`; promovarea va fi implementată separat în M3.

## Intrări obligatorii

- fișierul XLSX exact arhivat de M1;
- `snapshot_id` UUIDv7 din `registry.source_snapshots`;
- SHA-256 calculat pe octeții fișierului;
- configurația versionată `config/transforms/siruta-2025.json`;
- registrul de identitate anterior sau indexul citit din PostgreSQL;
- candidatul release-ului anterior, dacă există.

Extensia sursei nu este folosită pentru a decide formatul. Resursa oficială declarată CSV este decodată ca XLSX numai după detectarea semnăturii sale reale în M1.

## Rulare locală fără scrieri în bază

```bash
npm run candidate:siruta -- \
  --input .artifacts/source-snapshots/siruta.xlsx \
  --snapshot-id <uuidv7> \
  --snapshot-sha256 <sha256> \
  --identity-ledger .artifacts/identity-ledger.json \
  --previous-candidate .artifacts/previous-candidate.json
```

La primul import, opțiunile pentru ledger și candidatul anterior pot lipsi. Directorul implicit este derivat din hashul snapshotului și versiunea transformării.

## Rulare cu staging Supabase

```bash
npm run candidate:siruta -- \
  --input <snapshot.xlsx> \
  --snapshot-id <uuidv7> \
  --snapshot-sha256 <sha256> \
  --stage \
  --pipeline-commit <git-sha>
```

Modul `--stage` citește `SUPABASE_DB_URL` exclusiv din mediul server-side. El obține un advisory lock PostgreSQL înainte de citirea indexului de identitate și îl păstrează până după commit, astfel încât două importuri să nu propună UUID-uri concurente pentru același cod. Scrierea este tranzacțională în `import_runs`, `staging_records`, `validation_findings`, `identity_decisions` și `audit_events`. Nu inserează în `territories`, nu închide revizii și nu publică artefacte.

În GitHub Actions se folosește workflow-ul manual `Canonicalize SIRUTA`, numai din `main` și prin environment-ul protejat `production`. Operatorul copiază din rularea M1 exact `snapshot_id` și SHA-256. Workflow-ul citește metadatele interne, descarcă obiectul din bucketul privat, reverifică mărimea și hashul, apoi rulează aceeași comandă de staging. Secretele există numai în pașii de fetch/staging, nu la instalare sau testare. Raportul rezultat este păstrat 30 de zile ca artifact; snapshotul brut temporar nu este încărcat ca artifact.

## Ordinea transformării

1. Verificarea SHA-256 a intrării.
2. Inspectarea directorului ZIP: fără ZIP64/multi-disk/criptare, căi nesigure, intrări duplicate sau expansiune peste limite.
3. Decodarea primei foi XLSX și compararea exactă a celor 12 antete aprobate.
4. Păstrarea fiecărui rând brut, a poziției fizice și a hashului său canonic.
5. Normalizarea controlată a diacriticelor și conversia tipurilor sursă.
6. Validarea volumelor, codurilor unice, tipurilor, nivelelor, părinților, județelor și ciclurilor.
7. Reconcilierea exclusiv prin identificatorul `ro.ins.siruta`; denumirea nu decide identitatea.
8. Generarea unei propuneri UUIDv7 numai când nu există identitate activă, istorică sau propunere anterioară.
9. Construirea candidatului, a provenienței și a diff-ului semantic față de versiunea anterioară.
10. Scrierea artefactelor cu create-only; o reluare acceptă un fișier existent numai dacă octeții sunt identici.

## Profilul revizuit 2025

| Control | Valoare |
|---|---:|
| Antete | 12 |
| Rânduri totale | 16.978 |
| Nivel 1 | 42 |
| Nivel 2 | 3.181 |
| Nivel 3 | 13.755 |
| Avertismente checksum oficial | 77 |
| Valori NUTS lipsă | 215 |

Primele patru volume sunt porți blocante. Cele 77 de coduri care nu trec aplicarea literală a algoritmului publicat și cele 215 valori NUTS lipsă sunt avertismente de calitate ale sursei: valorile oficiale sunt păstrate, nu corectate implicit. Schimbarea numărului lor produce un avertisment distinct și trebuie examinată în review.

Snapshotul oficial folosește valoarea-santinelă `SIRSUP = 1` pentru toate cele 42 de înregistrări de nivel 1. Valoarea brută rămâne în staging, dar relația canonică este `parentTerritoryId = null`; aceeași valoare continuă să fie interpretată ca părinte real la nivelurile inferioare. Configurația blochează importul dacă numărul santinelelor se schimbă.

Înregistrarea `MUNICIPIUL BUCUREȘTI` cu SIRUTA `179132` este excepția oficială `TIP = 9`, nivel 2. Configurația versionată îi atribuie definiția canonică `municipality` / `local_uat`; excepția se aplică numai combinației exacte cod–tip–nivel, iar dispariția sau schimbarea ei blochează importul.

## Blocaje obligatorii

- antet sau tip SIRUTA necunoscut;
- rând neparsabil ori celule suplimentare cu valori;
- volum diferit de profilul aprobat;
- cod SIRUTA duplicat;
- părinte absent, nivel greșit, județ diferit sau ciclu;
- format NUTS3 invalid sau două coduri NUTS3 diferite în același județ;
- mai multe identități active pentru același cod;
- reutilizarea automată a unui cod istoric;
- conflict între o identitate activă și o propunere;
- depășirea pragurilor de schimbare în masă.

Un import blocat păstrează dovezile și deciziile de review, dar nu produce `candidate.json`.

## Artefacte

- `staging.json` — rânduri brute și parsate, cu hash;
- `validation-report.json` — profil, severități și dovezi;
- `identity-decisions.json` — match/create/needs_review;
- `identity-ledger.json` — maparea persistentă SIRUTA–UUID propusă;
- `diff.json` — adăugări, eliminări, câmpuri modificate și hashuri de rând sursă schimbate;
- `candidate.json` — numai dacă toate porțile blocante au trecut.

Înainte de aprobarea M3 se verifică manual că hashul candidatului este reproductibil la rerulare cu același ledger, că nicio decizie `needs_review` nu este ignorată și că diff-ul explică toate schimbările față de release-ul anterior.
