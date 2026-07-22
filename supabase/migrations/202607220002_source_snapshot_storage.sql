begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'source-snapshots',
  'source-snapshots',
  false,
  5242880,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table registry.source_snapshots is
  'Immutable source observations addressed by SHA-256; raw bytes are stored in the private source-snapshots bucket.';

commit;
