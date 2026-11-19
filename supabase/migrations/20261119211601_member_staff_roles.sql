-- #39 (19 November 2026, model B validated by the user, CyberSecurity rules):
-- a group member keeps one main role (group_members.role, the "seat") and may
-- hold extra staff roles (staff_roles). A player who also coaches has
-- role = 'player' and staff_roles = '{coach}': they stay in the roster as a
-- player and get a coach's rights.
--
-- Rules:
--   - the effective roles of a member are {role} plus staff_roles, and every
--     rights check goes through private.has_group_role
--   - staff_roles only holds coach, manager or analyst, without duplicates,
--     never the main role itself, and stays empty for the owner
--   - only the owner writes it, through set_member_staff_roles (security
--     definer, empty search_path). Members never can (no column grant).
--   - wellbeing: a player-staff (role = 'player') never reads shared
--     wellbeing, nor gets wellbeing alerts. Reading it needs a staff role AND
--     a main role other than player.
--   - owner hand-over: coach, manager, analyst (main or extra), then the
--     captain, then the longest-standing player. On a tie, a staff member
--     who does not play comes before a player-staff.
--   - every assignment notifies the member and the rest of the group.
--   - the owner who also plays (also_plays, set by each owner for themself
--     through set_my_also_plays): counted as a player wherever the group's
--     players are listed (team roster, inactivity check), and like a
--     player-staff never reads shared wellbeing nor gets wellbeing alerts.
--     Only an owner can hold it (a member who plays has role = 'player').
--     On a hand-over, a player promoted to owner keeps playing.
--
-- Everyone starts with '{}': rights are unchanged until the owner assigns a
-- role. Older app versions ignore the column and keep working.
-- Re-runnable: if not exists, create or replace, drop ... if exists.

-- 1. The column ---------------------------------------------------------------

alter table public.group_members add column if not exists staff_roles text[] not null default '{}';

-- A check constraint cannot hold a subquery: the duplicate test lives in an immutable function.
create or replace function private.text_array_is_distinct(p text[])
returns boolean language sql immutable set search_path = ''
as $$ select cardinality(p) = (select count(distinct x) from unnest(p) as x) $$;
revoke all on function private.text_array_is_distinct(text[]) from public, anon;
grant execute on function private.text_array_is_distinct(text[]) to authenticated;

alter table public.group_members drop constraint if exists group_members_staff_roles_check;
alter table public.group_members add constraint group_members_staff_roles_check check (
  staff_roles <@ array['coach', 'manager', 'analyst']::text[]
  and private.text_array_is_distinct(staff_roles)
  and not (role = any(staff_roles))
  and (role <> 'owner' or cardinality(staff_roles) = 0)
);

-- The owner who also plays (user request, 19 November 2026). Only an owner: anyone else who plays has role = 'player'.
alter table public.group_members add column if not exists also_plays boolean not null default false;
alter table public.group_members drop constraint if exists group_members_also_plays_check;
alter table public.group_members add constraint group_members_also_plays_check check (not also_plays or role = 'owner');

-- Belt and braces: the table already only grants update on four profile columns.
revoke update (staff_roles, also_plays) on public.group_members from anon, authenticated;

-- 2. The single rights check ------------------------------------------------------

create or replace function private.has_group_role(p_group uuid, p_roles text[], p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = p_user
      and (role = any(p_roles) or staff_roles && p_roles)
  )
$$;
revoke all on function private.has_group_role(uuid, text[], uuid) from public, anon;
grant execute on function private.has_group_role(uuid, text[], uuid) to authenticated;

-- 3. The helpers the policies call: same signatures, new bodies -------------------

create or replace function private.is_group_staff(p_group uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_group_role(p_group, array['owner', 'coach', 'analyst'], p_user) $$;

create or replace function private.can_edit_calendar(p_group uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.has_group_role(p_group, array['owner', 'coach', 'manager'], p_user)
      or exists (select 1 from public.group_members where group_id = p_group and user_id = p_user and is_captain)
$$;

create or replace function private.can_manage_session(p_group uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.has_group_role(p_group, array['owner', 'coach', 'manager'], p_user)
      or exists (select 1 from public.group_members where group_id = p_group and user_id = p_user and is_captain)
$$;

-- Same list as DISCORD_MANAGER_ROLES (src/lib/discordBotCore.ts).
create or replace function private.is_discord_manager(p_group uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_group_role(p_group, array['owner', 'coach', 'manager'], auth.uid()) $$;

-- Body of 20261119250000_team_data_staff_only, the viewer's role read as effective roles.
create or replace function private.can_read_player_table(p_owner uuid, p_table text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_members viewer
    join public.group_members owner_m on owner_m.group_id = viewer.group_id and owner_m.user_id = p_owner
    left join public.group_sharing s on s.group_id = viewer.group_id and s.user_id = p_owner
    where viewer.user_id = auth.uid()
      and viewer.user_id <> p_owner
      and (
        (p_table in ('Session', 'Game', 'Review', 'Mistake', 'MistakeTag', 'Recording', 'Bookmark', 'ExternalReview')
          and (viewer.role = any(array['owner', 'coach', 'analyst']) or viewer.staff_roles && array['coach', 'analyst'])
          and coalesce(s.share_reviews, true))
        or (p_table in ('Assessment', 'AssessmentScore', 'StatsSnapshot', 'Badge', 'Account', 'CoachingExperiment')
          and (viewer.role = any(array['owner', 'coach', 'analyst']) or viewer.staff_roles && array['coach', 'analyst'])
          and coalesce(s.share_stats, true))
        or (p_table in ('Team', 'TeamMember', 'ChampionPoolEntry', 'DraftPrep', 'CustomGame')
          and (viewer.role = any(array['owner', 'coach', 'analyst', 'manager']) or viewer.staff_roles && array['coach', 'analyst', 'manager'])
          and s.share_team is true)
      )
  )
$$;

-- Body of 20261114050000_e6_wellbeing. A staff role AND a main role other than player, and not an owner who plays.
create or replace function private.can_read_wellbeing(p_owner uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members viewer
    join public.group_members owner_m on owner_m.group_id = viewer.group_id and owner_m.user_id = p_owner
    join public.group_sharing s on s.group_id = viewer.group_id and s.user_id = p_owner
    where viewer.user_id = auth.uid()
      and viewer.user_id <> p_owner
      and viewer.role <> 'player'
      and not viewer.also_plays
      and (viewer.role = any(array['owner', 'coach', 'analyst']) or viewer.staff_roles && array['coach', 'analyst'])
      and s.share_wellbeing = true
  )
$$;

-- 4. Owner hand-over (body of 20261119200000_account_deletion_keeps_groups) ------

create or replace function private.hand_over_groups_of(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
  successor uuid;
begin
  for g in
    select gm.group_id from public.group_members gm
    where gm.user_id = p_user and gm.role = 'owner'
  loop
    -- Another owner already runs the group: nobody to promote.
    if exists (
      select 1 from public.group_members o
      where o.group_id = g.group_id and o.user_id <> p_user and o.role = 'owner'
    ) then
      update public.groups set created_by = (
        select o.user_id from public.group_members o
        where o.group_id = g.group_id and o.user_id <> p_user and o.role = 'owner'
        order by o.joined_at, o.user_id limit 1
      ) where id = g.group_id and created_by = p_user;
      continue;
    end if;

    -- Coach, manager, analyst (main or extra role), then the captain, then the
    -- longest-standing player. On a tie, staff who does not play first.
    successor := null;
    select m.user_id into successor
    from public.group_members m
    where m.group_id = g.group_id and m.user_id <> p_user
    order by case
               when m.role = 'coach' or 'coach' = any(m.staff_roles) then 0
               when m.role = 'manager' or 'manager' = any(m.staff_roles) then 1
               when m.role = 'analyst' or 'analyst' = any(m.staff_roles) then 2
               else 3
             end,
             (m.role = 'player'),
             m.is_captain desc,
             m.joined_at, m.user_id
    limit 1;

    if successor is null then
      delete from public.groups where id = g.group_id;
    else
      -- The owner holds no extra role (check constraint). A player promoted to owner keeps playing:
      -- they stay in the team's roster (the right-hand side reads the row before the update).
      update public.group_members set role = 'owner', staff_roles = '{}', also_plays = (role = 'player')
      where group_id = g.group_id and user_id = successor;
      update public.groups set created_by = successor
      where id = g.group_id and created_by = p_user;
    end if;
  end loop;
end
$$;

-- 5. Writing roles -------------------------------------------------------------------

-- Body of 20261118200000_captain_roles_presence. The new main role leaves the
-- extra roles, so a member is never coach twice.
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
  update public.group_members set role = p_role, staff_roles = array_remove(staff_roles, p_role)
  where group_id = p_group and user_id = p_user and role <> 'owner';
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

-- The owner sets a member's extra staff roles (the whole list, '{}' clears it).
-- Notifies the member of every change, and the rest of the group of every role added.
create or replace function public.set_member_staff_roles(p_group uuid, p_user uuid, p_roles text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_member public.group_members;
  v_roles text[];
  v_added text[];
  v_removed text[];
  other record;
begin
  if v_uid is null or private.group_role(p_group, v_uid) is distinct from 'owner' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_roles is null or cardinality(p_roles) > 3
     or exists (select 1 from unnest(p_roles) as r where r is null or r not in ('coach', 'manager', 'analyst')) then
    raise exception 'INVALID_ROLE' using errcode = '22023';
  end if;

  select * into v_member from public.group_members where group_id = p_group and user_id = p_user for update;
  if v_member.user_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_member.role = 'owner' then
    raise exception 'OWNER_HAS_ALL_ROLES' using errcode = '42501';
  end if;

  -- Sorted, without duplicates, without the main role (already held).
  select coalesce(array_agg(distinct r order by r), '{}') into v_roles
  from unnest(p_roles) as r where r <> v_member.role;

  select coalesce(array_agg(r order by r), '{}') into v_added
  from unnest(v_roles) as r where not (r = any(v_member.staff_roles));
  select coalesce(array_agg(r order by r), '{}') into v_removed
  from unnest(v_member.staff_roles) as r where not (r = any(v_roles));

  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 then
    return v_roles;
  end if;

  update public.group_members set staff_roles = v_roles where group_id = p_group and user_id = p_user;

  perform private.notify(p_user, 'staff_roles_changed',
    jsonb_build_object('groupId', p_group, 'roles', to_jsonb(v_roles), 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)),
    '/coaching');
  if cardinality(v_added) > 0 then
    for other in
      select user_id from public.group_members
      where group_id = p_group and user_id <> p_user and user_id <> v_uid
    loop
      perform private.notify(other.user_id, 'member_staff_roles_changed',
        jsonb_build_object('groupId', p_group, 'memberId', p_user, 'memberName', coalesce(v_member.display_name, '?'),
                           'roles', to_jsonb(v_roles), 'added', to_jsonb(v_added)),
        '/coaching');
    end loop;
  end if;
  return v_roles;
end;
$$;
revoke all on function public.set_member_staff_roles(uuid, uuid, text[]) from public, anon;
grant execute on function public.set_member_staff_roles(uuid, uuid, text[]) to authenticated;

-- An owner says whether they also play, for themself only (each owner of the group decides for themself).
-- Nobody is notified: the owner appears in, or leaves, the team's roster, which everyone sees.
create or replace function public.set_my_also_plays(p_group uuid, p_plays boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_plays is null or private.group_role(p_group, v_uid) is distinct from 'owner' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.group_members set also_plays = p_plays where group_id = p_group and user_id = v_uid;
  return p_plays;
end;
$$;
revoke all on function public.set_my_also_plays(uuid, boolean) from public, anon;
grant execute on function public.set_my_also_plays(uuid, boolean) to authenticated;

-- 6. Notification types (list of 20261118195000_notification_types_fix plus the two above, and dossier_published
--    of 20261119290000: the two migrations keep the same full list, so either can be applied first) ---

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'review_comment', 'objective_assigned', 'scrim_created', 'scrim_updated', 'scrim_reminder_24h', 'scrim_reminder_1h',
  'player_inactive', 'task_assigned', 'objective_overdue', 'wellbeing_alert', 'mention',
  'review_pending', 'scrim_low_availability', 'scrim_availability_missing', 'dev_plan_period_ending',
  'weekly_load_alert', 'calendar_event_request',
  'event_declined', 'event_confirmed',
  'staff_roles_changed', 'member_staff_roles_changed',
  'dossier_published'
]));

-- 7. Fan-outs to the staff, read as effective roles ------------------------------------
-- One row per member, so a player-coach gets each notification once.

-- Body of 20261114070000_e8_notifications_v2, three changes: an owner who plays is checked like a player, a player-staff is never told about their own
-- inactivity, and the loop variable is renamed. It was called gm, like the table alias of the first query,
-- so the function stopped with "record gm is not assigned yet" every time it ran.
create or replace function public.run_inactive_player_check()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
declare staffer record;
declare last_game timestamptz;
declare days_inactive int;
begin
  for r in
    select distinct gm.group_id, gm.user_id as player_id, gm.display_name
    from public.group_members gm
    where gm.role = 'player' or gm.also_plays
  loop
    select max(sr.updated_at) into last_game
      from public.sync_records sr
      where sr.user_id = r.player_id and sr.table_name = 'Game' and not sr.deleted;
    if last_game is null then continue; end if;
    days_inactive := extract(day from now() - last_game)::int;
    if days_inactive < 5 then continue; end if;
    if not coalesce((select s.share_reviews from public.group_sharing s
                      where s.group_id = r.group_id and s.user_id = r.player_id), true) then
      continue;
    end if;
    if exists (
      select 1 from public.notifications n
      where n.type = 'player_inactive' and n.created_at > now() - interval '7 days'
        and n.data->>'groupId' = r.group_id::text and n.data->>'playerId' = r.player_id::text
    ) then continue; end if;
    for staffer in
      select user_id from public.group_members
      where group_id = r.group_id and user_id <> r.player_id
        and (role = any(array['owner', 'coach', 'analyst']) or staff_roles && array['coach', 'analyst'])
    loop
      perform private.notify(staffer.user_id, 'player_inactive',
        jsonb_build_object('groupId', r.group_id, 'playerId', r.player_id,
                            'playerName', coalesce(r.display_name, '?'), 'days', days_inactive),
        '/coaching');
    end loop;
  end loop;
end;
$$;

-- Body of 20261114070000_e8_notifications_v2. Same readers as can_read_wellbeing: no player-staff, no owner who plays.
create or replace function public.run_wellbeing_alert_check()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
declare gm record;
declare moods numeric[];
begin
  for r in
    select distinct gs.group_id, gs.user_id as player_id
    from public.group_sharing gs
    where gs.share_wellbeing = true
  loop
    select array_agg(avg_mood order by day) into moods from (
      select date(created_at) as day, avg(mood) as avg_mood
      from public.wellbeing_checkins
      where user_id = r.player_id
      group by date(created_at)
      order by day desc
      limit 3
    ) recent;
    if moods is null or array_length(moods, 1) < 3 then continue; end if;
    if not (moods[1] > moods[2] and moods[2] > moods[3]) then continue; end if;
    if exists (
      select 1 from public.notifications n
      where n.type = 'wellbeing_alert' and n.created_at > now() - interval '3 days'
        and n.data->>'groupId' = r.group_id::text and n.data->>'playerId' = r.player_id::text
    ) then continue; end if;
    for gm in
      select user_id from public.group_members
      where group_id = r.group_id and user_id <> r.player_id
        and role <> 'player' and not also_plays
        and (role = any(array['owner', 'coach', 'analyst']) or staff_roles && array['coach', 'analyst'])
    loop
      perform private.notify(gm.user_id, 'wellbeing_alert',
        jsonb_build_object('groupId', r.group_id, 'playerId', r.player_id), '/coaching');
    end loop;
  end loop;
end;
$$;

-- Body of 20261118200000_captain_roles_presence.
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
    where group_id = new.group_id and user_id <> new.requested_by
      and (role = any(array['owner', 'coach', 'manager']) or staff_roles && array['coach', 'manager'] or is_captain)
  loop
    perform private.notify(staffer.user_id, 'calendar_event_request',
      jsonb_build_object('groupId', new.group_id, 'requestId', new.id, 'eventName', new.event_name, 'requestedByName', coalesce(requester_name, '?')),
      '/coaching');
  end loop;
  return new;
end;
$$;

-- Body of 20261118200000_captain_roles_presence.
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
        and (role = any(array['owner', 'coach', 'manager']) or staff_roles && array['coach', 'manager'] or is_captain)
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

-- 8. The three scheduled checks that exist only in production -------------------------
-- Bodies read from production by CyberSecurity on 19 November 2026 (pg_get_functiondef), never in a
-- migration of this repository until now. Only the staff recipients change: effective roles, never the
-- member the notification is about, and for the weekly load check (it reads moods) no player-staff, as in
-- can_read_wellbeing.

create or replace function public.run_dev_plan_period_check()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare p record;
declare staffer record;
begin
  for p in
    select * from public.dev_plans
    where period_end is not null and period_end_notified = false
      and period_end <= current_date + interval '3 days'
      and period_end >= current_date
  loop
    perform private.notify(p.player_id, 'dev_plan_period_ending',
      jsonb_build_object('groupId', p.group_id, 'planId', p.id, 'title', p.title, 'periodEnd', p.period_end),
      '/coaching');
    for staffer in
      select user_id from public.group_members
      where group_id = p.group_id and user_id <> p.player_id
        and (role = any(array['owner', 'coach', 'analyst']) or staff_roles && array['coach', 'analyst'])
    loop
      perform private.notify(staffer.user_id, 'dev_plan_period_ending',
        jsonb_build_object('groupId', p.group_id, 'planId', p.id, 'title', p.title, 'periodEnd', p.period_end, 'playerId', p.player_id),
        '/coaching');
    end loop;
    update public.dev_plans set period_end_notified = true where id = p.id;
  end loop;
end;
$$;

create or replace function public.run_scrim_availability_check()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s record;
declare starter record;
declare yes_count int;
declare starter_count int;
declare staffer record;
begin
  for s in
    select * from public.scrims
    where status = 'planned' and scheduled_at between now() and now() + interval '48 hours'
  loop
    select count(*) into starter_count from public.team_rosters
      where group_id = s.group_id and status = 'starter' and scouting_id is null and user_id is not null;
    if starter_count = 0 then continue; end if;

    select count(*) into yes_count from public.scrim_availability sa
      join public.team_rosters tr on tr.user_id = sa.user_id
      where tr.group_id = s.group_id and tr.status = 'starter' and tr.scouting_id is null
        and sa.scrim_id = s.id and sa.status = 'yes';

    if yes_count < 5 and not s.low_availability_notified then
      for staffer in
        select user_id from public.group_members
        where group_id = s.group_id
          and (role = any(array['owner', 'coach', 'analyst']) or staff_roles && array['coach', 'analyst'])
      loop
        perform private.notify(staffer.user_id, 'scrim_low_availability',
          jsonb_build_object('groupId', s.group_id, 'scrimId', s.id, 'title', s.title, 'yesCount', yes_count),
          '/coaching');
      end loop;
      update public.scrims set low_availability_notified = true where id = s.id;
    end if;

    for starter in
      select tr.user_id from public.team_rosters tr
      where tr.group_id = s.group_id and tr.status = 'starter' and tr.scouting_id is null and tr.user_id is not null
        and not exists (select 1 from public.scrim_availability sa where sa.scrim_id = s.id and sa.user_id = tr.user_id)
        and not exists (select 1 from public.scrim_availability_reminders rem where rem.scrim_id = s.id and rem.user_id = tr.user_id)
    loop
      perform private.notify(starter.user_id, 'scrim_availability_missing',
        jsonb_build_object('groupId', s.group_id, 'scrimId', s.id, 'title', s.title),
        '/coaching');
      insert into public.scrim_availability_reminders (scrim_id, user_id) values (s.id, starter.user_id);
    end loop;
  end loop;
end;
$$;

create or replace function public.run_weekly_load_check()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
declare total_seconds numeric;
declare hours numeric;
declare moods numeric[];
declare staffer record;
begin
  for r in
    select gs.group_id, gs.user_id as player_id, g.weekly_load_threshold_hours
    from public.group_sharing gs
    join public.groups g on g.id = gs.group_id
    where gs.share_stats = true and gs.share_wellbeing = true
  loop
    select coalesce(sum((sr.data->>'duration')::numeric), 0) into total_seconds
      from public.sync_records sr
      where sr.user_id = r.player_id and sr.table_name = 'Game' and sr.deleted = false
        and (sr.data->>'gameEndAt')::timestamptz > now() - interval '7 days';
    hours := total_seconds / 3600.0;
    if hours < r.weekly_load_threshold_hours then continue; end if;

    -- Same decline rule as run_wellbeing_alert_check: 3 most recent
    -- check-in days, strictly decreasing average mood.
    select array_agg(avg_mood order by day) into moods from (
      select date(created_at) as day, avg(mood) as avg_mood
      from public.wellbeing_checkins
      where user_id = r.player_id
      group by date(created_at)
      order by day desc
      limit 3
    ) recent;
    if moods is null or array_length(moods, 1) < 3 then continue; end if;
    if not (moods[1] > moods[2] and moods[2] > moods[3]) then continue; end if;

    if exists (
      select 1 from public.notifications n
      where n.type = 'weekly_load_alert' and n.created_at > now() - interval '3 days'
        and n.data->>'groupId' = r.group_id::text and n.data->>'playerId' = r.player_id::text
    ) then continue; end if;

    -- It reveals a mood trend: the same readers as can_read_wellbeing, so no player-staff, no owner who plays.
    for staffer in
      select user_id from public.group_members
      where group_id = r.group_id and user_id <> r.player_id
        and role <> 'player' and not also_plays
        and (role = any(array['owner', 'coach', 'analyst']) or staff_roles && array['coach', 'analyst'])
    loop
      perform private.notify(staffer.user_id, 'weekly_load_alert',
        jsonb_build_object('groupId', r.group_id, 'playerId', r.player_id, 'hours', round(hours, 1), 'thresholdHours', r.weekly_load_threshold_hours),
        '/coaching');
    end loop;
  end loop;
end;
$$;

-- The scheduled checks run from pg_cron (as postgres): no reason for the API roles to call them through
-- /rest/v1/rpc (finding of docs/AUDIT_SECURITE.md).
revoke all on function public.run_dev_plan_period_check() from public, anon, authenticated;
revoke all on function public.run_scrim_availability_check() from public, anon, authenticated;
revoke all on function public.run_weekly_load_check() from public, anon, authenticated;
revoke all on function public.run_inactive_player_check() from public, anon, authenticated;
revoke all on function public.run_wellbeing_alert_check() from public, anon, authenticated;

-- 9. S19-07 (CyberSecurity): who may call the remaining functions ---------------------------
-- Three of them exist only in production (run_review_pending_check, auto_create_team_session,
-- set_weekly_load_threshold), so they are found by name in pg_catalog and revoked on their real
-- signature. A function that does not exist (a local database) is skipped.
--   - a scheduled check and two trigger functions: no API role calls them. A trigger still fires
--     after this, Postgres only checks EXECUTE when the trigger is created.
--   - set_captain and set_weekly_load_threshold: the app calls them signed in, never anonymously.
--     Revoking from anon alone would leave the default PUBLIC grant, so PUBLIC loses it too and
--     authenticated gets it explicitly.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('run_review_pending_check', 'auto_create_team_session', 'notify_calendar_event_request')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('set_captain', 'set_weekly_load_threshold')
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;
