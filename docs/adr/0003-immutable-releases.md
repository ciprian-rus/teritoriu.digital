# ADR 0003: Release-uri publice imuabile

- Status: Acceptată
- Data: 2026-07-22

## Decizie

Un release trece prin stările `draft`, `approved`, `published` sau `rejected`. Numai un candidat cu toate validările blocante trecute și cu aprobare explicită poate deveni `published`.

Identificatorul release-ului folosește forma `YYYY.MM.DD.N`, iar contractul de date are o versiune semantică separată, de exemplu `1.0.0`. Repetarea publicării în aceeași zi incrementează `N`; o modificare incompatibilă schimbă versiunea majoră a schemei.

Release-ul include cel puțin:

- manifest JSON conform JSON Schema;
- snapshoturile sursă și checksumurile lor;
- JSON și CSV UTF-8;
- raport de validare;
- diff față de release-ul anterior;
- SHA-256 pentru fiecare artefact;
- commitul pipeline-ului și proveniența transformărilor.

GeoJSON, TopoJSON, Parquet și SQL seed se adaugă atunci când modelul și geometriile sunt validate.

După publicare, rândul release-ului și artefactele sale nu pot fi actualizate sau șterse. Corecțiile produc un release nou. `release_channels` păstrează separat pointerul `stable`, astfel încât rollback-ul să însemne schimbarea pointerului, nu mutarea datelor istorice.

## Publicare

Artefactele vor fi atașate unui GitHub Release configurat imuabil sau unui depozit de obiecte cu retenție echivalentă. Baza de date păstrează doar metadatele și URI-urile verificate; disponibilitatea publică nu se bazează exclusiv pe rândurile Supabase.

## Consecințe

- Orice versiune consumată poate fi reprodusă și verificată.
- Erorile publicate rămân vizibile în istoric și sunt corectate transparent.
- Promovarea și rollback-ul trebuie testate înaintea primei versiuni stabile.

