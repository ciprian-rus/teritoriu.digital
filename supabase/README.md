# Supabase control plane

Directorul conține schema internă PostgreSQL/PostGIS și testele bazei de date pentru Teritoriu.digital.

## Deploy

- Migrațiile versionate din `migrations/` sunt sursa de adevăr pentru structură.
- Integrarea GitHub Supabase validează modificările într-un Preview Branch și aplică migrațiile pe proiectul de producție numai după merge în `main`.
- Secretele, parolele bazei și cheile privilegiate nu se păstrează în repository.
- Fișierele de seed nu conțin date de producție și nu sunt promovate automat.

## Verificare

```bash
supabase db start
supabase test db
supabase db lint --level warning
```

Schema operațională `registry` nu este expusă prin Data API. Distribuția publică va folosi numai date promovate și artefacte de release verificabile.
