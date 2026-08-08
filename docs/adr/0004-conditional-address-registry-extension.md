# ADR 0004: Extinderea condiționată către registrul de adresare al statului

- Status: Acceptată
- Data: 2026-08-08

## Context

Propunerea legislativă „privind registrul teritorial și de adresare al statului și utilizarea obligatorie a nomenclatoarelor oficiale în sistemele informatice ale administrației publice” (text integral, 39 pagini, citit 2026-08-08) consacră două registre corelate: registrul teritorial (deja implementat de Teritoriu.digital) și **registrul de adresare al statului** — nomenclator stradal, numere administrative, adrese, construit obligatoriu cu participarea primăriilor. Legea cere explicit ca acesta să fie construit **prin valorificarea/integrarea componentelor naționale existente**, nu de la zero (Cap. II-III).

ADR 0001 excludea inițial adresele din schema MVP („Limite”), iar `docs/law-alignment.md` (secțiunea „Separarea registrelor”) documenta deja acest raționament, plus o listă de neclarități instituționale nerezolvate — inclusiv raportul cu RENNS.

O verificare directă (căutare web, 2026-08-08) confirmă că acea componentă existentă are deja nume și temei: **RENNS — Registrul Electronic Național al Nomenclaturii Stradale**, înființat prin HG nr. 777/2016, administrat tehnic de ANCPI, alimentat obligatoriu de autoritățile administrației publice locale, cu un identificator unic per adresă (**CUA — Cod Unic de Adresă**) care leagă adresa de coordonate reale. Are portal public de consultare (`renns.ancpi.ro`) și o intrare în catalogul INSPIRE de metadate geospațiale (`geoportal.gov.ro`). Căutarea **nu** a confirmat existența unui API public sau a unui export în masă documentat — rămâne de verificat direct cu ANCPI (`renns@ancpi.ro`) sau prin endpointul INSPIRE, exact cum s-a procedat pentru sursele SIRUTA/ANCPI deja înregistrate (`docs/source-registry.md`).

Termenele din propunere (Cap. X, art. 93-101) sunt relevante doar dacă/când legea intră în vigoare; proiectul rămâne independent de statutul ei juridic, la fel ca până acum (`docs/law-alignment.md`).

## Decizie

Teritoriu.digital își extinde domeniul declarat pentru a acoperi și registrul de adresare, dar **nu** prin construirea unei baze proprii de adrese de la zero, în paralel cu RENNS. Extinderea reală constă în:

1. **Un context de schemă separat** pentru adresare (namespace/schemă distinctă de `registry`, urmând aceeași separare strictă control-intern/distribuție-publică din ADR 0001), care referă `territory_id` neechivoc, fără să duplice ierarhia teritorială deja modelată.
2. **CUA (identificatorul RENNS) ca identificator extern**, urmând exact modelul deja implementat pentru codul SIRUTA în `territory_identifiers` — emitent, tip, statut, perioadă de valabilitate — nu o coloană hardcodată nouă.
3. **Nicio ingestie de date reale înainte de verificarea directă și documentată a unui mecanism real de acces la datele RENNS** (API, export oficial sau feed INSPIRE), cu aceeași disciplină fail-closed folosită pentru toate sursele existente (`docs/source-registry.md`): nicio resursă nu e promovată doar pentru că un endpoint răspunde. Până la acea verificare, schema rămâne definită dar neingerată — nu se fabrică adrese, numere administrative sau străzi pentru a "umple" MVP-ul.
4. Teritoriu.digital **nu** se declară administratorul registrului de adresare. Rămâne, ca și pentru registrul teritorial, o implementare tehnică de referință — nu un temei juridic (`docs/law-alignment.md`, „Ce nu poate face singur”).

## Limite

- Nu vom duplica RENNS. Dacă ANCPI nu oferă acces programatic la date, Teritoriu.digital publică doar **contractul** (relația adresă ↔ `territory_id`, schema, identificatorii), fără date reale, etichetat explicit ca atare — nu un fallback tăcut.
- Nu colectăm adrese direct de la cetățeni sau primării; sursa oficială rămâne singura cale de intrare, la fel ca la SIRUTA/ANCPI.
- Granularitatea publicării (posibil fără numere administrative complete) rămâne deschisă până la o consultare de protecție a datelor — semnalat deja în `docs/law-alignment.md` (#5) și nerezolvat aici.
- Acest ADR **actualizează**, nu revocă, paragraful din „Limite” al ADR 0001: excluderea adreselor din schema inițială devine condiționată de existența unei surse reale verificate, nu mai este absolută.

## Consecințe

- `docs/roadmap.md` capătă un milestone nou (M13) pentru registrul de adresare, cu poarta explicită „nicio ingestie fără sursă RENNS verificată”.
- `README.md` (secțiunea „Domeniu”) trebuie rescrisă pentru a reflecta extinderea condiționată, nu excluderea absolută.
- Următorul pas tehnic real nu este o migrație de schemă, ci verificarea directă a accesului la date RENNS (contact ANCPI sau endpoint INSPIRE), documentată în `docs/source-registry.md` exact ca orice altă sursă — înainte de orice cod.
