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
pg_dump "${SUPABASE_DB_URL}" \
  --schema=registry \
  --data-only \
  --no-owner \
  --no-privileges \
  --file="${data_dump}"

# Three application-level guard triggers would otherwise fire during the
# restore COPY and either reject it outright or make it impractically slow:
#   - release_artifacts.published_artifacts_immutable (BEFORE INSERT) rejects
#     any row whose release is already `published` — true for real production
#     data by design (ADR 0003).
#   - release_channels.release_channels_guard (BEFORE INSERT) re-validates
#     the referenced release's status per row.
#   - identity_decisions.identity_decisions_proposal_reuse_guard (BEFORE
#     INSERT) takes an advisory lock and scans the whole table per row —
#     fine for one live write, not for reloading ~85k historical rows.
# `pg_dump --disable-triggers` was tried first and rejected: it emits
# ALTER TABLE ... DISABLE TRIGGER ALL, which also touches the RI system
# triggers that implement foreign keys — disabling those requires real
# superuser, which Supabase deliberately doesn't grant even in local dev
# (mirrors the hosted platform). Disabling these three named triggers by
# name only needs table ownership, which the restoring role already has.
# Foreign keys stay enforced throughout; the data is expected to already
# satisfy them since it came from production.
echo "Disabling guard triggers for the bulk restore (table-owner privilege, not superuser)..."
docker exec "${container}" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 --command "
  alter table registry.release_artifacts disable trigger published_artifacts_immutable;
  alter table registry.release_channels disable trigger release_channels_guard;
  alter table registry.identity_decisions disable trigger identity_decisions_proposal_reuse_guard;
" >/dev/null

reenable_guard_triggers() {
  docker exec "${container}" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 --command "
    alter table registry.release_artifacts enable trigger published_artifacts_immutable;
    alter table registry.release_channels enable trigger release_channels_guard;
    alter table registry.identity_decisions enable trigger identity_decisions_proposal_reuse_guard;
  " >/dev/null
}
trap 'reenable_guard_triggers; cleanup' EXIT

echo "Restoring into the local, throwaway Supabase instance..."
docker exec --interactive "${container}" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 < "${data_dump}" >/dev/null
reenable_guard_triggers

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
# Scoped to the current row per (territory_id, geometry_kind), the same
# "current view over an immutable history" convention used everywhere else
# (write-geometries.mjs, derive-county-geometries.mjs) — not every row ever
# written. The append-only model deliberately keeps superseded rows,
# including ones that were valid geometry at the time but are now known-bad
# and already replaced (see #84-#86); checking full history here would flag
# that intentionally-preserved past, not the data this registry serves today.
CURRENT_GEOMETRY_CTE="
  with current_geometries as (
    select distinct on (territory_id, geometry_kind) territory_id, geometry_kind, geometry
    from registry.territory_geometries
    order by territory_id, geometry_kind, created_at desc
  )
"
invalid_geometries="$(docker exec "${container}" psql --username postgres --dbname postgres --tuples-only --no-align --command "
  ${CURRENT_GEOMETRY_CTE}
  select count(*) from current_geometries where not gis.ST_IsValid(geometry);
")"
if [[ "${invalid_geometries}" != "0" ]]; then
  echo "MISMATCH: ${invalid_geometries} invalid current restored geometries" >&2
  mismatch=1
else
  echo "OK: all current restored geometries pass gis.ST_IsValid"
fi

sample_geometry_check="$(docker exec "${container}" psql --username postgres --dbname postgres --tuples-only --no-align --command "
  ${CURRENT_GEOMETRY_CTE}
  select count(*) from current_geometries where gis.ST_Area(geometry) <= 0;
")"
if [[ "${sample_geometry_check}" != "0" ]]; then
  echo "MISMATCH: ${sample_geometry_check} current restored geometries with non-positive area" >&2
  mismatch=1
else
  echo "OK: gis.ST_Area computes a positive area for every current restored geometry"
fi

if [[ "${mismatch}" == "1" ]]; then
  echo "Production restore drill FAILED" >&2
  exit 1
fi

echo "Production restore drill passed: real production data restored into an isolated, throwaway instance and verified (row counts, PostGIS validity and spatial functions)."
