-- Wellbeing consent proof (legal texts v0.3, accepted by the user on 19/11/2026).
--
-- Wellbeing check-ins are health data (GDPR art. 9): they need explicit
-- consent, and that consent must be provable. This adds:
--   - wellbeing_consent_events, an append-only log, one row per grant or
--     withdrawal, timestamped by the server with the text version accepted
--   - set_wellbeing_consent(granted, version), the only way to write it.
--     A withdrawal, in the same transaction, deletes the user's check-ins
--     and turns share_wellbeing off in all their groups
--   - a new check-in requires the consent to be currently granted, and so
--     does turning share_wellbeing on (trigger on group_sharing).
--
-- Check-ins exist only here (no local SQLite copy, not in sync_records), so
-- deleting them here deletes them everywhere.
-- Not applied anywhere yet: production needs the user's go-ahead.

create table if not exists public.wellbeing_consent_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  granted    boolean not null,
  version    text not null check (version ~ '^v[0-9]+\.[0-9]+$'),
  created_at timestamptz not null default now()
);
create index if not exists wellbeing_consent_events_user_idx on public.wellbeing_consent_events (user_id, created_at desc);

alter table public.wellbeing_consent_events enable row level security;

-- Read your own history. No insert, update or delete policy: rows are only
-- written by set_wellbeing_consent, and never changed afterwards.
drop policy if exists "wellbeing_consent_read_own" on public.wellbeing_consent_events;
create policy "wellbeing_consent_read_own" on public.wellbeing_consent_events for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.wellbeing_consent_events from anon, authenticated;

-- True when the CALLER's latest consent event is a grant. No user parameter:
-- callable by any signed-in user, it must not tell whether someone else
-- consented (CyberSecurity review).
create or replace function private.has_wellbeing_consent()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select e.granted from public.wellbeing_consent_events e
    where e.user_id = auth.uid()
    order by e.created_at desc, e.id desc
    limit 1
  ), false)
$$;
revoke all on function private.has_wellbeing_consent() from public, anon;
grant execute on function private.has_wellbeing_consent() to authenticated;

-- share_wellbeing cannot be turned on without a current consent of the row's
-- owner (the screens block it too). Turning it off is always allowed: a
-- withdrawal does exactly that. Not callable through the API (trigger only).
create or replace function private.group_sharing_wellbeing_needs_consent()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.share_wellbeing and (tg_op = 'INSERT' or not coalesce(old.share_wellbeing, false)) then
    if not coalesce((
      select e.granted from public.wellbeing_consent_events e
      where e.user_id = new.user_id
      order by e.created_at desc, e.id desc
      limit 1
    ), false) then
      raise exception 'WELLBEING_CONSENT_REQUIRED' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function private.group_sharing_wellbeing_needs_consent() from public, anon, authenticated;
drop trigger if exists group_sharing_wellbeing_needs_consent on public.group_sharing;
create trigger group_sharing_wellbeing_needs_consent
  before insert or update of share_wellbeing on public.group_sharing
  for each row execute function private.group_sharing_wellbeing_needs_consent();

create or replace function public.set_wellbeing_consent(p_granted boolean, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'LOGIN_REQUIRED' using errcode = '42501';
  end if;
  if p_version is null or p_version !~ '^v[0-9]+\.[0-9]+$' then
    raise exception 'INVALID_VERSION' using errcode = '22023';
  end if;
  insert into public.wellbeing_consent_events (user_id, granted, version) values (uid, p_granted, p_version);
  if not p_granted then
    delete from public.wellbeing_checkins where user_id = uid;
    update public.group_sharing set share_wellbeing = false where user_id = uid and share_wellbeing;
  end if;
end
$$;
revoke execute on function public.set_wellbeing_consent(boolean, text) from public, anon;
grant execute on function public.set_wellbeing_consent(boolean, text) to authenticated;

-- A check-in needs a current consent. Reading, updating and deleting your
-- own check-ins stay open (deleting must work without consent).
drop policy if exists "wellbeing_checkins_write_own" on public.wellbeing_checkins;
drop policy if exists "wellbeing_checkins_insert_with_consent" on public.wellbeing_checkins;
drop policy if exists "wellbeing_checkins_update_own" on public.wellbeing_checkins;
drop policy if exists "wellbeing_checkins_delete_own" on public.wellbeing_checkins;
create policy "wellbeing_checkins_insert_with_consent" on public.wellbeing_checkins for insert to authenticated
  with check (user_id = (select auth.uid()) and private.has_wellbeing_consent());
create policy "wellbeing_checkins_update_own" on public.wellbeing_checkins for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "wellbeing_checkins_delete_own" on public.wellbeing_checkins for delete to authenticated
  using (user_id = (select auth.uid()));
