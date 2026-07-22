begin;

do $$
begin
  if exists (select 1 from registry.territory_revisions)
     or exists (select 1 from registry.territory_identifiers) then
    raise exception 'M3 release provenance migration requires an empty canonical registry';
  end if;
end
$$;

alter table registry.territory_revisions
  add column release_id text references registry.releases(release_id);

alter table registry.territory_revisions
  alter column release_id set not null;

alter table registry.territory_identifiers
  add column release_id text references registry.releases(release_id);

alter table registry.territory_identifiers
  alter column release_id set not null;

create unique index territory_revisions_release_idx
  on registry.territory_revisions (release_id, territory_id);

create index territory_identifiers_release_idx
  on registry.territory_identifiers (release_id, territory_id);

create table registry.release_candidate_approvals (
  approval_id registry.uuid_v7 primary key,
  import_run_id registry.uuid_v7 not null unique references registry.import_runs(import_run_id),
  candidate_sha256 registry.sha256_hex not null,
  approved_by text not null check (length(btrim(approved_by)) > 0),
  approved_at timestamptz not null,
  rationale text not null check (length(btrim(rationale)) >= 10),
  created_at timestamptz not null default now()
);

create unique index releases_one_published_import_idx
  on registry.releases (import_run_id)
  where status = 'published';

alter table registry.releases
  add constraint releases_publication_date_check
  check (
    status <> 'published'
    or replace(left(release_id, 10), '.', '-') = to_char(published_at at time zone 'UTC', 'YYYY-MM-DD')
  );

create table registry.release_channel_events (
  channel_event_id registry.uuid_v7 primary key,
  channel text not null check (channel in ('stable', 'candidate')),
  previous_release_id text references registry.releases(release_id),
  release_id text not null references registry.releases(release_id),
  event_type text not null check (event_type in ('publish', 'promote', 'rollback')),
  changed_by text not null check (length(btrim(changed_by)) > 0),
  rationale text not null check (length(btrim(rationale)) >= 10),
  changed_at timestamptz not null default now(),
  check (previous_release_id is null or previous_release_id <> release_id)
);

create index release_channel_events_channel_idx
  on registry.release_channel_events (channel, changed_at desc);

create or replace function registry.guard_release_channel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  release_status text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Release channels cannot be deleted; move the pointer with an audited event';
  end if;
  select status into release_status
  from registry.releases
  where release_id = new.release_id;
  if release_status is null then
    raise exception 'Release % does not exist', new.release_id;
  end if;
  if new.channel = 'stable' and release_status <> 'published' then
    raise exception 'Stable can reference only a published release';
  end if;
  if new.channel = 'candidate' and release_status not in ('approved', 'published') then
    raise exception 'Candidate can reference only an approved or published release';
  end if;
  return new;
end;
$$;

create trigger release_candidate_approvals_append_only
  before update or delete on registry.release_candidate_approvals
  for each row execute function registry.reject_mutation();

create trigger release_channel_events_append_only
  before update or delete on registry.release_channel_events
  for each row execute function registry.reject_mutation();

create trigger release_channels_guard
  before insert or update or delete on registry.release_channels
  for each row execute function registry.guard_release_channel();

alter table registry.release_candidate_approvals enable row level security;
alter table registry.release_channel_events enable row level security;

revoke all on registry.release_candidate_approvals from public, anon, authenticated;
revoke all on registry.release_channel_events from public, anon, authenticated;

commit;
