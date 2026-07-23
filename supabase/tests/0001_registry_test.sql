begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(38);

select extensions.has_schema('registry', 'registry schema exists');
select extensions.has_table('registry', 'territories', 'territories table exists');
select extensions.has_table('registry', 'territory_revisions', 'territory revisions table exists');
select extensions.has_table('registry', 'territory_identifiers', 'territory identifiers table exists');
select extensions.has_table('registry', 'territory_geometries', 'territory geometries table exists');
select extensions.has_table('registry', 'source_snapshots', 'source snapshots table exists');
select extensions.has_table('registry', 'validation_findings', 'validation findings table exists');
select extensions.has_table('registry', 'releases', 'releases table exists');
select extensions.has_table('registry', 'release_artifacts', 'release artifacts table exists');
select extensions.has_table('registry', 'release_candidate_approvals', 'candidate approvals are explicit');
select extensions.has_table('registry', 'release_channel_events', 'release channel history is explicit');
select extensions.has_table('registry', 'correction_reports', 'correction reports table exists');
select extensions.has_column('registry', 'territories', 'territory_id', 'territory identity is explicit');
select extensions.has_column('registry', 'territory_revisions', 'valid_from', 'valid time is modeled');
select extensions.has_column('registry', 'territory_revisions', 'recorded_at', 'recorded time is modeled');
select extensions.has_column('registry', 'territory_revisions', 'administrative_role', 'administrative role is explicit');
select extensions.has_column('registry', 'identity_decisions', 'proposed_territory_id', 'new identities are proposed before promotion');
select extensions.has_column('registry', 'territory_revisions', 'release_id', 'revisions record their release provenance');
select extensions.has_column('registry', 'territory_identifiers', 'release_id', 'identifiers record their release provenance');
select extensions.has_index('registry', 'identity_decisions', 'identity_decisions_proposed_idx', 'proposed identities are indexed for safe reuse');
select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'uuid_v7_variant_check'
      and contypid = 'registry.uuid_v7'::regtype
  ),
  'UUIDv7 domain enforces the RFC variant bits'
);
select extensions.has_index('registry', 'territory_geometries', 'territory_geometries_spatial_idx', 'geometry has a GiST index');
select extensions.has_trigger('registry', 'releases', 'published_releases_immutable', 'published releases are protected');
select extensions.has_trigger('registry', 'release_candidate_approvals', 'release_candidate_approvals_append_only', 'candidate approvals are append-only');
select extensions.has_trigger('registry', 'release_channel_events', 'release_channel_events_append_only', 'channel history is append-only');
select extensions.has_trigger('registry', 'release_channels', 'release_channels_guard', 'release channels enforce release state');
select extensions.has_index('registry', 'territory_revisions', 'territory_revisions_release_idx', 'one revision per territory and release is enforced');
select extensions.has_index('registry', 'releases', 'releases_one_published_import_idx', 'one published release per import is enforced');
select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conname = 'releases_publication_date_check'
      and conrelid = 'registry.releases'::regclass
  ),
  'published release date must match its release ID'
);
select extensions.has_table('storage', 'buckets', 'storage buckets table exists');
select extensions.is(
  (select public from storage.buckets where id = 'source-snapshots'),
  false,
  'source snapshot bucket is private'
);
select extensions.is(
  (select file_size_limit from storage.buckets where id = 'source-snapshots'),
  5242880::bigint,
  'source snapshot bucket enforces the acquisition size limit'
);
select extensions.ok(
  not has_schema_privilege('anon', 'registry', 'usage'),
  'anon cannot use registry schema'
);
select extensions.ok(
  not has_schema_privilege('authenticated', 'registry', 'usage'),
  'authenticated cannot use registry schema'
);
select extensions.ok(
  not has_table_privilege('anon', 'registry.territories', 'select'),
  'anon cannot select internal registry tables'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'registry.territories', 'select'),
  'authenticated cannot select internal registry tables'
);
select extensions.ok(
  not has_table_privilege('anon', 'registry.release_candidate_approvals', 'select'),
  'anon cannot read candidate approvals'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'registry.release_channel_events', 'select'),
  'authenticated cannot read internal release channel history'
);

select * from extensions.finish();

rollback;
