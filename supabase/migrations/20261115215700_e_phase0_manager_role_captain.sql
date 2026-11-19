-- Back-filled on 19 November 2026 from production
-- (supabase_migrations.schema_migrations, version 20261115215700): applied
-- there on 15 November 2026 but never committed. Kept verbatim so a fresh
-- database gets is_captain, set_captain and can_manage_session. The column
-- grants that stop a player from setting is_captain on their own row are in
-- 20261118200000_captain_roles_presence.

-- Phase 0 (Planning rework + team sessions): add the "manager" role and a
-- per-player "captain" flag, plus two new, narrower permission helpers.
-- is_group_staff (owner/coach/analyst) is left untouched on purpose — it
-- still gates dev plans, VOD review, trials, staff notes, sharing/invites.
-- Calendar-ish features (Phase 1+) read the new helpers instead.

alter table public.group_members drop constraint group_members_role_check;
alter table public.group_members add constraint group_members_role_check
  check (role = any (array['owner', 'coach', 'manager', 'analyst', 'player']));

alter table public.group_invites drop constraint group_invites_role_check;
alter table public.group_invites add constraint group_invites_role_check
  check (role = any (array['coach', 'manager', 'analyst', 'player']));

alter table public.group_members add column is_captain boolean not null default false;

-- Owner-only, and a captain can never flip their own flag off via this path
-- (the using-clause re-checks group_role on every call, including by a
-- captain who was also promoted to a staff role and might otherwise think
-- they can self-manage it).
create or replace function public.set_captain(p_group uuid, p_user uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.group_role(p_group) is distinct from 'owner' then
    raise exception 'FORBIDDEN';
  end if;
  update public.group_members set is_captain = p_value where group_id = p_group and user_id = p_user;
end;
$$;

create or replace function private.can_edit_calendar(p_group uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = p_user and role in ('owner', 'coach', 'manager')
  )
$$;

create or replace function private.can_manage_session(p_group uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = p_user
      and (role in ('owner', 'coach', 'manager') or is_captain)
  )
$$;
