-- Records typed counts and physical count corrections in the Admin change log.
--
-- Stock items live inside the single app_state row, and log_stock_item_changes() deliberately
-- leaves quantities ("q") out because counts change constantly. This adds a second trigger that
-- logs only the hand-set counts: each new "count_adjustment" (a count typed straight into the
-- quantity box) or "correction" (a physical count correction) history entry in a save becomes
-- one change_log row in the "stock_counts" section, with the before and after count and the
-- optional reason. Deliveries, wastage, transfers and stocktakes stay on the History screen only.
--
-- No new table, so no new grants are needed: change_log already allows managers to read
-- (migration 20260924120200_admin_access.sql) and stays read-only. Safe to re-run.

create or replace function log_stock_count_changes() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_events jsonb := '[]'::jsonb;
  new_events jsonb := '[]'::jsonb;
  actor record;
begin
  if jsonb_typeof(old.value -> 'history') = 'array' then old_events := old.value -> 'history'; end if;
  if jsonb_typeof(new.value -> 'history') = 'array' then new_events := new.value -> 'history'; end if;
  -- Same attribution rule as log_stock_item_changes(): trust the app user the server stamped on
  -- the save only when the change came through the API.
  select * into actor from change_log_actor(
    case when coalesce(current_setting('request.jwt.claims', true), '') <> '' then new.updated_by end);

  -- An entry is new when its key (the same one eventKey() uses in worker/server-template.js)
  -- wasn't in the history before this save. History is only ever added to, never trimmed.
  with old_keys as (
    select coalesce(nullif(e ->> 'id', ''), concat_ws('|', coalesce(e ->> 'movementId', ''),
             coalesce(e ->> 'clientAt', e ->> 'at', ''), coalesce(e ->> 'type', ''),
             coalesce(e ->> 'area', ''), coalesce(e ->> 'item', ''))) as k
    from jsonb_array_elements(old_events) e
    where e ->> 'type' in ('count_adjustment', 'correction')
  ), added as (
    select h.e, h.pos,
           coalesce(nullif(h.e ->> 'id', ''), concat_ws('|', coalesce(h.e ->> 'movementId', ''),
             coalesce(h.e ->> 'clientAt', h.e ->> 'at', ''), coalesce(h.e ->> 'type', ''),
             coalesce(h.e ->> 'area', ''), coalesce(h.e ->> 'item', ''))) as k
    from jsonb_array_elements(new_events) with ordinality as h(e, pos)
    where h.e ->> 'type' in ('count_adjustment', 'correction')
  )
  insert into change_log (user_id, user_email, user_name, table_name, record_id, action, old_values, new_values)
  select actor.actor_id, actor.actor_email, actor.actor_name, 'stock_counts',
         coalesce(nullif(a.e ->> 'itemId', ''), concat_ws('|', a.e ->> 'area', lower(a.e ->> 'item'))),
         'update',
         -- A missing or null count means "Not counted", kept as JSON null rather than 0.
         jsonb_strip_nulls(jsonb_build_object('n', a.e -> 'item', 'a', a.e -> 'area', 'u', a.e -> 'unit'))
           || jsonb_build_object('q', coalesce(a.e -> 'before', 'null'::jsonb)),
         jsonb_strip_nulls(jsonb_build_object('n', a.e -> 'item', 'a', a.e -> 'area', 'u', a.e -> 'unit',
                                              'type', a.e -> 'type', 'reason', nullif(a.e -> 'reason', '""'::jsonb)))
           || jsonb_build_object('q', coalesce(a.e -> 'after', 'null'::jsonb))
  from added a
  where not exists (select 1 from old_keys o where o.k = a.k)
  order by a.pos desc; -- newest entries are first in history; log them oldest first

  return null;
end;
$$;

revoke all on function log_stock_count_changes() from public, anon, authenticated, service_role;

drop trigger if exists zz_change_log_stock_counts on app_state;
create trigger zz_change_log_stock_counts
  after update of value on app_state
  for each row execute function log_stock_count_changes();
