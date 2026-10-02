-- Admin area, migration 2 of 3: a database-level change log.
--
-- Every insert / update / delete on a watched table is recorded by a Postgres trigger, so it
-- is captured whoever or whatever makes the change: the app, the Supabase dashboard, or a
-- script. Entries can't be edited or deleted (see the guard triggers at the bottom and the
-- grants in migration 3). Safe to re-run.
--
-- To watch another table later, add one line:
--   select enable_change_log('table_name', 'id_column', 'name_column');

create table if not exists change_log (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  user_id text,                  -- Supabase Auth user id, when known
  user_email text,
  user_name text not null,       -- display name at the time of the change
  table_name text not null,      -- 'suppliers', 'users', 'stock_items', ...
  record_id text not null,
  action text not null check (action in ('insert', 'update', 'archive', 'restore', 'delete')),
  old_values jsonb,              -- only the fields that changed (plus the record's name)
  new_values jsonb
);
create index if not exists idx_change_log_changed_at on change_log (changed_at desc);
create index if not exists idx_change_log_table on change_log (table_name, changed_at desc);
create index if not exists idx_change_log_user_name on change_log (user_name);
alter table change_log enable row level security;

-- Which tables are watched, and how to read them. Filled in by enable_change_log().
create table if not exists change_log_tables (
  table_name text primary key,
  id_column text not null,
  label_column text,                          -- always included so summaries can name the record
  ignore_columns text[] not null default '{}', -- bookkeeping columns that aren't real changes
  archive_column text,                        -- a flip of this column is logged as archive/restore
  archived_value boolean                      -- the value that means "archived"
);
alter table change_log_tables enable row level security;

-- Who made the change. Signed-in requests through the app carry the person's own token, so
-- their email is in the request claims. Stock saves arrive with the server key, so the caller
-- passes the email the app stamped on the row. Anything else is a direct database edit.
create or replace function change_log_actor(
  p_fallback_email text default null,
  out actor_id text, out actor_email text, out actor_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    claims := null;
  end;
  actor_email := lower(nullif(btrim(coalesce(claims->>'email', p_fallback_email)), ''));
  if actor_email is not null then
    select u.user_id, u.name into actor_id, actor_name from users u where u.email = actor_email;
    actor_id := coalesce(actor_id, claims->>'sub');
    actor_name := coalesce(actor_name, actor_email);
  elsif claims->>'role' = 'service_role' then
    actor_name := 'Stock app (automatic)';
  else
    actor_name := 'Supabase dashboard';
  end if;
end;
$$;

-- Returns only the keys whose values differ, plus the context keys (e.g. the record's name)
-- whenever anything changed. Returns no row at all when nothing changed.
create or replace function change_log_diff(
  p_old jsonb, p_new jsonb, p_keys text[], p_context_keys text[] default '{}'
) returns table (old_values jsonb, new_values jsonb)
language sql
immutable
as $$
  with changed as (
    select k from unnest(p_keys) as k where (p_old -> k) is distinct from (p_new -> k)
  ), shown as (
    select k from changed
    union
    select k from unnest(p_context_keys) as k where exists (select 1 from changed)
  )
  select
    (select jsonb_object_agg(k, p_old -> k) from shown where p_old ? k),
    (select jsonb_object_agg(k, p_new -> k) from shown where p_new ? k)
  where exists (select 1 from changed);
$$;

-- The one trigger function shared by every watched table.
create or replace function log_row_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg change_log_tables%rowtype;
  old_row jsonb;
  new_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_action text;
  actor record;
begin
  select * into cfg from change_log_tables where table_name = tg_table_name;
  if not found then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then old_row := to_jsonb(old) - cfg.ignore_columns; end if;
  if tg_op in ('INSERT', 'UPDATE') then new_row := to_jsonb(new) - cfg.ignore_columns; end if;

  if tg_op = 'INSERT' then
    v_action := 'insert';
    v_new := jsonb_strip_nulls(new_row);
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
    v_old := jsonb_strip_nulls(old_row);
  else
    select d.old_values, d.new_values into v_old, v_new
      from change_log_diff(old_row, new_row,
                           array(select jsonb_object_keys(new_row)),
                           case when cfg.label_column is null then '{}'::text[] else array[cfg.label_column] end) d;
    if v_new is null and v_old is null then
      return null; -- only ignored bookkeeping columns changed
    end if;
    v_action := 'update';
    if cfg.archive_column is not null
       and (old_row -> cfg.archive_column) is distinct from (new_row -> cfg.archive_column) then
      v_action := case when (new_row ->> cfg.archive_column)::boolean = cfg.archived_value
                       then 'archive' else 'restore' end;
    end if;
  end if;

  select * into actor from change_log_actor(null);
  insert into change_log (user_id, user_email, user_name, table_name, record_id, action, old_values, new_values)
  values (actor.actor_id, actor.actor_email, actor.actor_name, tg_table_name,
          coalesce(new_row, old_row) ->> cfg.id_column, v_action, v_old, v_new);
  return null;
end;
$$;

-- The one-line hook for watching a table.
create or replace function enable_change_log(
  p_table regclass,
  p_id_column text default 'id',
  p_label_column text default null,
  p_ignore_columns text[] default '{}',
  p_archive_column text default null,
  p_archived_value boolean default true
) returns void
language plpgsql
as $$
declare
  v_name text := (select relname from pg_class where oid = p_table);
begin
  insert into change_log_tables (table_name, id_column, label_column, ignore_columns, archive_column, archived_value)
  values (v_name, p_id_column, p_label_column, p_ignore_columns, p_archive_column, p_archived_value)
  on conflict (table_name) do update set
    id_column = excluded.id_column,
    label_column = excluded.label_column,
    ignore_columns = excluded.ignore_columns,
    archive_column = excluded.archive_column,
    archived_value = excluded.archived_value;
  execute format('drop trigger if exists zz_change_log on %s', p_table);
  execute format('create trigger zz_change_log after insert or update or delete on %s '
                 'for each row execute function log_row_change()', p_table);
end;
$$;
-- These helpers are internal. Supabase grants new functions to its API roles by default, so
-- revoke explicitly: otherwise any signed-in account could, for example, call
-- change_log_actor() to look up staff names.
revoke all on function enable_change_log(regclass, text, text, text[], text, boolean) from public, anon, authenticated, service_role;
revoke all on function change_log_actor(text) from public, anon, authenticated, service_role;
revoke all on function change_log_diff(jsonb, jsonb, text[], text[]) from public, anon, authenticated, service_role;
revoke all on function log_row_change() from public, anon, authenticated, service_role;

-- Watched tables. updated_at / created_at / user_id are bookkeeping: the app refreshes them on
-- every sign-in, and they'd flood the log with entries nobody needs.
select enable_change_log('suppliers', 'id', 'name', array['created_at', 'updated_at', 'archived_at'], 'archived', true);
select enable_change_log('users', 'email', 'name', array['created_at', 'updated_at', 'user_id'], 'active', false);

-- Stock items aren't a table: they live inside the single app_state row as a JSON array. This
-- trigger compares the items before and after each save and logs one entry per changed item.
-- On-hand quantities ("q") and photos are deliberately not tracked: counts change constantly
-- and already have their own History screen in the app.
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
  actor record;
begin
  if tg_op = 'UPDATE' and jsonb_typeof(old.value -> 'data') = 'array' then old_items := old.value -> 'data'; end if;
  if jsonb_typeof(new.value -> 'data') = 'array' then new_items := new.value -> 'data'; end if;
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
  where o.key is null or n.key is null or d.new_values is not null or d.old_values is not null;

  return null;
end;
$$;

revoke all on function log_stock_item_changes() from public, anon, authenticated, service_role;

drop trigger if exists zz_change_log_stock_items on app_state;
create trigger zz_change_log_stock_items
  after insert or update of value on app_state
  for each row execute function log_stock_item_changes();

-- Read-only: nobody (including the server key) can edit, delete or empty the log.
create or replace function change_log_is_read_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'The change log is read-only: entries cannot be edited or deleted.';
end;
$$;

drop trigger if exists change_log_read_only on change_log;
create trigger change_log_read_only
  before update or delete on change_log
  for each row execute function change_log_is_read_only();

drop trigger if exists change_log_no_truncate on change_log;
create trigger change_log_no_truncate
  before truncate on change_log
  for each statement execute function change_log_is_read_only();
