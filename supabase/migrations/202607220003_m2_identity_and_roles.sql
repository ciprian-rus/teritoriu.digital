begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'uuid_v7_variant_check'
      and contypid = 'registry.uuid_v7'::regtype
  ) then
    alter domain registry.uuid_v7
      add constraint uuid_v7_variant_check
      check ((get_byte(uuid_send(value), 8) >> 6) = 2);
  end if;
end
$$;

alter table registry.territory_revisions
  add column if not exists administrative_role text;

update registry.territory_revisions
set administrative_role = case
  when territory_type = 'country' then 'country'
  when territory_type in ('county', 'bucharest') then 'county_uat'
  when territory_type in ('municipality', 'city', 'commune') then 'local_uat'
  when territory_type = 'sector' then 'administrative_subdivision'
  when territory_type in ('component_locality', 'village') then 'locality'
  when territory_type in ('macroregion', 'development_region') then 'statistical_region'
  else 'locality'
end
where administrative_role is null;

alter table registry.territory_revisions
  alter column administrative_role set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'territory_revisions_administrative_role_check'
      and conrelid = 'registry.territory_revisions'::regclass
  ) then
    alter table registry.territory_revisions
      add constraint territory_revisions_administrative_role_check
      check (administrative_role in (
        'country', 'county_uat', 'local_uat', 'administrative_subdivision', 'locality',
        'statistical_region'
      ));
  end if;
end
$$;

alter table registry.identity_decisions
  add column if not exists proposed_territory_id registry.uuid_v7;

create unique index if not exists identity_decisions_proposed_idx
  on registry.identity_decisions (proposed_territory_id)
  where proposed_territory_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'identity_decisions_target_check'
      and conrelid = 'registry.identity_decisions'::regclass
  ) then
    alter table registry.identity_decisions
      add constraint identity_decisions_target_check
      check (
        (decision = 'matched' and candidate_territory_id is not null and proposed_territory_id is null)
        or (decision = 'create' and candidate_territory_id is null and proposed_territory_id is not null)
        or decision in ('rejected', 'needs_review')
      );
  end if;
end
$$;

commit;
