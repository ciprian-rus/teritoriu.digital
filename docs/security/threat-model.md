# Threat model

Acest document susține criteriul din #16 (M11): "riscurile critice din threat
model sunt închise sau acceptate explicit". Nu repetă arhitectura din
`docs/architecture/system.md` — se concentrează pe active, actori și amenințări.

## Active de protejat

1. **Integritatea registrului canonic** (`registry` schema, Supabase) — identitatea
   persistentă (`territory_id`), ierarhia, identificatorii externi.
2. **Integritatea artefactelor publicate** (release-uri GitHub imuabile) — odată
   publicate, trebuie să rămână exact ce a fost verificat.
3. **Disponibilitatea site-ului/API-ului public** — nu trebuie să depindă de
   disponibilitatea INS/ANCPI/data.gov.ro/Supabase la runtime.
4. **Secretele Supabase** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_DB_URL`) — acces privilegiat la planul de control.
5. **Reputația/încrederea consumatorilor** — orice consumator (inclusiv
   Inventar.digital) trebuie să poată respinge un bundle corupt sau falsificat.

## Actori și limite de încredere

| Actor | Poate | Nu poate |
|---|---|---|
| Vizitator public (site/API) | Citește date promovate, doar `GET` | Scrie în registru, vede planul de control |
| Consumator extern (ex. Inventar.digital) | Descarcă și verifică independent release-uri publicate | Ocolește verificarea checksum/schemă (fail-closed) |
| Contribuitor GitHub (PR) | Propune schimbări de cod, rulează CI fără secrete | Rulează workflow-uri cu `environment: production` fără aprobare |
| Deținător acces `production` environment | Declanșează workflow-uri privilegiate (acquire/canonicalize/approve/publish/promote) | — (acesta e chiar vârful lanțului de încredere; vezi „Riscuri reziduale") |

Toate workflow-urile care ating Supabase sau publică release-uri rulează sub
`environment: production`, care necesită aprobare explicită per rulare
(`environment protection rules` din GitHub Settings — verificare/configurare
rămâne la deținătorul repo-ului, tokenul folosit din sesiunile automate nu are
drepturi de admin să confirme sau să schimbe asta).

## Amenințări, mitigări existente, risc rezidual

### 1. Bundle de release corupt sau falsificat ajunge la un consumator
- **Mitigare**: `verifyConsumerRelease`/`verifyTerritorialReleaseBundle` — fail-closed,
  verifică schema, checksumurile SHA-256 și contractul înainte de a accepta orice
  înregistrare. Testat cu 124+ teste, inclusiv fuzz pe parametrii de intrare.
- **Rezidual**: dacă un atacator compromite contul GitHub cu drepturi de scriere
  pe repo, ar putea publica un release fals sub un tag existent. Parțial acoperit
  de `--verify-tag` la crearea tag-ului și re-descărcarea/comparația independentă
  din `publish-siruta-release.yml` (`cmp --silent` după fiecare upload), dar
  compromiterea contului însuși rămâne un risc acceptat, atenuat de 2FA la
  nivel de cont GitHub (control organizațional, nu de cod).

### 2. Secrete Supabase expuse
- **Mitigare**: secretele apar doar în workflow-uri cu `environment: production`
  (acquire/bootstrap/canonicalize/approve/mirror/publish/promote/verify), nu în
  `ci.yml`/`database.yml` (teste, fără secrete reale). Niciun secret nu ajunge în
  bundle-ul public, în loguri de build sau în browser.
- **Rezidual**: rotația periodică a secretelor (`SUPABASE_SERVICE_ROLE_KEY`) nu e
  automatizată — depinde de un proces manual, netestat încă prin exercițiu
  (criteriu deschis, vezi #16 "rotație secrete").

### 3. Compromitere supply-chain (dependențe npm sau GitHub Actions)
- **Mitigare**: Actions pinned la commit SHA (nu tag-uri mutabile) în toate
  workflow-urile; `dependabot.yml` propune actualizări săptămânale pentru npm și
  Actions; SBOM (CycloneDX) generat și păstrat ca artefact la fiecare rulare CI;
  `npm ci --ignore-scripts` în CI (nu rulează scripturi de instalare arbitrare);
  `npm audit --audit-level=high` rulează în CI la fiecare push/PR și eșuează
  build-ul pe vulnerabilități high/critical necorectate.
- **Rezidual**: dependența de integritatea registry-ului npm însuși
  (`npm audit`/`npm ci` au verificare de integritate prin lockfile, dar nu
  semnătură criptografică per pachet).

### 4. Abuz al API-ului public (scraping agresiv, enumerare, DoS aplicativ)
- **Mitigare**: rate limiting per client (120 req/60s implicit), CSP cu nonce,
  fără autentificare necesară pentru citire (deci fără credențiale de furat),
  paginare cursor (nu permite salt arbitrar în date).
- **Rezidual**: rate limiter e în memorie, per instanță caldă — nu e o garanție
  distribuită. Documentat explicit ca decizie asumată în `lib/rate-limit.mjs`
  (nu Upstash/Vercel KV încă, până există trafic real de dimensionat). Un
  atacator distribuit pe multe IP-uri poate ocoli limita per-IP; nu există încă
  un WAF/CDN-level rate limiting în fața aplicației (depinde de platforma de
  găzduire aleasă, nefixată încă).

### 5. XSS / injecție de conținut în site
- **Mitigare**: CSP cu nonce per-request (`strict-dynamic`), fără `unsafe-inline`
  în producție, randare server-side fără `dangerouslySetInnerHTML`, fuzz testing
  confirmă că input-uri de tip `<script>...</script>` sunt tratate ca text opac
  în datele teritoriale, nu executate.
- **Rezidual**: niciunul identificat; acoperire confirmată prin audit axe +
  Lighthouse + fuzz testing.

### 6. Corupere sau pierdere a bazei de control Supabase
- **Mitigare**: backup/restore documentat și testat (`docs/runbooks/backup-restore.md`,
  `scripts/restore-drill.sh` rulat în `database.yml`).
- **Rezidual**: frecvența reală de exercițiu (trimestrial, conform #16) nu e
  automatizată/urmărită încă printr-un calendar sau alertă.

### 7. Rollback greșit sau `stable` pointat spre un release invalid
- **Mitigare**: `move-stable-release.yml` rulează sub `environment: production`,
  cu verificări proprii înainte de a muta pointerul; release-urile în sine sunt
  imuabile (ADR 0003), deci rollback = repointare, nu rescriere.
- **Rezidual**: niciun risc critic identificat suplimentar.

## Riscuri acceptate explicit (fără mitigare suplimentară plănuită acum)

- **Rate limiter în memorie, nu distribuit** — acceptat până există trafic real
  de dimensionat împotriva unui serviciu extern plătit (Upstash/Vercel KV).
- **Fără WAF/CDN rate limiting** — depinde de platforma de găzduire, decizie
  neluată încă (nu e specific acestui cod).
- **Rotația secretelor Supabase e manuală** — acceptat pentru moment, documentat
  ca gol cunoscut, nu ca lucru rezolvat.

Niciunul din riscurile de mai sus nu e clasificat drept critic/blocant pentru
starea curentă a proiectului (pre-M12); toate sunt cunoscute, documentate și
urmăribile ca elemente separate de backlog, nu ascunse.
