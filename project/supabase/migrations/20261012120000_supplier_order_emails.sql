-- Supplier order emails: venue settings, and a record of order requests sent to suppliers.
--
-- Apply to STAGING first, then to live BEFORE merging the app change (otherwise Admin → Settings
-- and the Reorder list's "Email order" button report that the database changes are missing).
-- Needs the three admin migrations (is_manager(), enable_change_log()). Safe to re-run.
--
-- The app never sends email. It builds an email for a person to review and send from their own
-- mail app, then that person confirms in the app that it was sent. Order references
-- (BAY-YYYYMMDD-NN) are handed out here so two devices can never get the same number.

-- ---------------------------------------------------------------------------------------------
-- Venue settings: one row, edited by managers in Admin → Settings.
create table if not exists venue_settings (
  id integer primary key default 1,
  venue_address text,
  venue_phone text,
  venue_email text,
  sender_name text,
  sender_role text,
  updated_at timestamptz not null default now(),
  constraint venue_settings_single_row check (id = 1),
  constraint venue_settings_email_format check (venue_email is null or venue_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
insert into venue_settings (id) values (1) on conflict (id) do nothing;

create or replace function venue_settings_before_write() returns trigger
language plpgsql
as $$
begin
  new.venue_address := nullif(btrim(new.venue_address), '');
  new.venue_phone := nullif(btrim(new.venue_phone), '');
  new.venue_email := nullif(btrim(new.venue_email), '');
  new.sender_name := nullif(btrim(new.sender_name), '');
  new.sender_role := nullif(btrim(new.sender_role), '');
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists venue_settings_before_write on venue_settings;
create trigger venue_settings_before_write
  before insert or update on venue_settings
  for each row execute function venue_settings_before_write();

alter table venue_settings enable row level security;
-- Managers can view and edit the single row. No insert or delete: the row above always exists.
revoke all on venue_settings from anon, authenticated;
grant select on venue_settings to authenticated;
grant update (venue_address, venue_phone, venue_email, sender_name, sender_role) on venue_settings to authenticated;
drop policy if exists "Managers can view venue settings" on venue_settings;
create policy "Managers can view venue settings" on venue_settings
  for select to authenticated using (is_manager());
drop policy if exists "Managers can edit venue settings" on venue_settings;
create policy "Managers can edit venue settings" on venue_settings
  for update to authenticated using (is_manager()) with check (is_manager());

-- ---------------------------------------------------------------------------------------------
-- Order requests. A row starts as a 'draft' the first time someone copies or opens the email
-- (that's when its reference is fixed), becomes 'sent' only when a person confirms they sent
-- it, and is never deleted: a draft that wasn't sent, or a sent order called off, is
-- 'cancelled' with a reason.
create table if not exists order_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  order_date date not null,              -- Hobart date the reference was handed out
  sequence integer not null,             -- the NN in BAY-YYYYMMDD-NN, per order_date
  supplier_id uuid references suppliers(id),
  supplier_name text not null,
  area text not null,
  status text not null default 'draft',
  items jsonb not null default '[]'::jsonb,
  delivery_date date,
  delivery_window text,
  order_notes text,
  email_to text,
  email_subject text,                    -- the final text, saved when marked as sent
  email_body text,
  created_at timestamptz not null default now(),
  created_by_email text,
  created_by_name text,
  sent_at timestamptz,
  sent_by_email text,
  sent_by_name text,
  cancelled_at timestamptz,
  cancelled_by_email text,
  cancelled_by_name text,
  cancel_reason text,
  updated_at timestamptz not null default now(),
  constraint order_requests_reference_unique unique (reference),
  constraint order_requests_day_sequence_unique unique (order_date, sequence),
  constraint order_requests_sequence_positive check (sequence >= 1),
  constraint order_requests_area_valid check (area in ('Bar', 'Kitchen', 'Barista')),
  constraint order_requests_status_valid check (status in ('draft', 'sent', 'cancelled')),
  constraint order_requests_items_array check (jsonb_typeof(items) = 'array')
);
create index if not exists idx_order_requests_status on order_requests (status, order_date desc);
create index if not exists idx_order_requests_supplier on order_requests (supplier_id, order_date desc);

alter table order_requests enable row level security;
-- Managers can read. Nobody writes directly: the functions below do every change.
revoke all on order_requests from anon, authenticated;
grant select on order_requests to authenticated;
drop policy if exists "Managers can view order requests" on order_requests;
create policy "Managers can view order requests" on order_requests
  for select to authenticated using (is_manager());

-- The signed-in manager making the request, or an error in plain English.
create or replace function order_request_actor(out actor_email text, out actor_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_manager() then
    raise exception 'Only managers can send supplier orders.';
  end if;
  actor_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select u.name into actor_name from users u where u.email = actor_email;
  actor_name := coalesce(actor_name, actor_email);
end;
$$;
revoke all on function order_request_actor() from public, anon, authenticated, service_role;

-- Starts a draft and hands out the next reference for today (Hobart time).
create or replace function create_order_request(
  p_supplier_id uuid,
  p_supplier_name text,
  p_area text,
  p_items jsonb,
  p_delivery_date date default null,
  p_delivery_window text default null,
  p_order_notes text default null,
  p_email_to text default null
) returns order_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  v_day date := (now() at time zone 'Australia/Hobart')::date;
  v_sequence integer;
  v_row order_requests;
begin
  select * into actor from order_request_actor();
  if coalesce(btrim(p_supplier_name), '') = '' then
    raise exception 'Choose a supplier for this order.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'There are no items in this order.';
  end if;
  -- One reference at a time per day, so two devices can't both take the same number.
  perform pg_advisory_xact_lock(hashtext('order_requests:' || v_day::text));
  select coalesce(max(sequence), 0) + 1 into v_sequence from order_requests where order_date = v_day;
  insert into order_requests (reference, order_date, sequence, supplier_id, supplier_name, area, items,
                              delivery_date, delivery_window, order_notes, email_to,
                              created_by_email, created_by_name)
  values ('BAY-' || to_char(v_day, 'YYYYMMDD') || '-' || case when v_sequence < 10 then '0' else '' end || v_sequence,
          v_day, v_sequence, p_supplier_id, btrim(p_supplier_name), p_area, p_items,
          p_delivery_date, nullif(btrim(p_delivery_window), ''), nullif(btrim(p_order_notes), ''),
          nullif(btrim(p_email_to), ''), actor.actor_email, actor.actor_name)
  returning * into v_row;
  return v_row;
end;
$$;

-- A person confirms they sent the email. Saves the final details and text as sent.
create or replace function mark_order_request_sent(
  p_id uuid,
  p_items jsonb,
  p_delivery_date date,
  p_delivery_window text,
  p_order_notes text,
  p_email_to text,
  p_email_subject text,
  p_email_body text
) returns order_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  v_row order_requests;
begin
  select * into actor from order_request_actor();
  select * into v_row from order_requests where id = p_id for update;
  if not found then
    raise exception 'That order couldn’t be found.';
  end if;
  if v_row.status = 'sent' then
    raise exception 'Order % was already marked as sent by %.', v_row.reference, v_row.sent_by_name;
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'Order % was cancelled, so it can’t be marked as sent. Start a new order instead.', v_row.reference;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'There are no items in this order.';
  end if;
  update order_requests set
    status = 'sent', items = p_items, delivery_date = p_delivery_date,
    delivery_window = nullif(btrim(p_delivery_window), ''), order_notes = nullif(btrim(p_order_notes), ''),
    email_to = nullif(btrim(p_email_to), ''), email_subject = p_email_subject, email_body = p_email_body,
    sent_at = now(), sent_by_email = actor.actor_email, sent_by_name = actor.actor_name, updated_at = now()
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

-- Discards a draft that wasn't sent, or calls off a sent order. Nothing is deleted.
create or replace function cancel_order_request(p_id uuid, p_reason text) returns order_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  v_row order_requests;
begin
  select * into actor from order_request_actor();
  select * into v_row from order_requests where id = p_id for update;
  if not found then
    raise exception 'That order couldn’t be found.';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'Order % has already been cancelled.', v_row.reference;
  end if;
  if v_row.status = 'sent' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for cancelling a sent order.';
  end if;
  update order_requests set
    status = 'cancelled', cancel_reason = coalesce(nullif(btrim(p_reason), ''), 'Not sent'),
    cancelled_at = now(), cancelled_by_email = actor.actor_email, cancelled_by_name = actor.actor_name,
    updated_at = now()
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function create_order_request(uuid, text, text, jsonb, date, text, text, text) from public, anon;
revoke all on function mark_order_request_sent(uuid, jsonb, date, text, text, text, text, text) from public, anon;
revoke all on function cancel_order_request(uuid, text) from public, anon;
grant execute on function create_order_request(uuid, text, text, jsonb, date, text, text, text) to authenticated;
grant execute on function mark_order_request_sent(uuid, jsonb, date, text, text, text, text, text) to authenticated;
grant execute on function cancel_order_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Change log. The email text is kept on the order itself, so it's left out of the log.
select enable_change_log('venue_settings', 'id', null, array['updated_at']);
select enable_change_log('order_requests', 'id', 'reference',
                         array['updated_at', 'created_at', 'email_subject', 'email_body',
                               'created_by_email', 'sent_by_email', 'cancelled_by_email']);
