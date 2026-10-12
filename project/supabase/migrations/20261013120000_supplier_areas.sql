-- Supplier areas: which parts of the venue (Bar, Kitchen, Barista) each supplier serves.
--
-- Apply to STAGING first, then to live BEFORE merging the app change (the supplier form sends
-- areas, so saving a supplier fails until this column exists). Needs the admin migrations.
-- Safe to re-run.
--
-- A supplier can be in several areas. No areas ticked means "all areas", so a supplier nobody
-- has sorted yet still shows everywhere in the stock item supplier list.

alter table suppliers add column if not exists areas text[] not null default '{}';
alter table suppliers drop constraint if exists suppliers_areas_valid;
alter table suppliers add constraint suppliers_areas_valid check (areas <@ array['Bar','Kitchen','Barista']);

-- One-off pre-fill from the stock items: a supplier used on Bar items gets Bar, and so on.
-- Only suppliers with no areas yet are filled, so re-running never overwrites areas a manager
-- has set by hand. Matching is by name, ignoring capitals and spaces, like the rest of the app.
-- Each supplier filled is recorded in the change log (as a "Supabase dashboard" change).
with used as (
  select lower(btrim(item->>'s')) as supplier_key, item->>'a' as area
  from app_state,
       jsonb_array_elements(
         case when jsonb_typeof(app_state.value->'data') = 'array' then app_state.value->'data' else '[]'::jsonb end
       ) as item
  where item->>'a' in ('Bar', 'Kitchen', 'Barista')
    and coalesce(btrim(item->>'s'), '') <> ''
  group by 1, 2
)
update suppliers s
set areas = array(
  select a from unnest(array['Bar','Kitchen','Barista']) as a
  where exists (select 1 from used u where u.supplier_key = lower(btrim(s.name)) and u.area = a)
)
where s.areas = '{}'
  and exists (select 1 from used u where u.supplier_key = lower(btrim(s.name)));
