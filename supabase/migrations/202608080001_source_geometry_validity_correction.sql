begin;

-- ANCPI's own published UAT polygons ('source' geometry_kind) sometimes
-- self-intersect — confirmed against real production data (34/3186 current
-- rows). derive-county-geometries.mjs already re-validates each child before
-- unioning, so county/București derivation was unaffected, but the raw
-- 'source' rows themselves stay invalid and unusable as-is by any consumer
-- that expects a valid polygon.
--
-- 'source_corrected' is a new, distinct geometry_kind for a technical
-- validity correction (gis.ST_MakeValid), never overwriting or replacing the
-- original 'source' row — both remain, distinguished by geometry_kind, so a
-- correction is never presented as ANCPI's unmodified original value
-- (README, "principii nenegociabile": corecțiile tehnice nu sunt prezentate
-- drept modificări ale sursei oficiale). derivation_method becomes required
-- for it, same as for 'derived', to record which correction method produced
-- the row.
alter table registry.territory_geometries
  drop constraint territory_geometries_geometry_kind_check;

alter table registry.territory_geometries
  add constraint territory_geometries_geometry_kind_check
  check (geometry_kind in ('source', 'derived', 'simplified', 'source_corrected'));

alter table registry.territory_geometries
  drop constraint territory_geometries_check2;

alter table registry.territory_geometries
  add constraint territory_geometries_check2
  check (geometry_kind not in ('derived', 'source_corrected') or derivation_method is not null);

commit;
