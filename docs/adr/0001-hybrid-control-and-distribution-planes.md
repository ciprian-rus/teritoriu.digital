# ADR 0001: Plan de control relațional și plan de distribuție imuabil

- Status: Acceptată
- Data: 2026-07-22

## Context

Modelul inițial putea funcționa numai cu fișiere versionate. Forma actuală a propunerii legislative cere însă mai mult decât publicarea unui nomenclator: istoric reconstituibil, date de intrare în vigoare și de operare, corelări între registre, mecanisme permanente de sesizare și remediere, notificarea actualizărilor, audit și măsurarea calității.

Aceste fluxuri sunt tranzacționale și presupun relații, stări intermediare, decizii umane și interogări geospațiale. În același timp, consumatorii nu trebuie să depindă în timp real de disponibilitatea Teritoriu.digital.

## Decizie

Vom utiliza un proiect Supabase dedicat `teritoriu-digital`, cu PostgreSQL și PostGIS, drept plan intern de control. Acesta va păstra snapshoturile și metadatele lor, staging-ul, identitățile persistente, reviziile, geometriile, validările, deciziile de reconciliere, sesizările și candidații de release.

Planul public de distribuție rămâne format din release-uri imuabile. Fiecare release va avea manifest, versiune de schemă, proveniență, raport de validare, changelog și checksumuri SHA-256. Un pointer separat indică release-ul activ și permite rollback fără modificarea release-ului.

Schema operațională `registry` nu este expusă în Data API. Operațiile privilegiate folosesc o cheie secretă numai în pipeline-uri server-side. Accesul public va fi construit peste date deja promovate, cu cache și artefacte descărcabile.

Aplicațiile consumatoare importă o versiune explicită în propriul read-model. Nu li se cere acces direct la Supabase și nu împart baza de date Teritoriu.digital.

## Limite

MVP-ul acoperă registrul teritorial. Registrul de adresare este un context separat care va referi `territory_id`, dar străzile, numerele administrative și adresele nu intră în această schemă inițială.

Supabase nu conferă statut juridic datelor și nu înlocuiește desemnarea prin lege sau hotărâre a administratorului unui registru oficial.

## Consecințe

- Putem implementa review, corecții, bitemporalitate și PostGIS fără a compromite reziliența consumatorilor.
- Sunt necesare backup, restaurare testată, migrații versionate și separarea strictă a cheilor.
- Publicarea presupune o promovare explicită din planul de control în planul de distribuție.
- Costul și operarea Supabase devin parte din responsabilitățile proiectului, dar nu din disponibilitatea runtime a consumatorilor.

