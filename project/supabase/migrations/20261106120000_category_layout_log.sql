-- Admin → Categories: records category and subgroup changes in the Admin change log.
--
-- Each area's categories and subgroups now live in the app_state document as "layout". The Worker
-- changes it only through /api/admin/layout, and each such save carries a "_layoutChange" marker
-- describing that one change (a new id every time, copied unchanged by every other save). This
-- migration:
--   1. adds a trigger that logs each new marker as ONE change_log row in the "stock_layout"
--      section (e.g. "renamed category Beer to Beer & cider");
--   2. updates log_stock_item_changes() so the items a layout change moved (listed in the marker's
--      itemIds) are not also logged one row per item. It is otherwise identical to the version
--      in 20260924120100_admin_change_log.sql. Ordinary item edits are logged as before.
--
-- No new table, so no grants or row-level security changes: change_log already lets managers
-- read it (20260924120200_admin_access.sql) and stays read-only. Apply to STAGING first, then live
-- BEFORE merging the app change. Safe to re-run.

create or replace function log_stock_item_changes() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tracked constant text[] := array['n', 'a', 'c', 'group', 's', 'u', 't', 'tDay', 'tEvening', 'tEvent',
                                   'm', 'p', 'pl', 'pv', 'pu', 'location', 'active', 'lastCost'];
  old_items jsonb := '[]'::jsonb;
  new_items jsonb := '[]'::jsonb;
  layout_items jsonb := '[]'::jsonb;
  actor record;
begin
  if tg_op = 'UPDATE' and jsonb_typeof(old.value -> 'data') = 'array' then old_items := old.value -> 'data'; end if;
  if jsonb_typeof(new.value -> 'data') = 'array' then new_items := new.value -> 'data'; end if;
  -- Items moved by a category or subgroup change made in this save. They're covered by the one
  -- stock_layout entry that log_layout_changes() writes.
  if (new.value -> '_layoutChange' ->> 'id') is not null
     and (tg_op = 'INSERT' or (new.value -> '_layoutChange' ->> 'id') is distinct from (old.value -> '_layoutChange' ->> 'id'))
     and jsonb_typeof(new.value -> '_layoutChange' -> 'itemIds') = 'array' then
    layout_items := new.value -> '_layoutChange' -> 'itemIds';
  end if;
  -- updated_by is the app user the server stamped on this save. Only trust it when the change
  -- came through the API; an edit made directly in the dashboard is attributed to the dashboard.
  select * into actor from change_log_actor(
    case when coalesce(current_setting('request.jwt.claims', true), '') <> '' then new.updated_by end);

  insert into change_log (user_id, user_email, user_name, table_name, record_id, action, old_values, new_values)
  select actor.actor_id, actor.actor_email, actor.actor_name, 'stock_items', coalesce(n.key, o.key),
         case
           when o.key is null then 'insert'
           when n.key is null then 'delete'
           when (o.item -> 'active') is distinct from (n.item -> 'active')
             then case when n.item -> 'active' = 'false'::jsonb then 'archive' else 'restore' end
           else 'update'
         end,
         case when o.key is null then null when n.key is null then jsonb_strip_nulls(o.item - 'q' - 'photo') else d.old_values end,
         case when n.key is null then null when o.key is null then jsonb_strip_nulls(n.item - 'q' - 'photo') else d.new_values end
  from (
    select coalesce(e ->> 'id', (e ->> 'a') || '|' || lower(e ->> 'n')) as key,
           e || jsonb_build_object('active', coalesce(e ->> 'active', 'true') <> 'false') as item
    from jsonb_array_elements(old_items) e
  ) o
  full join (
    select coalesce(e ->> 'id', (e ->> 'a') || '|' || lower(e ->> 'n')) as key,
           e || jsonb_build_object('active', coalesce(e ->> 'active', 'true') <> 'false') as item
    from jsonb_array_elements(new_items) e
  ) n on o.key = n.key
  left join lateral change_log_diff(o.item, n.item, tracked, array['n', 'a']) d on true
  where (o.key is null or n.key is null or d.new_values is not null or d.old_values is not null)
    and not (o.key is not null and n.key is not null and layout_items ? n.key);

  return null;
end;
$$;

revoke all on function log_stock_item_changes() from public, anon, authenticated, service_role;

-- One change_log row per category or subgroup change. The Worker fills in the marker:
-- action (insert / update / archive / restore), record (e.g. "Bar|Beer"), and before / after,
-- which hold the kind (category or subgroup), area, category, subgroup, position, item count and
-- where archived items were moved to.
create or replace function log_layout_changes() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  change jsonb := new.value -> '_layoutChange';
  actor record;
begin
  if coalesce(jsonb_typeof(change), '') <> 'object' or (change ->> 'id') is null then return null; end if;
  if (old.value -> '_layoutChange' ->> 'id') is not distinct from (change ->> 'id') then return null; end if;
  if coalesce(change ->> 'action', '') not in ('insert', 'update', 'archive', 'restore') then return null; end if;
  select * into actor from change_log_actor(
    case when coalesce(current_setting('request.jwt.claims', true), '') <> '' then new.updated_by end);

  insert into change_log (user_id, user_email, user_name, table_name, record_id, action, old_values, new_values)
  values (actor.actor_id, actor.actor_email, actor.actor_name, 'stock_layout',
          coalesce(nullif(change ->> 'record', ''), change ->> 'id'),
          change ->> 'action',
          case when jsonb_typeof(change -> 'before') = 'object' then change -> 'before' end,
          case when jsonb_typeof(change -> 'after') = 'object' then change -> 'after' end);

  return null;
end;
$$;

revoke all on function log_layout_changes() from public, anon, authenticated, service_role;

drop trigger if exists zz_change_log_stock_layout on app_state;
create trigger zz_change_log_stock_layout
  after update of value on app_state
  for each row execute function log_layout_changes();
