-- Group management (18 November 2026):
--   1. members change roles from the group panel (owner only);
--   2. the captain gets the manager's rights (planning, availability,
--      announcements, event requests, live calendar link) — team sessions
--      already accepted them;
--   3. a player answers an event (present / can't come); the management
--      hears about an absence in the app and, through the Discord bot, in a
--      direct message;
--   4. fix found on the way: a player could set is_captain on their own row
--      (column UPDATE privileges were the table's).
-- Requires e_phase0_manager_role_captain (role 'manager', is_captain,
-- private.can_edit_calendar, private.can_manage_session) and
-- 20261118195000_notification_types_fix (the notification types used here).

-- ── 4a. group_members: a member edits only their own profile fields ─────────
-- Same columns as 20261118160000_member_profile_look, so this migration
-- stands on its own whichever is applied first.
alter table public.group_members
  add column if not exists profile_icon text
    check (profile_icon is null or profile_icon ~ '^[a-z0-9_-]{1,32}$'),
  add column if not exists profile_banner text
    check (profile_banner is null or profile_banner ~ '^[a-z0-9_-]{1,32}$');

-- Role, captaincy, group and dates only change through the SECURITY DEFINER
-- functions (create_group, join_group, set_captain, set_member_role).
revoke update on public.group_members from anon, authenticated;
grant update (display_name, riot_id, profile_icon, profile_banner) on public.group_members to authenticated;

-- ── 2. Captain = manager for everything calendar-side ──────────────────────
create or replace function private.can_edit_calendar(p_group uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = p_user
      and (role in ('owner', 'coach', 'manager') or is_captain)
  )
$$;

-- The live calendar link was staff-only (owner/coach/analyst) while its
-- button showed for every calendar editor: managers and captains got a 403.
drop policy if exists "calendar_subscriptions_staff" on public.calendar_subscriptions;
create policy "calendar_subscriptions_staff" on public.calendar_subscriptions for all to authenticated
  using (private.is_group_staff(group_id) or private.can_edit_calendar(group_id))
  with check (private.is_group_staff(group_id) or private.can_edit_calendar(group_id));

-- Event requests reach the captains too.
create or replace function public.notify_calendar_event_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare staffer record;
declare requester_name text;
begin
  select display_name into requester_name from public.group_members where group_id = new.group_id and user_id = new.requested_by;
  for staffer in
    select user_id from public.group_members
    where group_id = new.group_id and (role in ('owner', 'coach', 'manager') or is_captain) and user_id <> new.requested_by
  loop
    perform private.notify(staffer.user_id, 'calendar_event_request',
      jsonb_build_object('groupId', new.group_id, 'requestId', new.id, 'eventName', new.event_name, 'requestedByName', coalesce(requester_name, '?')),
      '/coaching');
  end loop;
  return new;
end;
$$;

-- ── 1. Roles, from the group panel ─────────────────────────────────────────
create or replace function public.set_member_role(p_group uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.group_role(p_group) is distinct from 'owner' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_role not in ('coach', 'manager', 'analyst', 'player') then
    raise exception 'INVALID_ROLE' using errcode = '22023';
  end if;
  -- The owner stays owner: ownership is not handed over from here.
  update public.group_members set role = p_role
  where group_id = p_group and user_id = p_user and role <> 'owner';
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

-- ── 4b. Notification types ─────────────────────────────────────────────────
-- In 20261118195000_notification_types_fix (applied on its own, first): it
-- already allows event_declined / event_confirmed used below.

-- ── 3. Presence answers ────────────────────────────────────────────────────
create table if not exists public.calendar_event_responses (
  event_id     uuid not null references public.calendar_events (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  status       text not null check (status in ('confirmed', 'declined')),
  note         text check (note is null or length(note) <= 300),
  responded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists calendar_event_responses_user_idx on public.calendar_event_responses (user_id);

alter table public.calendar_event_responses enable row level security;
-- Everyone in the group sees who answered what; writes go through
-- respond_to_calendar_event only (no write policy).
drop policy if exists "calendar_event_responses_read" on public.calendar_event_responses;
create policy "calendar_event_responses_read" on public.calendar_event_responses for select to authenticated
  using (exists (
    select 1 from public.calendar_events e
    where e.id = calendar_event_responses.event_id and private.group_role(e.group_id) is not null
  ));

-- A player answers an event that concerns them (listed attendee, or an
-- event without a list) and hasn't ended. The management (owner, coaches,
-- managers, captains) is told when someone can't come, and when someone who
-- couldn't finally can.
create or replace function public.respond_to_calendar_event(p_event uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.calendar_events;
  v_previous text;
  v_name text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  staffer record;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_status not in ('confirmed', 'declined') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  select * into v_event from public.calendar_events where id = p_event;
  if v_event.id is null or private.group_role(v_event.group_id, v_uid) is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_event.ends_at < now() then
    raise exception 'EVENT_OVER' using errcode = '22023';
  end if;
  if exists (select 1 from public.calendar_event_attendees where event_id = p_event)
     and not exists (select 1 from public.calendar_event_attendees where event_id = p_event and user_id = v_uid) then
    raise exception 'NOT_CONCERNED' using errcode = '42501';
  end if;

  select status into v_previous from public.calendar_event_responses where event_id = p_event and user_id = v_uid;
  insert into public.calendar_event_responses (event_id, user_id, status, note, responded_at)
  values (p_event, v_uid, p_status, v_note, now())
  on conflict (event_id, user_id) do update
    set status = excluded.status, note = excluded.note, responded_at = excluded.responded_at;

  if v_previous is distinct from p_status and (p_status = 'declined' or v_previous = 'declined') then
    select display_name into v_name from public.group_members where group_id = v_event.group_id and user_id = v_uid;
    for staffer in
      select user_id from public.group_members
      where group_id = v_event.group_id and user_id <> v_uid
        and (role in ('owner', 'coach', 'manager') or is_captain)
    loop
      perform private.notify(staffer.user_id,
        case when p_status = 'declined' then 'event_declined' else 'event_confirmed' end,
        jsonb_build_object(
          'groupId', v_event.group_id, 'eventId', p_event, 'eventTitle', v_event.title,
          'scheduledAt', v_event.starts_at, 'playerId', v_uid, 'playerName', coalesce(v_name, '?'), 'note', v_note
        ),
        '/coaching');
    end loop;
  end if;
end;
$$;
revoke execute on function public.respond_to_calendar_event(uuid, text, text) from public, anon;
grant execute on function public.respond_to_calendar_event(uuid, text, text) to authenticated;

-- Discord direct messages already sent for a notification (the bot's cron,
-- service role only — RLS on, no policy).
create table if not exists public.discord_dm_sent (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  sent_at         timestamptz not null default now()
);
alter table public.discord_dm_sent enable row level security;
