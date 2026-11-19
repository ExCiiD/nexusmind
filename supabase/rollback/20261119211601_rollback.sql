-- Rollback of 20261119211601_member_staff_roles (multiple roles, also_plays, S19-07, run_* recipients).
--
-- Every function body below is the production definition read on 20 November 2026, before the migration,
-- with pg_get_functiondef (read-only export). The grants are the production ACLs read the same day.
-- Run it as one transaction (the SQL editor or execute_sql). It undoes, in order:
--   1. the 15 functions the migration replaced, back to their production bodies
--   2. the 4 functions it created (has_group_role, set_member_staff_roles, set_my_also_plays, text_array_is_distinct)
--   3. the notification type list (the two new types deleted first, so the old check holds)
--   4. the execute grants it revoked (S19-07)
--   5. the two columns and their constraints (the staff roles and also_plays set since are lost)
-- Re-runnable: create or replace, drop ... if exists.

-- 1. The replaced functions, production bodies -----------------------------------------

CREATE OR REPLACE FUNCTION private.can_edit_calendar(p_group uuid, p_user uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = p_user
      and (role in ('owner', 'coach', 'manager') or is_captain)
  )
$function$
;

CREATE OR REPLACE FUNCTION private.can_manage_session(p_group uuid, p_user uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = p_user
      and (role in ('owner', 'coach', 'manager') or is_captain)
  )
$function$
;

CREATE OR REPLACE FUNCTION private.can_read_player_table(p_owner uuid, p_table text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.group_members viewer
    join public.group_members owner_m on owner_m.group_id = viewer.group_id and owner_m.user_id = p_owner
    left join public.group_sharing s on s.group_id = viewer.group_id and s.user_id = p_owner
    where viewer.user_id = auth.uid()
      and viewer.user_id <> p_owner
      and (
        (p_table in ('Session', 'Game', 'Review', 'Mistake', 'MistakeTag', 'Recording', 'Bookmark', 'ExternalReview')
          and viewer.role in ('owner', 'coach', 'analyst') and coalesce(s.share_reviews, true))
        or (p_table in ('Assessment', 'AssessmentScore', 'StatsSnapshot', 'Badge', 'Account', 'CoachingExperiment')
          and viewer.role in ('owner', 'coach', 'analyst') and coalesce(s.share_stats, true))
        or (p_table in ('Team', 'TeamMember', 'ChampionPoolEntry', 'DraftPrep', 'CustomGame')
          and viewer.role in ('owner', 'coach', 'analyst', 'manager') and s.share_team is true)
      )
  )
$function$
;

CREATE OR REPLACE FUNCTION private.can_read_wellbeing(p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.group_members viewer
    join public.group_members owner_m on owner_m.group_id = viewer.group_id and owner_m.user_id = p_owner
    join public.group_sharing s on s.group_id = viewer.group_id and s.user_id = p_owner
    where viewer.user_id = auth.uid()
      and viewer.user_id <> p_owner
      and viewer.role in ('owner', 'coach', 'analyst')
      and s.share_wellbeing = true
  )
$function$
;

CREATE OR REPLACE FUNCTION private.hand_over_groups_of(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    -- Staff first (coach, manager, analyst), then the captain, then the
    -- longest-standing player.
    successor := null;
    select m.user_id into successor
    from public.group_members m
    where m.group_id = g.group_id and m.user_id <> p_user
    order by case m.role when 'coach' then 0 when 'manager' then 1 when 'analyst' then 2 else 3 end,
             m.is_captain desc,
             m.joined_at, m.user_id
    limit 1;

    if successor is null then
      delete from public.groups where id = g.group_id;
    else
      update public.group_members set role = 'owner'
      where group_id = g.group_id and user_id = successor;
      update public.groups set created_by = successor
      where id = g.group_id and created_by = p_user;
    end if;
  end loop;
end
$function$
;

CREATE OR REPLACE FUNCTION private.is_discord_manager(p_group uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid() and role in ('owner', 'coach', 'manager')
  )
$function$
;

CREATE OR REPLACE FUNCTION private.is_group_staff(p_group uuid, p_user uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select exists (select 1 from public.group_members
                     where group_id = p_group and user_id = p_user and role in ('owner', 'coach', 'analyst')) $function$
;

CREATE OR REPLACE FUNCTION public.notify_calendar_event_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_calendar_event(p_event uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.run_dev_plan_period_check()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    for staffer in select user_id from public.group_members where group_id = p.group_id and role in ('owner', 'coach', 'analyst') loop
      perform private.notify(staffer.user_id, 'dev_plan_period_ending',
        jsonb_build_object('groupId', p.group_id, 'planId', p.id, 'title', p.title, 'periodEnd', p.period_end, 'playerId', p.player_id),
        '/coaching');
    end loop;
    update public.dev_plans set period_end_notified = true where id = p.id;
  end loop;
end;
$function$
;

-- The production body as it was, including its loop variable named like the query alias (gm).
CREATE OR REPLACE FUNCTION public.run_inactive_player_check()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record;
declare gm record;
declare last_game timestamptz;
declare days_inactive int;
begin
  for r in
    select distinct gm.group_id, gm.user_id as player_id, gm.display_name
    from public.group_members gm
    where gm.role = 'player'
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
    for gm in select user_id from public.group_members where group_id = r.group_id and role in ('owner', 'coach', 'analyst') loop
      perform private.notify(gm.user_id, 'player_inactive',
        jsonb_build_object('groupId', r.group_id, 'playerId', r.player_id,
                            'playerName', coalesce(r.display_name, '?'), 'days', days_inactive),
        '/coaching');
    end loop;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_scrim_availability_check()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      for staffer in select user_id from public.group_members where group_id = s.group_id and role in ('owner', 'coach', 'analyst') loop
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
$function$
;

CREATE OR REPLACE FUNCTION public.run_weekly_load_check()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    for staffer in select user_id from public.group_members where group_id = r.group_id and role in ('owner', 'coach', 'analyst') loop
      perform private.notify(staffer.user_id, 'weekly_load_alert',
        jsonb_build_object('groupId', r.group_id, 'playerId', r.player_id, 'hours', round(hours, 1), 'thresholdHours', r.weekly_load_threshold_hours),
        '/coaching');
    end loop;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_wellbeing_alert_check()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    for gm in select user_id from public.group_members where group_id = r.group_id and role in ('owner', 'coach', 'analyst') loop
      perform private.notify(gm.user_id, 'wellbeing_alert',
        jsonb_build_object('groupId', r.group_id, 'playerId', r.player_id), '/coaching');
    end loop;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_member_role(p_group uuid, p_user uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- 2. The functions the migration created ----------------------------------------------

drop function if exists public.set_my_also_plays(uuid, boolean);
drop function if exists public.set_member_staff_roles(uuid, uuid, text[]);
drop function if exists private.has_group_role(uuid, text[], uuid);

-- 3. Notification types, production list ----------------------------------------------

delete from public.notifications where type in ('staff_roles_changed', 'member_staff_roles_changed');
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'review_comment', 'objective_assigned', 'scrim_created', 'scrim_updated', 'scrim_reminder_24h', 'scrim_reminder_1h',
  'player_inactive', 'task_assigned', 'objective_overdue', 'wellbeing_alert', 'mention',
  'review_pending', 'scrim_low_availability', 'scrim_availability_missing', 'dev_plan_period_ending',
  'weekly_load_alert', 'calendar_event_request', 'event_declined', 'event_confirmed'
]));

-- 4. Execute grants, production ACLs ----------------------------------------------------
-- These eight were executable by PUBLIC, anon, authenticated and service_role.
-- run_inactive_player_check and run_wellbeing_alert_check already were postgres and service_role only.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'run_dev_plan_period_check', 'run_scrim_availability_check', 'run_weekly_load_check', 'run_review_pending_check',
      'auto_create_team_session', 'notify_calendar_event_request', 'set_captain', 'set_weekly_load_threshold')
  loop
    execute format('grant execute on function %s to public, anon, authenticated, service_role', f);
  end loop;
end
$$;
grant execute on function public.run_inactive_player_check() to service_role;
grant execute on function public.run_wellbeing_alert_check() to service_role;

-- 5. The columns and their constraints ----------------------------------------------------

alter table public.group_members drop constraint if exists group_members_also_plays_check;
alter table public.group_members drop constraint if exists group_members_staff_roles_check;
alter table public.group_members drop column if exists also_plays;
alter table public.group_members drop column if exists staff_roles;
drop function if exists private.text_array_is_distinct(text[]);
