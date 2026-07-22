begin;

create schema if not exists registry;
create schema if not exists gis;

create extension if not exists postgis with schema gis;

comment on schema registry is
  'Internal control plane for Teritoriu.digital. Not exposed through the public Data API.';

create domain registry.uuid_v7 as uuid
  check ((get_byte(uuid_send(value), 6) >> 4) = 7);

create domain registry.sha256_hex as text
  check (value ~ '^[0-9a-f]{64}$');

create table registry.data_sources (
  source_id registry.uuid_v7 primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  publisher text not null,
  title text not null,
  official_url text not null check (official_url ~ '^https://'),
  authority_role text not null check (authority_role in ('authoritative', 'complementary', 'legal_evidence')),
  license_spdx text,
  expected_frequency text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table registry.source_snapshots (
  snapshot_id registry.uuid_v7 primary key,
  source_id registry.uuid_v7 not null references registry.data_sources(source_id),
  retrieved_at timestamptz not null,
  requested_url text not null check (requested_url ~ '^https://'),
  resolved_url text not null check (resolved_url ~ '^https://'),
  http_status integer not null check (http_status between 100 and 599),
  declared_media_type text,
  detected_media_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 registry.sha256_hex not null,
  storage_uri text not null,
  source_version text,
  row_count bigint check (row_count is null or row_count >= 0),
  status text not null check (status in ('downloaded', 'validated', 'rejected', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, sha256)
);

create table registry.import_runs (
  import_run_id registry.uuid_v7 primary key,
  snapshot_id registry.uuid_v7 not null references registry.source_snapshots(snapshot_id),
  idempotency_key registry.sha256_hex not null unique,
  pipeline_commit text not null check (pipeline_commit ~ '^[0-9a-f]{40}$'),
  parser_version text not null,
  dry_run boolean not null default true,
  status text not null check (status in ('queued', 'running', 'blocked', 'review', 'approved', 'failed', 'completed')),
  started_at timestamptz,
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (finished_at is null or started_at is not null),
  check (finished_at is null or finished_at >= started_at)
);

create table registry.staging_records (
  staging_record_id registry.uuid_v7 primary key,
  import_run_id registry.uuid_v7 not null references registry.import_runs(import_run_id) on delete cascade,
  source_record_key text not null,
  source_record_hash registry.sha256_hex not null,
  raw_record jsonb not null,
  parsed_record jsonb,
  parse_status text not null check (parse_status in ('pending', 'parsed', 'invalid')),
  created_at timestamptz not null default now(),
  unique (import_run_id, source_record_key)
);

create table registry.territories (
  territory_id registry.uuid_v7 primary key,
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active', 'inactive', 'provisional')),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  check (retired_at is null or retired_at >= created_at)
);

create table registry.territory_revisions (
  revision_id registry.uuid_v7 primary key,
  territory_id registry.uuid_v7 not null references registry.territories(territory_id),
  official_name text not null check (length(btrim(official_name)) > 0),
  normalized_name text not null check (length(btrim(normalized_name)) > 0),
  short_name text,
  territory_type text not null check (territory_type in (
    'country', 'macroregion', 'development_region', 'county', 'bucharest', 'sector',
    'municipality', 'city', 'commune', 'component_locality', 'village', 'other'
  )),
  administrative_level smallint not null check (administrative_level between 0 and 9),
  parent_territory_id registry.uuid_v7 references registry.territories(territory_id),
  county_territory_id registry.uuid_v7 references registry.territories(territory_id),
  is_uat boolean not null default false,
  is_locality boolean not null default false,
  is_county_seat boolean not null default false,
  rank smallint,
  status text not null check (status in ('active', 'inactive', 'provisional')),
  valid_from date,
  valid_to date,
  recorded_at timestamptz not null default now(),
  recorded_to timestamptz,
  source_snapshot_id registry.uuid_v7 not null references registry.source_snapshots(snapshot_id),
  source_record_hash registry.sha256_hex not null,
  transformation_version text not null,
  metadata jsonb not null default '{}'::jsonb,
  check (parent_territory_id is null or parent_territory_id <> territory_id),
  check (county_territory_id is null or county_territory_id <> territory_id or territory_type in ('county', 'bucharest')),
  check (valid_to is null or valid_from is not null),
  check (valid_to is null or valid_to > valid_from),
  check (recorded_to is null or recorded_to > recorded_at)
);

create unique index territory_revisions_one_current_idx
  on registry.territory_revisions (territory_id)
  where recorded_to is null;

create index territory_revisions_parent_idx
  on registry.territory_revisions (parent_territory_id)
  where recorded_to is null;

create index territory_revisions_county_idx
  on registry.territory_revisions (county_territory_id)
  where recorded_to is null;

create index territory_revisions_search_idx
  on registry.territory_revisions (normalized_name)
  where recorded_to is null;

create table registry.territory_identifiers (
  identifier_id registry.uuid_v7 primary key,
  territory_id registry.uuid_v7 not null references registry.territories(territory_id),
  scheme text not null,
  issuer text not null,
  identifier_type text not null,
  value text not null check (length(btrim(value)) > 0),
  status text not null check (status in ('active', 'historical', 'provisional')),
  valid_from date,
  valid_to date,
  source_snapshot_id registry.uuid_v7 not null references registry.source_snapshots(snapshot_id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_from is not null),
  check (valid_to is null or valid_to > valid_from),
  unique nulls not distinct (scheme, value, valid_from)
);

create index territory_identifiers_territory_idx
  on registry.territory_identifiers (territory_id);

create table registry.territory_names (
  name_id registry.uuid_v7 primary key,
  territory_id registry.uuid_v7 not null references registry.territories(territory_id),
  name text not null check (length(btrim(name)) > 0),
  normalized_name text not null check (length(btrim(normalized_name)) > 0),
  name_type text not null check (name_type in ('official', 'historical', 'short', 'alternative')),
  language_code text not null default 'ro',
  script_code text not null default 'Latn',
  valid_from date,
  valid_to date,
  legal_basis text,
  source_snapshot_id registry.uuid_v7 not null references registry.source_snapshots(snapshot_id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_from is not null),
  check (valid_to is null or valid_to > valid_from)
);

create index territory_names_search_idx
  on registry.territory_names (normalized_name);

create table registry.territory_relations (
  relation_id registry.uuid_v7 primary key,
  subject_territory_id registry.uuid_v7 not null references registry.territories(territory_id),
  object_territory_id registry.uuid_v7 not null references registry.territories(territory_id),
  relation_type text not null check (relation_type in ('part_of', 'seat_of', 'predecessor_of', 'successor_of', 'related_to')),
  valid_from date,
  valid_to date,
  source_snapshot_id registry.uuid_v7 not null references registry.source_snapshots(snapshot_id),
  legal_basis text,
  notes text,
  created_at timestamptz not null default now(),
  check (subject_territory_id <> object_territory_id),
  check (valid_to is null or valid_from is not null),
  check (valid_to is null or valid_to > valid_from)
);

create index territory_relations_subject_idx
  on registry.territory_relations (subject_territory_id, relation_type);

create index territory_relations_object_idx
  on registry.territory_relations (object_territory_id, relation_type);

create table registry.territory_geometries (
  geometry_id registry.uuid_v7 primary key,
  territory_id registry.uuid_v7 not null references registry.territories(territory_id),
  geometry_kind text not null check (geometry_kind in ('source', 'derived', 'simplified')),
  detail_level text not null check (detail_level in ('original', 'high', 'medium', 'low')),
  geometry gis.geometry(multipolygon, 4326) not null,
  source_crs text not null,
  source_snapshot_id registry.uuid_v7 not null references registry.source_snapshots(snapshot_id),
  source_feature_key text,
  license_spdx text,
  geometry_sha256 registry.sha256_hex not null,
  derivation_method text,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_from is not null),
  check (valid_to is null or valid_to > valid_from),
  check (geometry_kind <> 'derived' or derivation_method is not null)
);

create index territory_geometries_spatial_idx
  on registry.territory_geometries using gist (geometry);

create index territory_geometries_territory_idx
  on registry.territory_geometries (territory_id, detail_level);

create table registry.identity_decisions (
  decision_id registry.uuid_v7 primary key,
  import_run_id registry.uuid_v7 not null references registry.import_runs(import_run_id),
  source_record_key text not null,
  candidate_territory_id registry.uuid_v7 references registry.territories(territory_id),
  decision text not null check (decision in ('matched', 'create', 'rejected', 'needs_review')),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  rationale text not null check (length(btrim(rationale)) > 0),
  decided_by text not null,
  decided_at timestamptz not null default now(),
  unique (import_run_id, source_record_key)
);

create table registry.validation_findings (
  finding_id registry.uuid_v7 primary key,
  import_run_id registry.uuid_v7 not null references registry.import_runs(import_run_id) on delete cascade,
  rule_code text not null,
  rule_version text not null,
  severity text not null check (severity in ('info', 'warning', 'error', 'blocker')),
  entity_kind text not null,
  entity_key text,
  message text not null,
  evidence jsonb not null default '{}'::jsonb,
  exception_status text not null default 'none' check (exception_status in ('none', 'requested', 'approved', 'rejected')),
  exception_rationale text,
  created_at timestamptz not null default now(),
  check (exception_status not in ('requested', 'approved', 'rejected') or exception_rationale is not null)
);

create index validation_findings_run_severity_idx
  on registry.validation_findings (import_run_id, severity);

create table registry.releases (
  release_id text primary key check (release_id ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]*$'),
  schema_version text not null check (schema_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  import_run_id registry.uuid_v7 not null references registry.import_runs(import_run_id),
  previous_release_id text references registry.releases(release_id),
  status text not null check (status in ('draft', 'approved', 'published', 'rejected')),
  manifest_sha256 registry.sha256_hex,
  approved_by text,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (status not in ('approved', 'published') or (approved_by is not null and approved_at is not null)),
  check (status <> 'published' or (published_at is not null and manifest_sha256 is not null))
);

create table registry.release_artifacts (
  artifact_id registry.uuid_v7 primary key,
  release_id text not null references registry.releases(release_id),
  name text not null,
  media_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 registry.sha256_hex not null,
  storage_uri text not null,
  created_at timestamptz not null default now(),
  unique (release_id, name)
);

create table registry.release_channels (
  channel text primary key check (channel in ('stable', 'candidate')),
  release_id text not null references registry.releases(release_id),
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create table registry.correction_reports (
  correction_id registry.uuid_v7 primary key,
  public_reference text not null unique,
  entity_kind text not null check (entity_kind in ('territory', 'identifier', 'name', 'relation', 'geometry', 'release')),
  territory_id registry.uuid_v7 references registry.territories(territory_id),
  release_id text references registry.releases(release_id),
  category text not null,
  description text not null check (length(btrim(description)) > 0),
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'triage', 'investigating', 'accepted', 'rejected', 'resolved')),
  resolution text,
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (status not in ('accepted', 'rejected', 'resolved') or resolution is not null),
  check (resolved_at is null or resolved_at >= submitted_at)
);

create table registry.audit_events (
  audit_event_id registry.uuid_v7 primary key,
  event_type text not null,
  entity_kind text not null,
  entity_key text not null,
  actor text not null,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create or replace function registry.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name;
end;
$$;

create or replace function registry.protect_published_release()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'published' then
    raise exception 'Published release % is immutable', old.release_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function registry.protect_published_artifact()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_release_id text;
begin
  target_release_id := case when tg_op = 'INSERT' then new.release_id else old.release_id end;
  if exists (
    select 1
    from registry.releases
    where release_id = target_release_id and status = 'published'
  ) then
    raise exception 'Artifacts for published release % are immutable', target_release_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger audit_events_append_only
  before update or delete on registry.audit_events
  for each row execute function registry.reject_mutation();

create trigger published_releases_immutable
  before update or delete on registry.releases
  for each row execute function registry.protect_published_release();

create trigger published_artifacts_immutable
  before insert or update or delete on registry.release_artifacts
  for each row execute function registry.protect_published_artifact();

alter table registry.data_sources enable row level security;
alter table registry.source_snapshots enable row level security;
alter table registry.import_runs enable row level security;
alter table registry.staging_records enable row level security;
alter table registry.territories enable row level security;
alter table registry.territory_revisions enable row level security;
alter table registry.territory_identifiers enable row level security;
alter table registry.territory_names enable row level security;
alter table registry.territory_relations enable row level security;
alter table registry.territory_geometries enable row level security;
alter table registry.identity_decisions enable row level security;
alter table registry.validation_findings enable row level security;
alter table registry.releases enable row level security;
alter table registry.release_artifacts enable row level security;
alter table registry.release_channels enable row level security;
alter table registry.correction_reports enable row level security;
alter table registry.audit_events enable row level security;

revoke all on schema registry from public, anon, authenticated;
revoke all on all tables in schema registry from public, anon, authenticated;
revoke all on all functions in schema registry from public, anon, authenticated;
alter default privileges in schema registry revoke all on tables from public, anon, authenticated;
alter default privileges in schema registry revoke all on functions from public, anon, authenticated;

commit;
