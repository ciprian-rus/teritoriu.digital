begin;

do $$
begin
  if exists (
    select 1
    from registry.identity_decisions
    where decision = 'create'
      and proposed_territory_id is not null
    group by proposed_territory_id
    having count(distinct source_record_key) > 1
  ) then
    raise exception 'Cannot enable proposal reuse: one proposed territory ID is bound to multiple source keys';
  end if;

  if exists (
    select 1
    from registry.identity_decisions
    where decision = 'create'
      and proposed_territory_id is not null
    group by source_record_key
    having count(distinct proposed_territory_id) > 1
  ) then
    raise exception 'Cannot enable proposal reuse: one source key is bound to multiple proposed territory IDs';
  end if;
end
$$;

drop index if exists registry.identity_decisions_proposed_idx;

create index identity_decisions_proposed_idx
  on registry.identity_decisions (proposed_territory_id, source_record_key)
  where decision = 'create' and proposed_territory_id is not null;

create index identity_decisions_source_proposed_idx
  on registry.identity_decisions (source_record_key, proposed_territory_id)
  where decision = 'create' and proposed_territory_id is not null;

create or replace function registry.guard_identity_proposal_reuse()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  conflicting_source_key text;
  conflicting_territory_id registry.uuid_v7;
begin
  if new.decision <> 'create' or new.proposed_territory_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registry.identity_decisions:proposal-reuse', 0)
  );

  select existing.source_record_key
  into conflicting_source_key
  from registry.identity_decisions existing
  where existing.decision = 'create'
    and existing.proposed_territory_id = new.proposed_territory_id
    and existing.source_record_key <> new.source_record_key
    and existing.decision_id <> new.decision_id
  limit 1;

  if conflicting_source_key is not null then
    raise exception
      'Proposed territory ID % is already bound to SIRUTA %',
      new.proposed_territory_id,
      conflicting_source_key
      using
        errcode = '23505',
        constraint = 'identity_decisions_proposal_identity_guard';
  end if;

  select existing.proposed_territory_id
  into conflicting_territory_id
  from registry.identity_decisions existing
  where existing.decision = 'create'
    and existing.source_record_key = new.source_record_key
    and existing.proposed_territory_id <> new.proposed_territory_id
    and existing.decision_id <> new.decision_id
  limit 1;

  if conflicting_territory_id is not null then
    raise exception
      'SIRUTA % is already bound to proposed territory ID %',
      new.source_record_key,
      conflicting_territory_id
      using
        errcode = '23505',
        constraint = 'identity_decisions_proposal_identity_guard';
  end if;

  return new;
end;
$$;

drop trigger if exists identity_decisions_proposal_reuse_guard
  on registry.identity_decisions;

create trigger identity_decisions_proposal_reuse_guard
  before insert or update of source_record_key, proposed_territory_id, decision
  on registry.identity_decisions
  for each row execute function registry.guard_identity_proposal_reuse();

commit;
