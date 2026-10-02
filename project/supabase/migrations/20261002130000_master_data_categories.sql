-- Master data: categories and subgroups for each stock area (Admin → Master data → Categories).
--
-- Apply to STAGING first. Needs the three admin migrations (20260924*) already in place. Every
-- statement here is safe to re-run.
--
-- Until now the category list was built into the page, and each stock item only carries its
-- category ("c") and subgroup ("group") as text inside app_state.value.data. These tables hold
-- the lists and their order. Items still store the names, so renaming a category or subgroup
-- goes through the functions below, which change the list and every item using it in one
-- transaction. A category or subgroup can only be deleted once no item uses it.
--
-- The first run pre-fills the tables from the page's built-in lists plus every category and
-- subgroup already used by an item. Later runs leave the lists alone, so a category deleted in
-- the Admin area doesn't come back.

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  name text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_area_valid check (area in ('Bar', 'Kitchen', 'Barista')),
  constraint categories_name_required check (length(btrim(name)) > 0),
  constraint categories_name_length check (length(name) <= 80)
);
-- Names are unique within an area regardless of capitals or stray spaces.
create unique index if not exists categories_name_unique on categories (area, lower(btrim(name)));
create index if not exists idx_categories_area_order on categories (area, sort_order);

create table if not exists subgroups (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories (id) on delete restrict,
  name text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subgroups_name_required check (length(btrim(name)) > 0),
  constraint subgroups_name_length check (length(name) <= 80),
  -- The stock page already lists items without a subgroup under "Other".
  constraint subgroups_name_not_other check (lower(btrim(name)) <> 'other')
);
create unique index if not exists subgroups_name_unique on subgroups (category_id, lower(btrim(name)));
create index if not exists idx_subgroups_category_order on subgroups (category_id, sort_order);

-- Tidies names, puts new entries at the end of their list and keeps bookkeeping honest.
create or replace function master_data_before_write() returns trigger
language plpgsql
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    if new.sort_order is null then
      if tg_table_name = 'categories' then
        select coalesce(max(sort_order), 0) + 10 into new.sort_order from categories where area = new.area;
      else
        select coalesce(max(sort_order), 0) + 10 into new.sort_order from subgroups where category_id = new.category_id;
      end if;
    end if;
  else
    new.created_at := old.created_at;
    new.updated_at := now();
    -- Nested, not "and": the record only has the fields of its own table.
    if tg_table_name = 'categories' then
      if new.area is distinct from old.area then
        raise exception 'A category can’t be moved to another area.';
      end if;
    elsif new.category_id is distinct from old.category_id then
      raise exception 'A subgroup can’t be moved to another category.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists categories_before_write on categories;
create trigger categories_before_write
  before insert or update on categories
  for each row execute function master_data_before_write();
drop trigger if exists subgroups_before_write on subgroups;
create trigger subgroups_before_write
  before insert or update on subgroups
  for each row execute function master_data_before_write();

-- First run only: pre-fill from the page's built-in lists, then anything items already use.
-- Runs before the change log is switched on below, so the starting lists aren't logged as
-- dozens of "added" entries.
do $$
begin
  if exists (select 1 from categories) then
    return;
  end if;

  insert into categories (area, name, sort_order)
  select area, name, ord * 10
  from (values
    ('Bar', array['Spirits', 'Beer', 'Wine', 'Mixers', 'Garnishes & perishables', 'Equipment']),
    ('Kitchen', array['Produce & perishables', 'Meat & seafood', 'Bread', 'Dry store', 'Dairy & refrigerated', 'Frozen', 'Consumables', 'Equipment']),
    ('Barista', array['Retail Items', 'Stationery and Point of Sale', 'Coffee and Hot Beverage Ingredients', 'Syrups', 'Tea',
                      'Milk, Alternative Milk and Cream', 'Juice, Water and Cold Drinks', 'Takeaway Packaging and Consumables',
                      'Kitchen and Food-Handling Consumables', 'Cleaning Chemicals'])
  ) as defaults(area, names),
  unnest(names) with ordinality as n(name, ord);

  -- Categories found on items but missing from the built-in lists go at the end, A to Z.
  insert into categories (area, name, sort_order)
  select area, name,
         (select max(sort_order) from categories c where c.area = found.area) + 10 * row_number() over (partition by area order by lower(name))
  from (
    select distinct on (e ->> 'a', lower(btrim(e ->> 'c'))) e ->> 'a' as area, btrim(e ->> 'c') as name
    from app_state, jsonb_array_elements(
      case when jsonb_typeof(app_state.value -> 'data') = 'array' then app_state.value -> 'data' else '[]'::jsonb end) e
    where e ->> 'a' in ('Bar', 'Kitchen', 'Barista') and coalesce(btrim(e ->> 'c'), '') <> ''
    order by e ->> 'a', lower(btrim(e ->> 'c')), btrim(e ->> 'c')
  ) found
  where not exists (select 1 from categories c where c.area = found.area and lower(c.name) = lower(found.name));

  -- Subgroups in use, A to Z within each category (the order the stock page showed them in).
  insert into subgroups (category_id, name, sort_order)
  select category_id, name, 10 * row_number() over (partition by category_id order by lower(name))
  from (
    select distinct on (c.id, lower(btrim(e ->> 'group'))) c.id as category_id, btrim(e ->> 'group') as name
    from app_state
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(app_state.value -> 'data') = 'array' then app_state.value -> 'data' else '[]'::jsonb end) e
    join categories c on c.area = e ->> 'a' and lower(c.name) = lower(btrim(e ->> 'c'))
    where coalesce(btrim(e ->> 'group'), '') <> '' and lower(btrim(e ->> 'group')) <> 'other'
    order by c.id, lower(btrim(e ->> 'group')), btrim(e ->> 'group')
  ) found;
end;
$$;

select enable_change_log('categories', 'id', 'name', array['created_at', 'updated_at']);
select enable_change_log('subgroups', 'id', 'name', array['created_at', 'updated_at']);

-- Managers can read the lists. All changes go through the functions below, so nobody is
-- granted insert, update or delete on the tables themselves.
alter table categories enable row level security;
alter table subgroups enable row level security;
revoke all on categories from anon, authenticated;
revoke all on subgroups from anon, authenticated;
grant select on categories to authenticated;
grant select on subgroups to authenticated;
drop policy if exists "Managers can view categories" on categories;
create policy "Managers can view categories" on categories
  for select to authenticated using (is_manager());
drop policy if exists "Managers can view subgroups" on subgroups;
create policy "Managers can view subgroups" on subgroups
  for select to authenticated using (is_manager());

-- Shared by the functions below: stops anyone who isn't an active manager.
create or replace function master_data_require_manager() returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_manager() then
    raise exception 'Only managers can do this.' using errcode = '42501';
  end if;
end;
$$;

-- Rewrites one field on the stock items that match, and bumps the revision so a page that was
-- already open has to reload before it can save over the change. Does nothing (and leaves the
-- revision alone) when no item matches. Returns how many items changed.
create or replace function master_data_rewrite_items(
  p_area text, p_category text, p_group text, p_field text, p_value text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matches integer;
  v_actor text := coalesce(lower(nullif(btrim(auth.jwt() ->> 'email'), '')), 'Supabase dashboard');
begin
  perform 1 from app_state where id = 1 for update;
  select count(*) into v_matches
  from app_state, jsonb_array_elements(
    case when jsonb_typeof(app_state.value -> 'data') = 'array' then app_state.value -> 'data' else '[]'::jsonb end) e
  where app_state.id = 1
    and e ->> 'a' = p_area
    and lower(btrim(e ->> 'c')) = lower(p_category)
    and (p_group is null or lower(btrim(e ->> 'group')) = lower(p_group));
  if v_matches = 0 then
    return 0;
  end if;

  update app_state
     set value = jsonb_set(value, '{data}', (
           select jsonb_agg(
                    case when e ->> 'a' = p_area
                          and lower(btrim(e ->> 'c')) = lower(p_category)
                          and (p_group is null or lower(btrim(e ->> 'group')) = lower(p_group))
                         then jsonb_set(e, array[p_field], to_jsonb(p_value))
                         else e end
                    order by ord)
           from jsonb_array_elements(value -> 'data') with ordinality as t(e, ord))),
         revision = revision + 1,
         updated_at = now(),
         updated_by = v_actor
   where id = 1;
  return v_matches;
end;
$$;

-- Counts the stock items (including discontinued ones) in a category, or in one of its subgroups.
create or replace function master_data_item_count(p_area text, p_category text, p_group text default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from app_state, jsonb_array_elements(
    case when jsonb_typeof(app_state.value -> 'data') = 'array' then app_state.value -> 'data' else '[]'::jsonb end) e
  where app_state.id = 1
    and e ->> 'a' = p_area
    and lower(btrim(e ->> 'c')) = lower(p_category)
    and (p_group is null or lower(btrim(e ->> 'group')) = lower(p_group));
$$;

create or replace function add_category(p_area text, p_name text) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform master_data_require_manager();
  insert into categories (area, name) values (p_area, p_name) returning id into v_id;
  return v_id;
end;
$$;

create or replace function rename_category(p_id uuid, p_name text) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old categories%rowtype;
  v_new_name text := btrim(coalesce(p_name, ''));
begin
  perform master_data_require_manager();
  select * into v_old from categories where id = p_id for update;
  if not found then
    raise exception 'That category couldn’t be found.';
  end if;
  if v_new_name = v_old.name then
    return 0;
  end if;
  update categories set name = v_new_name where id = p_id;
  return master_data_rewrite_items(v_old.area, v_old.name, null, 'c', v_new_name);
end;
$$;

create or replace function delete_category(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat categories%rowtype;
  v_items integer;
begin
  perform master_data_require_manager();
  select * into v_cat from categories where id = p_id for update;
  if not found then
    raise exception 'That category couldn’t be found.';
  end if;
  v_items := master_data_item_count(v_cat.area, v_cat.name);
  if v_items > 0 then
    raise exception '% still has % item%, including any discontinued ones. Move them to another category first.',
      v_cat.name, v_items, case when v_items = 1 then '' else 's' end;
  end if;
  if (select count(*) from categories where area = v_cat.area) <= 1 then
    raise exception 'The % area needs at least one category.', v_cat.area;
  end if;
  delete from subgroups where category_id = p_id;
  delete from categories where id = p_id;
end;
$$;

-- Swaps a category with its neighbour above (p_up = true) or below in the same area.
create or replace function move_category(p_id uuid, p_up boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat categories%rowtype;
  v_other categories%rowtype;
begin
  perform master_data_require_manager();
  select * into v_cat from categories where id = p_id for update;
  if not found then
    raise exception 'That category couldn’t be found.';
  end if;
  if p_up then
    select * into v_other from categories where area = v_cat.area and (sort_order, id) < (v_cat.sort_order, v_cat.id)
      order by sort_order desc, id desc limit 1 for update;
  else
    select * into v_other from categories where area = v_cat.area and (sort_order, id) > (v_cat.sort_order, v_cat.id)
      order by sort_order, id limit 1 for update;
  end if;
  if not found then
    return;
  end if;
  if v_other.sort_order = v_cat.sort_order then
    -- Equal positions can't be swapped: number the area's list 10, 20, 30… in its current order first.
    update categories c set sort_order = r.pos * 10
      from (select id, row_number() over (order by sort_order, id) as pos from categories where area = v_cat.area) r
     where c.id = r.id and c.sort_order <> r.pos * 10;
    select sort_order into v_cat.sort_order from categories where id = v_cat.id;
    select sort_order into v_other.sort_order from categories where id = v_other.id;
  end if;
  update categories set sort_order = v_other.sort_order where id = v_cat.id;
  update categories set sort_order = v_cat.sort_order where id = v_other.id;
end;
$$;

create or replace function add_subgroup(p_category_id uuid, p_name text) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform master_data_require_manager();
  if not exists (select 1 from categories where id = p_category_id) then
    raise exception 'That category couldn’t be found.';
  end if;
  insert into subgroups (category_id, name) values (p_category_id, p_name) returning id into v_id;
  return v_id;
end;
$$;

create or replace function rename_subgroup(p_id uuid, p_name text) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old subgroups%rowtype;
  v_cat categories%rowtype;
  v_new_name text := btrim(coalesce(p_name, ''));
begin
  perform master_data_require_manager();
  select * into v_old from subgroups where id = p_id for update;
  if not found then
    raise exception 'That subgroup couldn’t be found.';
  end if;
  if v_new_name = v_old.name then
    return 0;
  end if;
  select * into v_cat from categories where id = v_old.category_id;
  update subgroups set name = v_new_name where id = p_id;
  return master_data_rewrite_items(v_cat.area, v_cat.name, v_old.name, 'group', v_new_name);
end;
$$;

create or replace function delete_subgroup(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub subgroups%rowtype;
  v_cat categories%rowtype;
  v_items integer;
begin
  perform master_data_require_manager();
  select * into v_sub from subgroups where id = p_id for update;
  if not found then
    raise exception 'That subgroup couldn’t be found.';
  end if;
  select * into v_cat from categories where id = v_sub.category_id;
  v_items := master_data_item_count(v_cat.area, v_cat.name, v_sub.name);
  if v_items > 0 then
    raise exception '% still has % item%, including any discontinued ones. Move them to another subgroup first.',
      v_sub.name, v_items, case when v_items = 1 then '' else 's' end;
  end if;
  delete from subgroups where id = p_id;
end;
$$;

create or replace function move_subgroup(p_id uuid, p_up boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub subgroups%rowtype;
  v_other subgroups%rowtype;
begin
  perform master_data_require_manager();
  select * into v_sub from subgroups where id = p_id for update;
  if not found then
    raise exception 'That subgroup couldn’t be found.';
  end if;
  if p_up then
    select * into v_other from subgroups where category_id = v_sub.category_id and (sort_order, id) < (v_sub.sort_order, v_sub.id)
      order by sort_order desc, id desc limit 1 for update;
  else
    select * into v_other from subgroups where category_id = v_sub.category_id and (sort_order, id) > (v_sub.sort_order, v_sub.id)
      order by sort_order, id limit 1 for update;
  end if;
  if not found then
    return;
  end if;
  if v_other.sort_order = v_sub.sort_order then
    update subgroups s set sort_order = r.pos * 10
      from (select id, row_number() over (order by sort_order, id) as pos from subgroups where category_id = v_sub.category_id) r
     where s.id = r.id and s.sort_order <> r.pos * 10;
    select sort_order into v_sub.sort_order from subgroups where id = v_sub.id;
    select sort_order into v_other.sort_order from subgroups where id = v_other.id;
  end if;
  update subgroups set sort_order = v_other.sort_order where id = v_sub.id;
  update subgroups set sort_order = v_sub.sort_order where id = v_other.id;
end;
$$;

-- Internal helpers: not callable through the API at all.
revoke all on function master_data_before_write() from public, anon, authenticated, service_role;
revoke all on function master_data_require_manager() from public, anon, authenticated, service_role;
revoke all on function master_data_rewrite_items(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function master_data_item_count(text, text, text) from public, anon, authenticated, service_role;

-- The Admin screen's actions. Each one checks for an active manager itself.
revoke all on function add_category(text, text) from public, anon;
revoke all on function rename_category(uuid, text) from public, anon;
revoke all on function delete_category(uuid) from public, anon;
revoke all on function move_category(uuid, boolean) from public, anon;
revoke all on function add_subgroup(uuid, text) from public, anon;
revoke all on function rename_subgroup(uuid, text) from public, anon;
revoke all on function delete_subgroup(uuid) from public, anon;
revoke all on function move_subgroup(uuid, boolean) from public, anon;
grant execute on function add_category(text, text) to authenticated;
grant execute on function rename_category(uuid, text) to authenticated;
grant execute on function delete_category(uuid) to authenticated;
grant execute on function move_category(uuid, boolean) to authenticated;
grant execute on function add_subgroup(uuid, text) to authenticated;
grant execute on function rename_subgroup(uuid, text) to authenticated;
grant execute on function delete_subgroup(uuid) to authenticated;
grant execute on function move_subgroup(uuid, boolean) to authenticated;
