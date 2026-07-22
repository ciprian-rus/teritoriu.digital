# Contractul canonic de date

## Identitate și revizie

`territories` este registrul identităților persistente. Câmpurile descriptive nu se suprascriu aici; fiecare stare cunoscută este o înregistrare în `territory_revisions`.

O revizie conține cel puțin:

- `territory_id` UUIDv7;
- denumirea oficială și forma normalizată pentru căutare;
- tipul, rolul și nivelul administrativ;
- părintele și județul, când sunt aplicabile;
- indicatorii UAT/localitate/reședință;
- statutul;
- intervalul de valabilitate și intervalul de înregistrare;
- snapshotul sursă și hashul înregistrării.

SIRUTA nu este cheia primară. Este un identificator cu `scheme = ro.ins.siruta`, legat de emitent, sursă și perioadă de valabilitate.

## Tipuri teritoriale inițiale

Lista de pornire este controlată de pipeline și documentată în release: `country`, `macroregion`, `development_region`, `county`, `bucharest`, `sector`, `municipality`, `city`, `commune`, `component_locality`, `village` și `other`.

Valorile sursă se păstrează separat. O mapare la tipul canonic este o transformare versionată și testată.

`administrative_role` separă explicit `county_uat`, `local_uat`, `administrative_subdivision` și `locality`. Astfel, un sector, un sat și o comună nu sunt confundate doar pentru că apar în aceeași ierarhie. Valorile suplimentare admise de contract sunt `country` și `statistical_region`.

Pentru o identitate nouă, reconcilierea generează o singură propunere UUIDv7 în `identity_decisions.proposed_territory_id`. Propunerea nu devine rând în `territories` înaintea aprobării candidatului. Rulările ulterioare reutilizează propunerea aprobată pentru review, astfel încât reluarea pipeline-ului nu schimbă identitatea.

## Relații

Ierarhia curentă poate folosi `parent_territory_id`. Relațiile care nu sunt strict ierarhice sau care descriu continuitate se păstrează în `territory_relations`, de exemplu:

- `predecessor_of` / `successor_of`;
- `seat_of`;
- `part_of` pentru o relație istorică sau alternativă;
- `geometry_represents` pentru geometrii derivate, dacă este necesar.

Relațiile au sursă și interval de valabilitate. Ciclurile ierarhice sunt erori blocante.

## Geometrii

Geometria canonică de distribuție folosește WGS84 (`EPSG:4326`). Se păstrează și CRS-ul sursă, licența, checksumul, nivelul de simplificare, snapshotul și transformarea aplicată. Geometria originală nu este înlocuită de versiunea simplificată.

O geometrie derivată, precum conturul municipiului București obținut prin unirea sectoarelor, este etichetată explicit `derived`, cu metoda și intrările sale. Nu este atribuită fals sursei ca înregistrare directă.

## Baza de control versus contractul public

Schema SQL este normalizată pentru administrare și audit. Contractul public este o proiecție stabilă, definită prin JSON Schema, care include doar date promovate. Câmpurile operaționale, sesizările, actorii și notele de review nu ajung automat în release.

Orice câmp public indică release-ul și proveniența. Câmpurile noi compatibile schimbă versiunea minoră a schemei; eliminarea sau schimbarea semanticii unui câmp schimbă versiunea majoră.
