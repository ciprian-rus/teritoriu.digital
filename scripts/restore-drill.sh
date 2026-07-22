#!/usr/bin/env bash
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_teritoriu-digital}"
restore_database="teritoriu_restore_drill"
schema_dump="$(mktemp /tmp/teritoriu-registry-schema.XXXXXX.sql)"
data_dump="$(mktemp /tmp/teritoriu-registry-data.XXXXXX.sql)"

cleanup() {
  docker exec "${container}" dropdb --username postgres --if-exists "${restore_database}" >/dev/null 2>&1 || true
  rm -f "${schema_dump}" "${data_dump}"
}
trap cleanup EXIT

docker inspect "${container}" >/dev/null

docker exec "${container}" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 --command "
  insert into registry.data_sources (
    source_id, slug, publisher, title, official_url, authority_role
  ) values (
    '01983d9e-4b00-7abc-8def-1234567890ab',
    'restore.drill',
    'Teritoriu.digital',
    'Restore drill sentinel',
    'https://teritoriu.digital/',
    'complementary'
  ) on conflict (slug) do nothing;
" >/dev/null

supabase db dump --local --schema registry --file "${schema_dump}"
supabase db dump --local --data-only --use-copy --schema registry --file "${data_dump}"

expected_tables="$(docker exec "${container}" psql --username postgres --dbname postgres --tuples-only --no-align --command "
  select count(*) from information_schema.tables where table_schema = 'registry';
")"

docker exec "${container}" dropdb --username postgres --if-exists "${restore_database}" >/dev/null
docker exec "${container}" createdb --username postgres --template template0 "${restore_database}"
docker exec "${container}" psql --username postgres --dbname "${restore_database}" --set ON_ERROR_STOP=1 --command "
  create schema if not exists gis;
  create extension if not exists postgis with schema gis;
" >/dev/null

docker exec --interactive "${container}" psql --username postgres --dbname "${restore_database}" --set ON_ERROR_STOP=1 < "${schema_dump}" >/dev/null
docker exec --interactive "${container}" psql --username postgres --dbname "${restore_database}" --set ON_ERROR_STOP=1 < "${data_dump}" >/dev/null

actual_tables="$(docker exec "${container}" psql --username postgres --dbname "${restore_database}" --tuples-only --no-align --command "
  select count(*) from information_schema.tables where table_schema = 'registry';
")"
sentinel_count="$(docker exec "${container}" psql --username postgres --dbname "${restore_database}" --tuples-only --no-align --command "
  select count(*) from registry.data_sources where slug = 'restore.drill';
")"

if [[ "${actual_tables}" != "${expected_tables}" ]]; then
  echo "Restore drill failed: registry table count differs" >&2
  exit 1
fi
if [[ "${sentinel_count}" != "1" ]]; then
  echo "Restore drill failed: sentinel was not restored" >&2
  exit 1
fi

echo "Restore drill passed (${actual_tables} registry tables, sentinel restored)."
