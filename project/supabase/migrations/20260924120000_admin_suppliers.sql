-- Admin area, migration 1 of 3: the suppliers table.
--
-- Apply to STAGING first (see README.md, "Admin area"). Run supabase/schema.sql first on a
-- fresh project. Every statement here is safe to re-run.
--
-- There was no suppliers table before this: each stock item only carries a free-text supplier
-- name (the "s" field inside app_state.value.data). This migration creates the table and
-- pre-fills it with those names. Stock items are NOT linked to this table yet.

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rep_name text,
  phone text,
  order_email text,
  order_days text[] not null default '{}',
  order_cutoff time,
  delivery_days text[] not null default '{}',
  min_order_aud numeric(10,2),
  account_number text,
  notes text,
  archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_required check (length(btrim(name)) > 0),
  constraint suppliers_order_email_format check (order_email is null or order_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint suppliers_min_order_not_negative check (min_order_aud is null or min_order_aud >= 0),
  constraint suppliers_order_days_valid check (order_days <@ array['Mon','Tue','Wed','Thu','Fri','Sat','Sun']),
  constraint suppliers_delivery_days_valid check (delivery_days <@ array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])
);

-- Supplier names are unique regardless of capitals or stray spaces ("Bidfood" = " bidfood ").
create unique index if not exists suppliers_name_unique on suppliers (lower(btrim(name)));
create index if not exists idx_suppliers_archived_name on suppliers (archived, name);

-- Tidies input and keeps the bookkeeping columns honest no matter who writes the row.
create or replace function suppliers_before_write() returns trigger
language plpgsql
as $$
begin
  new.name := btrim(new.name);
  new.order_email := nullif(btrim(new.order_email), '');
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.updated_at := now();
    if new.archived is distinct from old.archived then
      new.archived_at := case when new.archived then now() end;
    else
      new.archived_at := old.archived_at;
    end if;
  else
    new.archived_at := case when new.archived then now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists suppliers_before_write on suppliers;
create trigger suppliers_before_write
  before insert or update on suppliers
  for each row execute function suppliers_before_write();

-- Locked down straight away; the manager-only policies are added in migration 3.
alter table suppliers enable row level security;

-- Pre-fill from the supplier names already on stock items. This runs before the change log
-- exists (migration 2), so the starting list isn't recorded as dozens of "added" entries.
insert into suppliers (name)
select distinct on (lower(btrim(item->>'s'))) btrim(item->>'s')
from app_state,
     jsonb_array_elements(
       case when jsonb_typeof(app_state.value->'data') = 'array' then app_state.value->'data' else '[]'::jsonb end
     ) as item
where coalesce(btrim(item->>'s'), '') <> ''
  and lower(btrim(item->>'s')) <> 'unassigned supplier'
order by lower(btrim(item->>'s')), btrim(item->>'s')
on conflict (lower(btrim(name))) do nothing;
