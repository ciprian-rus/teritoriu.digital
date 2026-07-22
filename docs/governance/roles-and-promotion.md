# Roluri și promovarea release-urilor

## Roluri

| Rol | Responsabilitate | Nu poate face singur |
|---|---|---|
| Data Owner | aprobă scopul, politica de date și publicarea | modifica un release publicat |
| Data Steward | interpretează sursele, validează mapările și soluționează ambiguitățile | declara o corecție drept oficială fără temei |
| Custode tehnic | operează pipeline-ul, baza, backupul și artefactele | aproba propria excepție de calitate |
| Reviewer de release | verifică raportul, diff-ul, proveniența și pragurile | ocoli findings blocante fără decizie documentată |
| Consumer owner | testează importul și raportează versiunea activă | citi direct staging-ul sau cheia secretă |

Aceeași persoană poate îndeplini temporar mai multe roluri în faza de prototip, dar sistemul păstrează acțiunile și motivările separat.

Workflow-urile care folosesc acces privilegiat rulează numai din `main` prin environment-ul GitHub `production`. Secretele Supabase sunt stocate în acel environment, nu la nivelul repository-ului, iar un reviewer obligatoriu aprobă accesul. Instalarea, testele și dry-run-urile nu primesc secrete. Ideal, persoana care declanșează publicarea și persoana care aprobă environment-ul sunt diferite; în faza de prototip, excepția temporară se consemnează în audit.

## Porți de promovare

1. Snapshotul este arhivat și SHA-256 este verificat.
2. Parserul recunoaște schema așteptată și păstrează înregistrarea brută.
3. Validările structurale, de unicitate, ierarhie, volum și geometrie sunt complete.
4. Diff-ul față de release-ul stabil este clasificat.
5. Orice schimbare suspectă are o decizie motivată.
6. Candidatul este aprobat de un reviewer.
7. Artefactele sunt generate determinist și validate față de scheme.
8. Manifestul și checksumurile sunt verificate din nou după upload.
9. Release-ul devine imuabil.
10. Canalul `stable` este actualizat numai după un smoke test de descărcare/import.

Findings cu severitate `error` sau `blocker` opresc promovarea. O excepție este un obiect auditabil, limitat la o regulă, un candidat și o justificare; nu reduce global validarea.

## Corecții

O sesizare primește referință publică, categorie, entitatea afectată și stare. Verificarea păstrează sursele consultate și soluția motivată. O corecție acceptată creează o revizie și un release nou; respingerea păstrează motivarea. Datele de contact ale petentului nu fac parte din contractul public al registrului.

## Incident și rollback

La un incident de date, canalul `stable` poate fi mutat la ultimul release cunoscut ca valid. Release-ul problematic rămâne în istoric, este marcat în comunicarea incidentului, iar remedierea produce o versiune nouă. Restaurarea bazei de control nu este mecanismul normal de rollback public.
