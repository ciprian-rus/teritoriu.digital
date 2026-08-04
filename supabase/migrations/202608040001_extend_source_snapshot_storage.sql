begin;

-- The bucket was sized and typed for the SIRUTA xlsx source only. The ANCPI
-- RELUAT geometry source archives a GeoJSON payload covering every county
-- and UAT in the country, well past 5 MiB and a different media type — both
-- reject the upload as configured. Raise the limit to this source's own
-- configured ceiling (config/sources/ancpi-reluat-geometries.json maxBytes)
-- and allow the JSON media type alongside the existing spreadsheet type.
update storage.buckets
set
  file_size_limit = 104857600,
  allowed_mime_types = array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/json'
  ]::text[]
where id = 'source-snapshots';

commit;
