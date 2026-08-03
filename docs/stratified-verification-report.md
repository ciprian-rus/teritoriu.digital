# Verificare eșantion stratificat — toate cele 42 județe/3181 UAT

Criteriul de acceptare din #10 (M4) cere o verificare pe un eșantion stratificat
peste toate cele 42 de județe (41 județe + București) și cele 3181 UAT-uri locale.
Am făcut două verificări complementare: una exhaustivă asupra datelor (mai puternică
decât un eșantion), și una stratificată asupra site-ului live.

## 1. Verificare exhaustivă a integrității grafului teritorial

Deoarece release-ul complet e oricum încărcat în memorie la fiecare cerere, verificarea
tuturor celor 16.978 înregistrări costă la fel de puțin cât un eșantion, dar e dovadă
mai puternică. `tests/api/territorial-integrity.test.mjs` (rulează cu date reale, prin
`loadVerifiedRelease`, `skip` automat dacă rețeaua nu e disponibilă):

- exact 42 de rădăcini (41 `county` + 1 `bucharest`), fără altele;
- toate `territoryId`-urile sunt unice;
- cele 42 de subarbori (județe + București) **partiționează** exact întregul release —
  fiecare unitate aparține exact unui județ, fără orfani și fără suprapuneri;
- lanțul de strămoși al oricărei unități se termină mereu la una din cele 42 de
  rădăcini;
- `countyTerritoryId` al fiecărei unități corespunde exact rădăcinii din vârful
  propriului lanț de strămoși;
- toate județele și UAT-urile locale (municipii/orașe/comune/București) au un
  identificator SIRUTA nevid;
- numărul de UAT-uri locale pe tip corespunde registrului documentat: 103 municipii,
  216 orașe, 2862 comune (total 3181), 6 sectoare.

Toate cele 7 teste trec, pe toate cele 16.978 înregistrări — nu doar pe un eșantion.

## 2. Verificare stratificată live, pe site

Pentru fiecare din cele 42 de județe/București (stratificare pe județ), am ales
deterministic (alfabetic, nu aleator, pentru reproductibilitate) câte un UAT
reprezentativ, apoi am verificat cu Playwright, împotriva unui build de producție
local:

- pagina județului/Bucureștiului însuși;
- pagina UAT-ului reprezentativ ales din acel județ.

Pentru fiecare din cele 84 de pagini, s-a verificat:
- răspuns HTTP 200;
- `<h1>` conține denumirea oficială corectă;
- breadcrumb-ul conține strămoșii corecți (județul, pentru UAT-uri);
- zero erori de consolă în browser.

**Rezultat: 84/84 pagini corecte, 0 eșecuri.**

Capturi reprezentative (nu toate cele 84, ci un eșantion vizual din fiecare tip de
unitate): București, un sector, și o comună din județul Cluj cu subdiviziunile ei —
salvate separat, nu în acest repo (reproducere mai jos dacă e nevoie din nou).

## Reproducere

```
npm run build
npm run start -- -p 3100
node tests/api/territorial-integrity.test.mjs  # sau: npm test
# verificarea Playwright per-pagină e un script ad-hoc, nu parte din suita de teste
# (are nevoie de un server live și de Playwright), dar logica e simplă: pentru
# fiecare din cele 42 de rădăcini (GET /api/v1/territories?type=county și
# ?type=bucharest), alege un UAT reprezentativ prin
# GET /api/v1/territories/{id}/descendants?type=... și verifică ambele pagini.
```
