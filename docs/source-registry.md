# Registrul inițial al surselor

Stare de discovery la 22 iulie 2026. Nicio resursă nu este promovată doar pentru că endpointul răspunde; pipeline-ul reverifică hostul, redirecturile, tipul real, mărimea și checksumul la fiecare snapshot.

## INS — SIRUTA, an de referință 2025

- Instituție: Institutul Național de Statistică
- Rol: sursă autoritativă pentru clasificarea și codurile SIRUTA; nu este tratată automat ca sursă juridică pentru orice limită geografică
- Dataset: <https://data.gov.ro/dataset/siruta_an-2025>
- Licență declarată: CC BY 4.0
- Frecvență descrisă în metodologie: semestrială
- Format declarat: CSV; fișierul observat are semnătură XLSX și trebuie detectat după conținut
- Checksum al fișierului observat: `a073cd565f1c2be2de3fb59f4f131dfae8f0c3ecc858610206927fba89469a41`
- Mărime observată: 1.158.236 bytes
- Structură observată: 16.978 înregistrări și 12 coloane

Rezultate calculate din snapshotul observat:

| Nivel SIRUTA | Înregistrări |
|---|---:|
| județe/București | 42 |
| UAT-uri | 3.181 |
| localități | 13.755 |

Limitări și atenționări:

- 215 valori NUTS sunt goale; contextul NUTS se moștenește numai printr-o regulă documentată, nu prin completarea sursei.
- Verificarea literală a cifrei de control semnalează 77 de coduri; acestea rămân valori oficiale și sunt raportate ca avertismente până la clarificarea metodologiei, nu „corectate” automat.
- Câmpul hash al resursei CKAN este gol; Teritoriu.digital calculează și publică propriul SHA-256.
- Când sursa nu răspunde, execuția eșuează închis și release-ul stabil rămâne neschimbat.

## ANCPI — Unități administrative

- Instituție: Agenția Națională de Cadastru și Publicitate Imobiliară
- Rol: sursă oficială complementară pentru geometrii administrative
- Serviciu: <https://services-eu1.arcgis.com/tt6hwS9xmcvnRjQC/arcgis/rest/services/AU_Unit%C4%83%C8%9Bi_administrative/FeatureServer>
- Licență declarată: CC BY 4.0
- Format accesibil: ArcGIS Feature Service / GeoJSON
- CRS sursă declarat: `Romania_double_stereo`; distribuția web va păstra proveniența și va transforma controlat în EPSG:4326

Discovery-ul inițial a identificat 3.186 geometrii cu coduri regăsite în SIRUTA: 3.180 UAT-uri plus cele 6 sectoare. Codul SIRUTA al municipiului București nu are o geometrie directă în stratul observat. Unirea sectoarelor poate produce o geometrie derivată, marcată explicit ca atare; nu este prezentată drept geometrie furnizată direct de ANCPI.

## Surse viitoare

Eurostat/GISCO, actele normative și alte nomenclatoare se adaugă numai după documentarea instituției, rolului, licenței, frecvenței, identificatorilor, limitărilor și regulilor de transformare.

