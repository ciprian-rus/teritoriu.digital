# Runbook: achiziția snapshoturilor SIRUTA

## Scop și limite

Workflow-ul `Acquire SIRUTA` rulează independent de aplicația web. El descoperă resursa prin API-ul CKAN, validează ID-ul și URL-ul configurate, descarcă octeții sursă, rulează profilul canonic M2 și oprește execuția la orice abatere neaprobată. Un eșec nu modifică datele canonice și nici canalul `stable`.

Programarea săptămânală rulează inițial numai `--dry-run`. Trecerea programării la `--publish` se face printr-un PR separat după două rulări manuale idempotente și aprobare explicită.

Dry-run-ul din PR și cel programat folosesc `--fail-on-observed-change`: dacă mărimea sau SHA-256 diferă de baseline-ul revizuit din configurație, workflow-ul afișează noile valori și eșuează. Baseline-ul se actualizează numai printr-un PR care verifică emitentul, resursa, licența, schema și raportul M2.

Resursa observată este declarată `text/csv`, dar conținutul este XLSX. Acesta este un avertisment cunoscut și auditat; pipeline-ul acceptă exclusiv semnătura XLSX pentru această sursă.

## Moduri de rulare

Validare fără scrieri:

```bash
npm run acquire:siruta -- --dry-run
```

Arhivă locală, utilă numai pentru dezvoltare și testare:

```bash
npm run acquire:siruta -- --archive-dir .artifacts/source-snapshots
```

Arhivare în bucketul privat și înregistrare în PostgreSQL:

```bash
npm run acquire:siruta -- --publish
```

Pentru a cere exact un snapshot cunoscut, se adaugă `--expected-sha256 <sha>`. Fără această opțiune, un hash nou este arhivat ca snapshot nou și rămâne nepromovat până la M2/M3.

## Secrete server-side

Modul `--publish` cere exclusiv în mediul de execuție:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `SUPABASE_DB_URL`.

Valorile nu se introduc în repository, argumente CLI sau loguri. În GitHub se configurează ca secrets ale environment-ului `production`, cu aprobare obligatorie. Ele sunt injectate numai în pasul manual de publicare, după ce jobul `validate` a trecut fără secrete. Cheia service-role nu este disponibilă instalării, testelor sau aplicației web. Rotirea unei chei presupune actualizarea secretului din environment, o rulare `--dry-run`, o rulare `--publish`, apoi revocarea valorii vechi.

## Garanții

- HTTPS, host și port allowlistate exact;
- rezoluția DNS este verificată, iar conexiunea folosește adresa publică deja validată;
- fiecare redirect este revalidat;
- maximum 5 MiB, 60 de secunde/încercare, maximum patru încercări;
- retry numai pentru erori de rețea, timeout, `408`, `425`, `429` și `5xx`;
- SHA-256 calculat pe octeții exacți;
- antetul și profilul SIRUTA sunt validate înaintea oricărei scrieri;
- cale de stocare derivată din hash și upload fără `upsert`;
- un obiect existent este descărcat și reverificat înainte de a fi acceptat;
- unicitate în baza de date pe `(source_id, sha256)`;
- fiecare observație produce un eveniment append-only în `audit_events`;
- niciun pas nu promovează automat un release.

## Investigarea unui eșec

1. Se păstrează canalul `stable` nemodificat.
2. Se verifică doar codul de eroare și starea sursei; nu se dezactivează validările.
3. Pentru `CKAN_RESOURCE_URL_CHANGED` sau `CKAN_RESOURCE_MISSING`, se verifică manual pagina oficială, ID-ul resursei, emitentul și licența. Orice actualizare de configurație trece prin PR.
4. Pentru `PRIVATE_ADDRESS_BLOCKED`, `HOST_BLOCKED` sau `PROTOCOL_BLOCKED`, execuția rămâne blocată; nu se extinde allowlistul fără dovadă oficială.
5. Pentru `MEDIA_TYPE_UNEXPECTED`, fișierul se tratează ca necunoscut și nu se parsează.
6. Pentru `TIMEOUT`, logul indică faza (`ckan-discovery` sau `snapshot-download`), numărul de încercări consumate, durata ultimei încercări și sursa timeoutului; se reia workflow-ul numai după epuizarea retry-urilor interne.
7. Pentru o indisponibilitate temporară, se reia workflow-ul; cheia `(source_id, sha256)` previne duplicarea.

## Dovezi pentru închiderea M1

- CI unit/policy verde;
- Supabase Preview verde pentru bucket și permisiuni;
- o rulare GitHub Actions `--dry-run` pe sursa reală;
- o rulare `--publish` care creează obiectul și rândul snapshotului;
- a doua rulare `--publish` cu același hash, cu `archiveCreated=false` și `snapshotCreated=false`;
- confirmarea că nu s-a modificat niciun release/canal public.
