-- Admin area, migration 3 of 3: manager-only access, enforced by row-level security.
--
-- The Worker calls Supabase for the admin area with the signed-in person's OWN token (not the
-- server key), so these policies are what actually decide who can read or change suppliers,
-- staff accounts and the change log. Anyone who isn't an active manager in the users table gets
-- nothing back, even if they call Supabase directly. Safe to re-run.

-- True when the signed-in person is an active manager.
create or replace function is_manager() returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from users
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role = 'manager'
      and active
  );
$$;
revoke all on function is_manager() from public, anon;
grant execute on function is_manager() to authenticated;

-- Suppliers: managers can view, add and edit. There is no delete: suppliers are archived.
revoke all on suppliers from anon, authenticated;
grant select, insert, update on suppliers to authenticated;
drop policy if exists "Managers can view suppliers" on suppliers;
create policy "Managers can view suppliers" on suppliers
  for select to authenticated using (is_manager());
drop policy if exists "Managers can add suppliers" on suppliers;
create policy "Managers can add suppliers" on suppliers
  for insert to authenticated with check (is_manager());
drop policy if exists "Managers can edit suppliers" on suppliers;
create policy "Managers can edit suppliers" on suppliers
  for update to authenticated using (is_manager()) with check (is_manager());

-- Staff accounts: managers can view, add and edit name / access level / status. No delete:
-- accounts are deactivated. The email address can't be changed once an account exists.
revoke all on users from anon, authenticated;
grant select on users to authenticated;
grant insert (email, name, role, active) on users to authenticated;
grant update (name, role, active, updated_at) on users to authenticated;
drop policy if exists "Managers can view staff accounts" on users;
create policy "Managers can view staff accounts" on users
  for select to authenticated using (is_manager());
drop policy if exists "Managers can add staff accounts" on users;
create policy "Managers can add staff accounts" on users
  for insert to authenticated with check (is_manager());
drop policy if exists "Managers can edit staff accounts" on users;
create policy "Managers can edit staff accounts" on users
  for update to authenticated using (is_manager()) with check (is_manager());

-- Nobody can remove their own manager access, and there must always be one active manager.
create or replace function users_protect_managers() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.role = 'manager' and old.active and not (new.role = 'manager' and new.active) then
    if old.email = lower(coalesce(auth.jwt() ->> 'email', '')) then
      raise exception 'You cannot remove your own manager access.';
    end if;
    if not exists (select 1 from users where role = 'manager' and active and email <> old.email) then
      raise exception 'There must always be at least one active manager.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists users_protect_managers on users;
create trigger users_protect_managers
  before update on users
  for each row execute function users_protect_managers();

-- Change log: managers can read it. No one is granted insert, update or delete; entries are
-- written only by the triggers from migration 2, which run as the table owner.
revoke all on change_log from anon, authenticated, service_role;
grant select on change_log to authenticated, service_role;
drop policy if exists "Managers can read the change log" on change_log;
create policy "Managers can read the change log" on change_log
  for select to authenticated using (is_manager());
revoke all on change_log_tables from anon, authenticated;

-- The admin screen's change log query. Runs with the caller's own rights, so the policy above
-- still applies. Dates are whole days in Hobart time.
create or replace function admin_change_log(
  p_from date default null,
  p_to date default null,
  p_user text default null,
  p_section text default null,
  p_action text default null,
  p_before bigint default null,
  p_limit integer default 100
) returns setof change_log
language sql
stable
security invoker
set search_path = public
as $$
  select * from change_log
  where (p_from is null or changed_at >= (p_from::timestamp at time zone 'Australia/Hobart'))
    and (p_to is null or changed_at < ((p_to + 1)::timestamp at time zone 'Australia/Hobart'))
    and (p_user is null or user_name = p_user)
    and (p_section is null or table_name = p_section)
    and (p_action is null or action = p_action)
    and (p_before is null or id < p_before)
  order by id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
revoke all on function admin_change_log(date, date, text, text, text, bigint, integer) from public, anon;
grant execute on function admin_change_log(date, date, text, text, text, bigint, integer) to authenticated;

-- Names for the "Person" filter on the change log screen.
create or replace function admin_change_log_people() returns table (user_name text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct c.user_name from change_log c order by 1;
$$;
revoke all on function admin_change_log_people() from public, anon;
grant execute on function admin_change_log_people() to authenticated;
