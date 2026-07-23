begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(6);

insert into registry.data_sources (
  source_id, slug, publisher, title, official_url, authority_role
) values (
  '018f0000-0000-7000-8000-000000000001',
  'siruta-test',
  'INS',
  'SIRUTA test fixture',
  'https://example.test/siruta.xlsx',
  'authoritative'
);

insert into registry.source_snapshots (
  snapshot_id, source_id, retrieved_at, requested_url, resolved_url, http_status,
  detected_media_type, size_bytes, sha256, storage_uri, status
) values (
  '018f0000-0000-7000-8000-000000000002',
  '018f0000-0000-7000-8000-000000000001',
  '2026-07-23T00:00:00Z',
  'https://example.test/siruta.xlsx',
  'https://example.test/siruta.xlsx',
  200,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  1,
  repeat('a', 64),
  'test://siruta.xlsx',
  'validated'
);

insert into registry.import_runs (
  import_run_id, snapshot_id, idempotency_key, pipeline_commit, parser_version,
  dry_run, status
) values
  (
    '018f0000-0000-7000-8000-000000000003',
    '018f0000-0000-7000-8000-000000000002',
    repeat('b', 64),
    repeat('c', 40),
    'siruta-test.1.0.0',
    false,
    'review'
  ),
  (
    '018f0000-0000-7000-8000-000000000004',
    '018f0000-0000-7000-8000-000000000002',
    repeat('d', 64),
    repeat('e', 40),
    'siruta-test.1.0.1',
    false,
    'review'
  );

select extensions.has_trigger(
  'registry',
  'identity_decisions',
  'identity_decisions_proposal_reuse_guard',
  'identity proposal reuse is protected by a database trigger'
);

select extensions.lives_ok(
  $$
    insert into registry.identity_decisions (
      decision_id, import_run_id, source_record_key, proposed_territory_id,
      decision, confidence, rationale, decided_by
    ) values (
      '018f0000-0000-7000-8000-000000000010',
      '018f0000-0000-7000-8000-000000000003',
      '1',
      '018f0000-0000-7000-8000-0000000000a1',
      'create',
      1,
      'Initial reviewed proposal',
      'test:first'
    )
  $$,
  'the first SIRUTA identity proposal is accepted'
);

select extensions.lives_ok(
  $$
    insert into registry.identity_decisions (
      decision_id, import_run_id, source_record_key, proposed_territory_id,
      decision, confidence, rationale, decided_by
    ) values (
      '018f0000-0000-7000-8000-000000000011',
      '018f0000-0000-7000-8000-000000000004',
      '1',
      '018f0000-0000-7000-8000-0000000000a1',
      'create',
      1,
      'Reused reviewed proposal',
      'test:second'
    )
  $$,
  'the same SIRUTA to UUID proposal is reusable in a later import'
);

select extensions.is(
  (
    select count(*)
    from registry.identity_decisions
    where source_record_key = '1'
      and proposed_territory_id = '018f0000-0000-7000-8000-0000000000a1'
  ),
  2::bigint,
  'both import decisions remain available as audit evidence'
);

select extensions.throws_ok(
  $$
    insert into registry.identity_decisions (
      decision_id, import_run_id, source_record_key, proposed_territory_id,
      decision, confidence, rationale, decided_by
    ) values (
      '018f0000-0000-7000-8000-000000000012',
      '018f0000-0000-7000-8000-000000000003',
      '2',
      '018f0000-0000-7000-8000-0000000000a1',
      'create',
      1,
      'Conflicting source key',
      'test:conflict'
    )
  $$,
  '23505',
  'Proposed territory ID 018f0000-0000-7000-8000-0000000000a1 is already bound to SIRUTA 1',
  'one proposed UUID cannot be assigned to another SIRUTA code'
);

select extensions.throws_ok(
  $$
    insert into registry.identity_decisions (
      decision_id, import_run_id, source_record_key, proposed_territory_id,
      decision, confidence, rationale, decided_by
    ) values (
      '018f0000-0000-7000-8000-000000000013',
      '018f0000-0000-7000-8000-000000000004',
      '1',
      '018f0000-0000-7000-8000-0000000000a2',
      'create',
      1,
      'Conflicting proposed UUID',
      'test:conflict'
    )
  $$,
  '23505',
  'SIRUTA 1 is already bound to proposed territory ID 018f0000-0000-7000-8000-0000000000a1',
  'one SIRUTA code cannot be assigned to another proposed UUID'
);

select * from extensions.finish();

rollback;
