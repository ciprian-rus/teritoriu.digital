#!/usr/bin/env bash
set -euo pipefail

# Restores a real (not fabricated) snapshot of the production `registry`
# schema into the local, throwaway Supabase instance already started by
# `supabase db start` (see .github/workflows/production-restore-drill.yml)
# and verifies it. Requires SUPABASE_DB_URL (production) in the environment.
#
# Only ever reads from production: `pg_dump` cannot write. Everything this
# script writes to goes into the local container, which is destroyed when
# the CI job ends — nothing here ever touches the production database.
#
# Scope: `registry` schema rows only. Storage bucket bytes (the actual
# archived SIRUTA/ANCPI files, referenced by hash from `source_snapshots`)
# are covered separately by Supabase's own managed backups, not by this
# script — see docs/runbooks/backup-restore.md.

container="${SUPABASE_DB_CONTAINER:-supabase_db_teritoriu-digital}"
data_dump="$(mktemp /tmp/teritoriu-production-registry-data.XXXXXX.sql)"

cleanup() {
  rm -f "${data_dump}"
}
trap cleanup EXIT

docker inspect "${container}" >/dev/null

echo "Dumping real registry data from production (read-only)..."
# --disable-triggers: registry.release_artifacts carries a BEFORE INSERT
# trigger (published_artifacts_immutable) that rejects inserts for any
# release already `published` — true for real production data by design
# (ADR 0003). Restoring real rows via a plain data-only dump would fire
# that trigger on COPY and abort the drill before it reaches the
# verification step below. Safe to suppress here: this is a fresh restore
# into an empty local schema, not a live table an application is writing
# to concurrently.
pg_dump "${SUPABASE_DB_URL}" \
  --schema=registry \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  --file="${data_dump}"

echo "Restoring into the local, throwaway Supabase instance..."
docker exec --interactive "${container}" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 < "${data_dump}" >/dev/null

echo "Verifying table counts against production..."
tables="$(docker exec "${container}" psql --username postgres --dbname postgres --tuples-only --no-align --command "
  select relname from pg_class where relkind = 'r' and relnamespace = 'registry'::regnamespace order by relname;
")"

mismatch=0
for table in ${tables}; do
  production_count="$(psql "${SUPABASE_DB_URL}" --tuples-only --no-align --command "select count(*) from registry.${table};")"
  local_count="$(docker exec "${container}" psql --username postgres --dbname postgres --tuples-only --no-align --command "select count(*) from registry.${table};")"
  if [[ "${production_count}" != "${local_count}" ]]; then
    echo "MISMATCH registry.${table}: production=${production_count} restored=${local_count}" >&2
    mismatch=1
  else
    echo "OK registry.${table}: ${local_count} rows match production"
  fi
done

echo "Verifying PostGIS functions on real restored geometry..."
invalid_geometries="$(docker exec "${container}" psql --username postgres --dbname postgres --tuples-only --no-align --command "
  select count(*) from registry.territory_geometries where not gis.ST_IsValid(geometry);
")"
if [[ "${invalid_geometries}" != "0" ]]; then
  echo "MISMATCH: ${invalid_geometries} invalid restored geometries" >&2
  mismatch=1
else
  echo "OK: all restored geometries pass gis.ST_IsValid"
fi

sample_geometry_check="$(docker exec "${container}" psql --username postgres --dbname postgres --tuples-only --no-align --command "
  select count(*) from registry.territory_geometries where gis.ST_Area(geometry) <= 0;
")"
if [[ "${sample_geometry_check}" != "0" ]]; then
  echo "MISMATCH: ${sample_geometry_check} restored geometries with non-positive area" >&2
  mismatch=1
else
  echo "OK: gis.ST_Area computes a positive area for every restored geometry"
fi

if [[ "${mismatch}" == "1" ]]; then
  echo "Production restore drill FAILED" >&2
  exit 1
fi

echo "Production restore drill passed: real production data restored into an isolated, throwaway instance and verified (row counts, PostGIS validity and spatial functions)."
