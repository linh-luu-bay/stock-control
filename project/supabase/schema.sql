-- Bay Bellerive stock control — Supabase (Postgres) schema.
-- Run this once in the Supabase SQL Editor for a fresh project (Dashboard → SQL Editor → New query → Run).
-- This is the Postgres/Supabase counterpart to drizzle/0000_shared_trial.sql (the D1/SQLite
-- version); the two are not interchangeable and only one storage backend is used at a time.

create table if not exists users (
  email text primary key,
  user_id text unique,
  name text not null,
  role text not null default 'staff' check (role in ('manager', 'supervisor', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_users_role_active on users(role, active);

create table if not exists app_state (
  id integer primary key check (id = 1),
  value jsonb not null,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

create table if not exists audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_email text not null,
  actor_name text not null,
  actor_role text not null,
  action text not null,
  details jsonb
);
create index if not exists idx_audit_events_occurred_at on audit_events(occurred_at);
create index if not exists idx_audit_events_actor_email on audit_events(actor_email);

-- Lock every table down by default. Only the service_role key (used exclusively by the
-- Worker backend, never by the browser) bypasses RLS. The anon key -- and any future
-- browser-side Supabase usage -- gets zero access, because no policies are defined for
-- it here. The Worker still enforces its own authorization on top of this (see
-- server-template.js); this RLS lockout is a second, independent layer, not a replacement.
alter table users enable row level security;
alter table app_state enable row level security;
alter table audit_events enable row level security;

-- Atomically applies an optimistic-lock update to app_state and records a pre-update
-- recovery snapshot in the SAME transaction -- this is the Postgres equivalent of the
-- D1 version's env.DB.batch([update, conditional-insert]) compare-and-swap. Returns the
-- new revision, or null if p_expected_revision no longer matches (someone saved first).
create or replace function save_app_state(
  p_expected_revision integer,
  p_value jsonb,
  p_stamp timestamptz,
  p_actor_email text,
  p_actor_name text,
  p_actor_role text,
  p_snapshot jsonb
) returns integer
language plpgsql
as $$
declare
  v_new_revision integer;
begin
  update app_state
    set value = p_value, revision = revision + 1, updated_at = p_stamp, updated_by = p_actor_email
    where id = 1 and revision = p_expected_revision
    returning revision into v_new_revision;

  if v_new_revision is null then
    return null;
  end if;

  insert into audit_events(occurred_at, actor_email, actor_name, actor_role, action, details)
    values (p_stamp, p_actor_email, p_actor_name, p_actor_role, 'recovery_snapshot', p_snapshot);

  return v_new_revision;
end;
$$;

revoke all on function save_app_state(integer, jsonb, timestamptz, text, text, text, jsonb) from public;
grant execute on function save_app_state(integer, jsonb, timestamptz, text, text, text, jsonb) to service_role;

-- Mirrors the original D1 upsert exactly: on conflict, only name/role/active/updated_at
-- change. user_id and created_at are left untouched on an existing account, same as
-- "ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role,active=excluded.active,updated_at=excluded.updated_at"
-- did in the D1 version.
create or replace function upsert_user(
  p_email text, p_name text, p_role text, p_active boolean, p_stamp timestamptz
) returns void
language sql
as $$
  insert into users(email, user_id, name, role, active, created_at, updated_at)
  values (p_email, null, p_name, p_role, p_active, p_stamp, p_stamp)
  on conflict (email) do update set
    name = excluded.name,
    role = excluded.role,
    active = excluded.active,
    updated_at = excluded.updated_at;
$$;

revoke all on function upsert_user(text, text, text, boolean, timestamptz) from public;
grant execute on function upsert_user(text, text, text, boolean, timestamptz) to service_role;
