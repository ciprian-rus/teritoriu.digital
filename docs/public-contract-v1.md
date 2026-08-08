# Contractul public v1

## Scop

Contractul `teritoriu.digital/siruta-release` permite unui consumator să importe un release teritorial fără acces la Supabase, la INS sau la un API disponibil în timp real. Consumatorul fixează `releaseId` și SHA-256 al manifestului, verifică întregul bundle în staging și schimbă read-model-ul activ numai după acceptarea completă.

Contractul public a început cu `contractVersion = 1.0.0`. Release-ul SIRUTA `2026.07.23.2` rămâne imuabil și nu este modificat retroactiv; primul release care conține toate activele contractului v1 va avea un identificator nou. Pipeline-ul permite acest release ulterior numai după recanonicalizare și aprobare distincte, dacă `candidateSha256` rămâne identic cu `stable`.

De la `contractVersion = 1.1.0`, contractul admite opțional geometriile teritoriale (M6) ca artefact aditiv — vezi „Geometrii teritoriale (opțional)" mai jos. Un release fără geometrii disponibile rămâne complet valid: `contractVersion` crește pentru că *schema* contractului permite acum un activ opțional, nu pentru că fiecare release trebuie să-l includă.

De la `contractVersion = 1.2.0`, `properties.geometryKind` admite aditiv valoarea `source_corrected` — o corecție tehnică de validitate (`ST_MakeValid`) peste o geometrie `source` publicată invalid de ANCPI. Nu înlocuiește rândul `source` original; ambele rămân în `territory-geometries.geojson`, ca `Feature`-uri distincte pentru același `territoryId`.

## Bundle obligatoriu

| Fișier | Rol |
|---|---|
| `SHA256SUMS` | acoperă toate celelalte fișiere, fără auto-referință |
| `contract.json` | descriptor machine-readable, versiune și politică de compatibilitate |
| `contract.schema.json` | JSON Schema pentru descriptor |
| `manifest.json` | proveniență, aprobare, numărători, calitate și hashuri |
| `release-manifest.schema.json` | JSON Schema pentru manifest |
| `territories.json` | payload complet, cu metadatele release-ului |
| `territories.schema.json` | JSON Schema pentru payload |
| `territory.schema.json` | JSON Schema pentru o unitate teritorială |
| `territories.ndjson` | câte o unitate canonică pe linie, pentru import streaming |
| `territories.csv` | proiecție tabelară UTF-8 |
| `territory-identifiers.csv` | toate asocierile `territory_id ↔ identificator`, inclusiv starea și valabilitatea |
| `validation-report.json` | validările și avertismentele release-ului |
| `changelog.json` | diff-ul machine-readable față de release-ul anterior |

Manifestul conține hashul și dimensiunea fiecărui activ non-circular. `SHA256SUMS` include și manifestul, descriptorul și schemele. NDJSON și tabelul identificatorilor sunt regenerate de verificator din `territories.json` și trebuie să coincidă byte-for-byte.

## Geometrii teritoriale (opțional)

Dacă release-ul include geometrii (M6), bundle-ul conține și:

| Fișier | Rol |
|---|---|
| `territory-geometries.geojson` | `FeatureCollection` GeoJSON, cel puțin un `Feature` per teritoriu cu geometrie disponibilă |
| `territory-geometries.schema.json` | JSON Schema pentru `territory-geometries.geojson` |

Fiecare `Feature` are `properties.territoryId` egal cu un `territoryId` din `territories.json` al aceluiași release — un consumator respinge fail-closed orice geometrie care ar referi un teritoriu din afara release-ului. `properties.geometryKind` (`source`/`derived`/`simplified`/`source_corrected`) și `properties.detailLevel` (`original`/`high`/`medium`/`low`) descriu proveniența și nivelul de detaliu; `properties.sourceSnapshotId` leagă geometria de snapshotul ANCPI din care provine. Licența (`license`, la nivelul întregului `FeatureCollection`) e declarată separat de `manifest.license` (SIRUTA), pentru că sursa e alta (ANCPI RELUAT), chiar dacă ambele sunt `CC BY 4.0`.

Un `territoryId` poate apărea în mai mult de un `Feature`: dacă geometria `source` publicată de ANCPI e invalidă geometric, un `Feature` suplimentar cu `geometryKind = source_corrected` conține corecția tehnică (`ST_MakeValid`), fără să înlocuiască originalul. Un consumator care are nevoie de exact o geometrie per teritoriu preferă `source_corrected` peste `source` pentru același `territoryId`; altfel primește ambele și alege proveniența care îi convine.

Ambele fișiere sunt declarate în `contract.json` cu `required: false` — un release fără geometrii disponibile pur și simplu nu le declară și nu le include; nu e o valoare lipsă sau un placeholder gol.

## Identitate și ierarhie

- `territoryId` este UUIDv7 persistent și nu este derivat din denumire sau SIRUTA.
- Orice unitate are exact un cod activ `ro.ins.siruta` în contractul SIRUTA curent.
- Un identificator oficial nu poate aparține simultan mai multor teritorii.
- `parentTerritoryId` și `countyTerritoryId`, când sunt prezente, trebuie să existe în același release.
- Ierarhia `parentTerritoryId` nu admite auto-referințe sau cicluri.
- Identificatorii istorici ori provizorii rămân rânduri distincte în `territory-identifiers.csv`, cu stare și interval de valabilitate.

## Compatibilitate

Versiunile contractului și ale schemei folosesc Semantic Versioning:

- `1.x.y` este acceptat de un consumator v1;
- o versiune minoră poate adăuga numai câmpuri sau active opționale, declarate de schemele incluse în bundle;
- o versiune patch poate corecta numai formulări ori constrângeri fără schimbare semantică;
- eliminarea unui câmp, schimbarea sensului sau a tipului, redenumirea ori relaxarea unei garanții de identitate necesită un nou major;
- consumatorul validează câmpurile necunoscute față de schema inclusă și nu le transformă automat în date canonice proprii;
- un major necunoscut este respins înainte de staging.

Versiunea schemei datelor este distinctă de `contractVersion`. Schimbarea pipeline-ului ori a sursei nu schimbă automat niciuna dintre ele.

## Algoritmul consumatorului

1. Descarcă un tag explicit, niciodată `latest`.
2. Verifică SHA-256 fixat al `manifest.json`.
3. Verifică toate intrările din `SHA256SUMS` și setul exact de fișiere.
4. Compilează schemele incluse și validează descriptorul, manifestul și payloadul.
5. Verifică versiunea majoră, proveniența și concordanța metadatelor.
6. Verifică unicitatea identităților și identificatorilor, părinții și ciclurile.
7. Compară NDJSON și mappingul de identificatori cu payloadul JSON.
8. Construiește stagingul și raportul `accepted / rejected / conflicts`.
9. Activează atomic noul read-model și păstrează ca rollback ultima versiune validă.

Un eșec la orice pas lasă read-model-ul activ neatins.

## Verificator reutilizabil

Din repository:

```bash
npm run contract:verify -- \
  --bundle-dir /cale/catre/bundle \
  --release-id 2026.07.23.3 \
  --manifest-sha256 <sha256>
```

API-ul ESM este exportat din `packages/consumer/src/index.mjs`:

- `verifyConsumerRelease(bundle, pins)`;
- `importReleaseReadModel(bundle, currentModel, pins)`;
- `activeReleaseMetadata(model)`;
- `assertConsumerCompatibility(contract, manifest)`.

Raportul de succes conține `status = accepted`, numărătorile `accepted`, `rejected`, `conflicts`, `releaseId`, `manifestSha256`, `contractVersion` și `schemaVersion`. O respingere aruncă o eroare cu același raport în `error.report`.

## Fixture și probe

Testul contractului include explicit:

- județ;
- municipiu;
- oraș;
- comună;
- sector;
- localitate componentă.

Suita injectează separat checksum greșit, release/hash nefixat, major incompatibil, identitate duplicată, părinte inexistent și ciclu ierarhic. Toate sunt respinse fail-closed înaintea activării.
