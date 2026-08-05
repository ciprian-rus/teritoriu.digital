# Runbook: chei/secrete compromise

## Obiective

Secretele Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`)
dau acces privilegiat la planul de control — nu la artefactele publice, care sunt
imuabile și independente de ele. O compromitere trebuie tratată ca incident asupra
planului de control, nu asupra registrului public; release-urile deja publicate nu
sunt afectate doar prin faptul că o cheie a fost expusă.

Ipoteza de compromitere include, fără a se limita la: expunere accidentală în log,
commit, fork sau issue public; scurgere prin dependință npm/Action compromisă;
acces neautorizat la environment-ul GitHub `production`; suspiciune rezonabilă,
chiar fără dovadă completă.

## Detecție

- alertă GitHub secret scanning (dacă activată de deținătorul repo-ului) pe un
  commit/PR/issue/comment;
- `mcp__github__run_secret_scanning` sau echivalent, rulat ad-hoc la suspiciune;
- activitate neașteptată în `registry.audit_events` (scrieri fără corespondent
  într-un run de pipeline cunoscut) sau în logurile Supabase (`get_logs`);
- raportare directă (contribuitor, consumator, cercetător de securitate).

## Containment imediat

1. Data Owner sau Custode tehnic declară incidentul și îngheață orice promovare
   de release aflată în lucru (aceeași procedură ca la restore, vezi
   `backup-restore.md`).
2. Cheia suspectă se rotește **imediat** din Supabase (Project Settings → API →
   regenerare `service_role`), nu se așteaptă confirmarea completă a compromiterii.
   Rotația invalidează instant cheia veche.
3. Secretul nou se actualizează în environment-ul GitHub `production`
   (Settings → Environments → `production` → Secrets) — niciodată la nivel de
   repository, conform `docs/governance/roles-and-promotion.md`.
4. Dacă expunerea a fost printr-un commit/log/artefact public, acel obiect nu se
   șterge silențios din istoric — se documentează în incident, iar ștergerea din
   istoricul git (dacă necesară) urmează un proces separat, explicit, nu ad-hoc.

## Evaluarea impactului

1. Se verifică `registry.audit_events` pentru fereastra de timp de la expunerea
   estimată până la rotație: orice scriere fără `import_run_id`/`candidateSha256`
   corespunzător unui workflow cunoscut e suspectă.
2. Se compară `territory_revisions`, `territory_geometries` și
   `source_snapshots` cu ultimul release publicat cunoscut ca valid — orice
   rând nou-apărut, neexplicat de un run de pipeline documentat, e tratat ca
   potențial neautorizat.
3. Dacă se confirmă o scriere neautorizată: canalul `stable` **nu** se schimbă
   direct; se urmează procedura de rollback din
   `docs/governance/roles-and-promotion.md` (`stable` mutat la ultimul release
   cunoscut ca valid), iar rândurile suspecte rămân în istoric, marcate în
   comunicarea incidentului — niciodată șterse, pentru a păstra trasabilitatea
   append-only a modelului bitemporal.
4. Dacă nu se confirmă nicio scriere neautorizată: incidentul se închide ca
   "expunere fără exploatare confirmată", cu aceleași dovezi păstrate.

## Verificare post-rotație

- toate workflow-urile cu `environment: production` rulează cu succes
  (`validate`/`dry-run`) folosind noul secret, înainte de a permite orice
  `publish`;
- vechea cheie e confirmată revocată (o cerere de test cu ea eșuează);
- `npm run contract:verify` confirmă că ultimul release public rămâne
  reconstruibil cu aceleași hashuri — o compromitere a planului de control nu
  poate, prin construcție (ADR 0003), altera un artefact deja publicat.

## Frecvență și dovezi

- rotație de rutină (nu ca răspuns la incident): la fiecare 6 luni sau la
  schimbarea unui membru cu acces `production`, oricare survine prima;
- exercițiu simulat (fără compromitere reală): anual, înaintea revizuirii
  trimestriale a restore drill-ului din `backup-restore.md`;
- dovezi păstrate: data detecției, ora rotației, rezultatul verificării
  `audit_events`, decizia de rollback sau non-rollback, și acțiunile corective.

## Limite

Confirmarea și configurarea GitHub secret scanning la nivel de repository
rămân la deținătorul repo-ului (acces admin din GitHub Settings) — acest
runbook acoperă răspunsul odată ce o compromitere e suspectată sau confirmată,
nu activarea mecanismului de detecție automată în sine.
