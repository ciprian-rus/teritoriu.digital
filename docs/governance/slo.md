# SLO intern — actualizare și disponibilitate

## Ce este și ce nu este acest document

Acesta e un obiectiv intern de operare (SLO), folosit pentru a prioritiza munca
de hardening și pentru a recunoaște explicit o abatere. **Nu** este un SLA
juridic sau o garanție contractuală față de consumatori — issue #16 (M11)
exclude explicit "promisiuni SLA juridice neaprobate", iar
`docs/law-alignment.md` rămâne sursa pentru orice afirmație cu implicații
legale. Un consumator nu poate invoca acest document ca temei contractual.

## Disponibilitatea artefactelor publicate

- **Obiectiv**: artefactele unui release deja publicat (`manifest.json`,
  bundle-urile de date, checksumurile) rămân descărcabile de pe GitHub
  Releases atâta timp cât GitHub Releases însuși e disponibil — nu depind de
  Supabase, de INS/ANCPI/data.gov.ro sau de orice server operat de acest
  proiect, prin construcție (ADR 0003, `docs/architecture/system.md`).
- **Măsurare**: `npm run contract:verify` reconstruiește și verifică
  hashurile oricărui release existent, oricând, independent de planul de
  control.
- **Abatere**: dacă un artefact devine indisponibil sau corupt, e un incident
  de disponibilitate GitHub, nu al acestui registru — se documentează ca atare
  în jurnalul de incidente, fără acțiune corectivă în cod.

## Disponibilitatea site-ului și API-ului public

- **Obiectiv**: site-ul (`/`, `/{județ}/{uat}/{localitate}`, `/date`,
  `/versiuni`) și `/api/v1` funcționează servind ultimul release `stable`
  cunoscut, chiar dacă sursele oficiale sau Supabase (planul de control) sunt
  indisponibile la runtime — acesta e un principiu nenegociabil deja declarat
  în `README.md`, nu doar un obiectiv.
- **Măsurare**: `lib/release-source.mjs` citește exclusiv din GitHub Releases,
  cache-uit la nivel de instanță; nicio cerere a utilizatorului nu atinge
  Supabase sau sursele externe.
- **Abatere**: orice regresie care introduce o dependență runtime de Supabase
  sau de o sursă externă în calea de citire publică e tratată ca defect
  blocant, nu ca degradare acceptabilă.

## Cadența de actualizare a registrului canonic

- **Obiectiv intern, nu promisiune**: un release SIRUTA nou se ia în
  considerare la fiecare ciclu de 6 luni al nomenclatorului oficial (aceeași
  cadență documentată de INS pentru SIRUTA însuși), plus ad-hoc la corecții
  acceptate (`docs/governance/roles-and-promotion.md`, secțiunea "Corecții").
- **Nu e un angajament de suport 1:1**: dacă sursa oficială e indisponibilă
  (a se vedea precedentul din `docs/runbooks/source-acquisition.md`, unde
  `data.gov.ro` a fost indisponibil temporar), pipeline-ul eșuează închis —
  `stable` rămâne pe ultimul release valid, niciodată pe date incomplete sau
  presupuse.

## Timp de răspuns la incident (RTO/RPO deja declarate)

Reiterate din `docs/runbooks/backup-restore.md`, ca să existe un singur loc de
adevăr pentru toate obiectivele operaționale — nu se duplică valorile aici, ci
se trimite la sursă: RPO operațional de 24h, RTO de control de 4h pentru
severitate ridicată.

## Revizuire

Acest document se revizuiește la fiecare exercițiu trimestrial de restore
(`backup-restore.md`) și la orice incident real, indiferent de tip — orice
abatere constatată între obiectiv și realitate se consemnează aici ca
modificare a obiectivului sau ca acțiune corectivă, niciodată ca ștergere
tăcută a abaterii.
