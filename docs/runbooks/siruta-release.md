# Runbook: primul release SIRUTA

## Scop

M3 publică numai un candidat SIRUTA arhivat, reconstruit și aprobat explicit. Publicarea are trei granițe separate: aprobarea candidatului, publicarea artefactelor și promovarea atomică în registrul intern. Un eșec înaintea ultimei granițe nu mută `stable`.

## Condiții obligatorii

- snapshotul M1 există în bucketul privat și hashul său este verificat;
- rularea M2 este în starea `review`, fără findings `error` sau `blocker`;
- toate rândurile parsate au exact o decizie `matched` sau `create`;
- reviewerul aprobă exact `candidateSha256`, cu actor și motivare;
- repository-ul este public înaintea unei publicări publice;
- release-urile imuabile sunt activate în GitHub și confirmate prin variabila `RELEASE_IMMUTABILITY_CONFIRMED=true`;
- environment-ul `production` păstrează secretele Supabase și cere aprobare.

Repository-ul este încă privat în etapa de dezvoltare. Modul `prepare` poate fi folosit pentru verificarea completă a bundle-ului, dar modul `publish` se oprește dacă GitHub raportează altă vizibilitate decât `public`.

## 1. Aprobarea candidatului

Workflow: `Approve SIRUTA Candidate`.

Intrări:

- `import_run_id` — UUIDv7 exact din Canonicalize SIRUTA;
- `candidate_sha256` — hashul exact din raportul M2;
- `rationale` — motivarea verificării.

Operația blochează rândul importului, recalculează porțile din PostgreSQL, scrie o singură aprobare append-only și mută rularea în `approved`. O reluare cu același hash este idempotentă; un alt hash este coliziune și se oprește.

## 2. Pregătirea reproductibilă

Workflow: `Publish SIRUTA Release`, `mode=prepare`.

Intrări:

- `import_run_id` aprobat;
- `release_id` în forma `YYYY.MM.DD.N`;
- `published_at` UTC exact, cu milisecunde;
- motivarea promovării.

Pipeline-ul descarcă din nou snapshotul privat, verifică dimensiunea și SHA-256, reconstruiește candidatul cu același registru de identitate și cere același `candidateSha256`. Rezultatul conține exact:

- `territories.json`;
- `territories.csv` UTF-8;
- `validation-report.json`;
- `changelog.json`;
- `manifest.json` conform JSON Schema;
- `SHA256SUMS`.

`SHA256SUMS` include toate fișierele, mai puțin propriul hash, pentru a evita o referință circulară. Manifestul include hashurile celor patru artefacte de date; hashul manifestului este păstrat separat în planul de control.

Aceleași intrări produc aceiași octeți. Fișierele sunt create cu `create-only`; o reluare acceptă numai conținut identic.

## 3. Publicarea și promovarea

Workflow: `Publish SIRUTA Release`, `mode=publish`.

Înaintea oricărei publicări, workflow-ul verifică vizibilitatea repository-ului și confirmarea setării de imutabilitate. GitHub Release este pregătit ca draft, toate fișierele sunt descărcate din nou și verificate, iar draftul rămâne nepublic până după promovarea reușită în registru. Dacă tagul public există deja, octeții trebuie să fie identici și baza trebuie să conțină deja aceeași promovare finalizată; un release public nu poate iniția o promovare lipsă. Nu se folosește `--clobber` pe un release publicat.

După verificarea artefactelor din draft, tranzacția PostgreSQL:

1. reverifică aprobarea, snapshotul, commitul și canalul anterior;
2. compară fiecare `territory_id` cu decizia M2;
3. inserează identitățile, reviziile și identificatorii canonici;
4. înregistrează toate artefactele și hashurile;
5. marchează release-ul `published`;
6. mută `stable` și scrie evenimentul append-only;
7. marchează importul `completed` și scrie auditul.

Toate scrierile de mai sus au un singur commit. Dacă tranzacția eșuează, release-ul GitHub poate exista, dar `stable` nu se schimbă; reluarea verifică octeții existenți și reîncearcă numai promovarea.

Numai după commitul tranzacției, workflow-ul publică GitHub Release-ul și descarcă încă o dată activele publice pentru comparație. Dacă promovarea eșuează, release-ul rămâne draft și nu există un release public parțial. Dacă publicarea finală este întreruptă după promovare, aceeași rulare poate fi reluată: promovarea exactă devine no-op, apoi draftul este publicat.

## Verificare independentă

```bash
sha256sum --check SHA256SUMS
```

Importatorul de probă verifică manifestul, toate hashurile, `candidateSha256`, unicitatea identităților și referințele ierarhice înainte să construiască un nou read-model. Modelul activ este înlocuit numai după verificarea completă.

## Rollback

Workflow: `Move Stable Release`.

Rollback-ul nu șterge release-uri și nu restaurează baza. Operatorul alege un release publicat anterior și oferă o motivare; tranzacția mută doar pointerul `stable` și adaugă un eveniment `rollback`. O mutare spre o versiune mai nouă este înregistrată ca `promote`.

Înaintea primei lansări publice se execută într-un mediu izolat exercițiul cu două release-uri de test: import reușit, import corupt respins, promovare la al doilea release și revenire la primul.
