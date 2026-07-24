# Alinierea cu propunerea legislativă

Document de arhitectură, nu opinie juridică. Referințele privesc forma analizată la 22 iulie 2026 a propunerii „privind registrul teritorial și de adresare al statului și utilizarea obligatorie a nomenclatoarelor oficiale în sistemele informatice ale administrației publice”.

## Ce poate demonstra Teritoriu.digital

| Cerință din proiect | Articole relevante | Capacitate Teritoriu.digital |
|---|---|---|
| Identificator, denumire, tip, apartenență, stare și istoric | 9–14 | model canonic cu identitate persistentă, revizii bitemporale, identificatori, nume și relații |
| Versiune curentă, istoric, dată de aplicare și specificații | 15, 30–33 | candidați controlați, release-uri imuabile, manifest, JSON Schema, changelog și reconstituire temporală |
| Interogare, descărcare și integrare automatizată | 15, 26, 32 | API versionat și artefacte complete importabile local |
| Notificarea actualizărilor | 34, 44 | feed de release-uri, manifest diff și notificări către consumatori |
| Validări, completitudine, duplicate și consistență | 35–36 | reguli versionate, findings cu severitate și praguri fail-closed |
| Maparea datelor istorice și instrumente reutilizabile | 43, 55, 57 | tabele de corespondență, validatoare, fixtures și pachete de import |
| Corelarea cu alte registre | 28, 63, 67–68 | identificatori multipli, relații explicite și contracte machine-readable |
| Sesizare, verificare, remediere și propagare | 85–92 | flux de sesizări, decizie motivată, audit, release corectiv și diff |
| Tablou de bord al conformării | 62 | model ulterior de raportare a versiunii active și a gradului de adoptare |

Teritoriu.digital poate deveni o implementare de referință și o probă tehnică pentru normele metodologice: model de date, reguli de validare, formate, istoric, procedură de promovare, validatoare și exemple de integrare.

## Ce nu poate face singur

- Nu poate deveni „registrul oficial al statului” fără temei juridic și desemnarea administratorului competent.
- Nu poate decide efecte juridice, denumiri sau limite în contradicție cu autoritatea competentă.
- Nu poate transforma o normalizare tehnică într-o corecție a sursei oficiale.
- Nu poate obliga instituțiile să adopte identificatorii sau să se sincronizeze.
- Nu substituie Platforma națională de interoperabilitate.

## Separarea registrelor

Propunerea consacră două registre corelate, nu unul singur. Teritoriu.digital implementează acum nucleul teritorial. Un registru de adresare viitor trebuie să fie un context separat, cu propriul administrator, flux local de actualizare, reguli de minimizare a datelor și identificatori de adresă, dar fiecare adresă va referi neechivoc `territory_id`.

Această delimitare evită extinderea prematură a MVP-ului la milioane de adrese și păstrează compatibilitatea cu infrastructura RENNS existentă.

## Clarificări instituționale necesare înainte de un statut oficial

1. Desemnarea explicită a administratorului registrului teritorial și raportul său cu INS/SIRUTA, ANCPI și actele de organizare teritorială.
2. Raportul registrului de adresare propus cu RENNS, deja reglementat și administrat tehnic de ANCPI.
3. Regula de atribuire și guvernanță a „identificatorului oficial unic”, inclusiv continuitatea la reorganizare.
4. Ierarhia probatorie a surselor atunci când codul statistic, actul juridic și geometria cadastrală nu coincid.
5. Granularitatea publicării datelor de adresă și garanțiile concrete de protecție a datelor.
6. Autoritatea care aprobă o corecție și mecanismul de contestare a soluției.

## Proprietari instituționali propuși și opțiuni de soluție

Tabelul de mai jos propune, pentru fiecare neclaritate de mai sus, un posibil proprietar instituțional și opțiuni de soluție cu compromisurile lor. **Nu este o poziție juridică definitivă** — sunt puncte de plecare pentru o discuție instituțională reală, care necesită validare de specialiști juridici și de instituțiile menționate înainte de a fi adoptate.

| # | Neclaritate | Proprietar instituțional propus | Opțiuni de soluție |
|---|---|---|---|
| 1 | Administrator registru teritorial | Guvernul României / MDLPA, eventual în comun cu INS | (a) desemnare explicită prin act normativ a unei instituții existente (ex. INS, ca extensie a rolului SIRUTA); (b) structură interinstituțională (INS + ANCPI + MDLPA) cu roluri separate explicit; (c) Teritoriu.digital rămâne implementare de referință neoficială până la desemnare — risc: ambiguitate prelungită |
| 2 | Raportul cu RENNS | ANCPI (administrator RENNS) + autoritatea registrului de adresare | (a) registrul de adresare devine strat suplimentar peste RENNS, ANCPI administrator unic, Teritoriu.digital furnizează doar `territory_id`; (b) registre distincte dar interoperabile prin contract public (arhitectura curentă); (c) migrare RENNS către noua bază legală, cu ANCPI păstrând rolul tehnic |
| 3 | Guvernanța identificatorului oficial unic | Administratorul de la #1, cu aviz INS pentru continuitate statistică | (a) identificator persistent unic, alocat o singură dată, indiferent de reorganizări — ce implementează deja `territory_id` UUIDv7; (b) realocare la reorganizări majore, cu tabel de corespondență istoric — mai aproape de practica SIRUTA actuală; (c) model hibrid: identificator tehnic persistent + cod oficial mutabil, mapate explicit (starea curentă) |
| 4 | Ierarhia probatorie a surselor | Comisie mixtă INS–ANCPI–MDLPA sau administratorul de la #1 | (a) actul juridic de organizare teritorială primează întotdeauna; (b) fiecare sursă rămâne autoritativă în domeniul propriu (INS: cod, ANCPI: geometrie, act juridic: statut/nume), discrepanțele devin findings auditabile — modelul curent; (c) prioritate contextuală documentată explicit per câmp |
| 5 | Granularitate adrese și protecția datelor | ANCPI/autoritatea registrului de adresare + ANSPDCP pentru avizare | (a) publicare completă ca date administrative deschise, fără atribute personale; (b) agregare la nivel de stradă/localitate, numere administrative doar prin API controlat pentru instituții; (c) consultare ANSPDCP înainte de MVP-ul registrului de adresare |
| 6 | Aprobare corecție și contestare | Administratorul de la #1, cu escaladare către instituția sursă (INS/ANCPI) | (a) corecții tehnice aprobate de custodele tehnic, fără contestare — deja implementat în `docs/governance/roles-and-promotion.md`; (b) corecții de fond necesită aviz al instituției sursă înainte de promovare, contestabile direct la acea instituție; (c) sesizare publică internă (deja documentată) + escaladare instituțională explicită peste pragul unei normalizări tehnice |

Până la aceste clarificări, produsul va eticheta distinct valoarea sursă, normalizarea derivată, decizia tehnică și orice element care necesită confirmare oficială.

