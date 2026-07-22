begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(15);

select extensions.has_schema('registry', 'registry schema exists');
select extensions.has_table('registry', 'territories', 'territories table exists');
select extensions.has_table('registry', 'territory_revisions', 'territory revisions table exists');
select extensions.has_table('registry', 'territory_identifiers', 'territory identifiers table exists');
select extensions.has_table('registry', 'territory_geometries', 'territory geometries table exists');
select extensions.has_table('registry', 'source_snapshots', 'source snapshots table exists');
select extensions.has_table('registry', 'validation_findings', 'validation findings table exists');
select extensions.has_table('registry', 'releases', 'releases table exists');
select extensions.has_table('registry', 'release_artifacts', 'release artifacts table exists');
select extensions.has_table('registry', 'correction_reports', 'correction reports table exists');
select extensions.has_column('registry', 'territories', 'territory_id', 'territory identity is explicit');
select extensions.has_column('registry', 'territory_revisions', 'valid_from', 'valid time is modeled');
select extensions.has_column('registry', 'territory_revisions', 'recorded_at', 'recorded time is modeled');
select extensions.has_index('registry', 'territory_geometries', 'territory_geometries_spatial_idx', 'geometry has a GiST index');
select extensions.has_trigger('registry', 'releases', 'published_releases_immutable', 'published releases are protected');

select * from extensions.finish();

rollback;

