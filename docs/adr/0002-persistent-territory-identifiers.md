# ADR 0002: Identificatori teritoriali persistenți UUIDv7

- Status: Acceptată
- Data: 2026-07-22

## Context

Numele, codurile SIRUTA și structura administrativă se pot schimba. Niciunul nu este o bază sigură pentru identitatea internă folosită transversal de aplicațiile consumatoare.

## Decizie

`territory_id` este un UUIDv7 generat de pipeline numai după ce reconcilierea stabilește că înregistrarea sursă nu corespunde unei identități existente. Valoarea:

- nu se derivă din nume, ierarhie sau cod SIRUTA;
- nu se reutilizează după desființarea unei entități;
- rămâne aceeași la redenumire sau la modificarea metadatelor;
- se păstrează pentru entitățile inactive;
- se distribuie tuturor consumatorilor.

Codul SIRUTA și orice viitor identificator juridic oficial sunt înregistrări în `territory_identifiers`, cu emitent, tip, statut, sursă și perioadă de valabilitate. Dacă statul adoptă ulterior un identificator oficial diferit, acesta se mapează la `territory_id`; nu rescriem identitățile deja distribuite.

Divizările, comasările și reorganizările nu transferă automat identitatea. Entitățile rezultate primesc identități distincte, iar continuitatea se exprimă prin relații `predecessor_of` și `successor_of`, bazate pe actul juridic sau sursa competentă.

## Control

Domeniul PostgreSQL `registry.uuid_v7` validează versiunea UUID. Deciziile de potrivire sunt auditate în `identity_decisions`; potrivirile ambigue blochează promovarea automată.

## Consecințe

- Consumatorii pot păstra referințe stabile peste schimbări de nume și cod.
- Importul trebuie să aibă o etapă explicită de reconciliere, nu doar `upsert` după SIRUTA.
- Corectarea unei potriviri greșite necesită o decizie auditabilă și un release nou, niciodată editarea retroactivă a unui release publicat.

