-- E8: notifications recentered on the team (docs/PLAN_GESTION_EQUIPE.md),
-- v1 scope, building on W5 (20261113150000_w5_notifications.sql).
--
-- 1) Per-user preferences: mute by type + a quiet-hours window, enforced by
--    a single new gate `private.should_notify`, which every notification
--    insertion point (existing W5 triggers included) now goes through via
--    a new `private.notify` helper, replacing their direct inserts.
-- 2) Three new notification types for recently-shipped features: task
--    assigned (E7), objective overdue (a cron, mirroring the existing
--    inactive-player check), wellbeing mood-decline alert to staff (E6).
--
-- Deferred (documented in PLAN_GESTION_EQUIPE.md): Web Push, Discord
-- (today's webhook is local-per-player, not a server-side team channel —
-- needs its own architecture), e-mail digest, missing-availability and
-- weekly-report-ready notifications (the latter blocked on E9 not existing
-- yet), Realtime push (still polling, a deliberate earlier W5 choice).

create table public.notification_prefs (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  muted_types text[] not null default '{}',
  quiet_start time,
  quiet_end   time,
  updated_at  timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
create policy "notification_prefs_own" on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

-- True unless the user muted this type, or it falls inside their quiet
-- hours. No prefs row at all means "notify" (the W5/E8 default).
create or replace function private.should_notify(p_user uuid, p_type text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare p public.notification_prefs;
declare now_time time;
begin
  select * into p from public.notification_prefs where user_id = p_user;
  if p is null then return true; end if;
  if p_type = any(p.muted_types) then return false; end if;
  if p.quiet_start is not null and p.quiet_end is not null then
    now_time := (now() at time zone 'utc')::time;
    if p.quiet_start <= p.quiet_end then
      if now_time between p.quiet_start and p.quiet_end then return false; end if;
    else -- overnight window, e.g. 22:00-07:00
      if now_time >= p.quiet_start or now_time <= p.quiet_end then return false; end if;
    end if;
  end if;
  return true;
end;
$$;
revoke all on function private.should_notify(uuid, text) from public;
grant execute on function private.should_notify(uuid, text) to authenticated;

create or replace function private.notify(p_user uuid, p_type text, p_data jsonb, p_link text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.should_notify(p_user, p_type) then
    insert into public.notifications (user_id, type, data, link) values (p_user, p_type, p_data, p_link);
  end if;
end;
$$;
revoke all on function private.notify(uuid, text, jsonb, text) from public, authenticated, anon;

-- New types.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'review_comment', 'objective_assigned',
  'scrim_created', 'scrim_updated',
  'scrim_reminder_24h', 'scrim_reminder_1h',
  'player_inactive', 'task_assigned', 'objective_overdue', 'wellbeing_alert'
));

-- ── Route the existing W5 triggers through private.notify (same behavior, now prefs-aware) ──

create or replace function public.notify_review_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare author_name text;
begin
  if new.author_id = new.player_id then return new; end if;
  select display_name into author_name from public.group_members
    where group_id = new.group_id and user_id = new.author_id;
  perform private.notify(new.player_id, 'review_comment',
    jsonb_build_object('groupId', new.group_id, 'reviewId', new.review_id, 'commentId', new.id,
                        'authorName', coalesce(author_name, '?')),
    '/review?reviewId=' || new.review_id);
  return new;
end;
$$;

create or replace function public.notify_objective_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
declare assigner_name text;
begin
  if new.assigned_by = new.player_id then return new; end if;
  select display_name into assigner_name from public.group_members
    where group_id = new.group_id and user_id = new.assigned_by;
  perform private.notify(new.player_id, 'objective_assigned',
    jsonb_build_object('groupId', new.group_id, 'objectiveIds', new.objective_ids,
                        'assignedByName', coalesce(assigner_name, '?')),
    '/session');
  return new;
end;
$$;

create or replace function public.notify_scrim_members(p_scrim public.scrims, p_type text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare gm record;
begin
  for gm in select user_id from public.group_members where group_id = p_scrim.group_id and user_id <> p_actor loop
    perform private.notify(gm.user_id, p_type,
      jsonb_build_object('groupId', p_scrim.group_id, 'scrimId', p_scrim.id,
                          'title', p_scrim.title, 'scheduledAt', p_scrim.scheduled_at),
      '/scrims?scrimId=' || p_scrim.id);
  end loop;
end;
$$;
revoke all on function public.notify_scrim_members(public.scrims, text, uuid) from public, authenticated, anon;

create or replace function public.run_inactive_player_check()
returns void language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function public.run_inactive_player_check() from public, authenticated, anon;

-- ── New: task assigned (E7) ──
create or replace function public.notify_task_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
declare assigner_name text;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.assignee_id = new.assignee_id then return new; end if;
  if new.assignee_id = new.created_by then return new; end if;
  select display_name into assigner_name from public.group_members
    where group_id = new.group_id and user_id = new.created_by;
  perform private.notify(new.assignee_id, 'task_assigned',
    jsonb_build_object('groupId', new.group_id, 'taskId', new.id, 'title', new.title,
                        'assignedByName', coalesce(assigner_name, '?')),
    '/coaching');
  return new;
end;
$$;
create trigger tasks_notify_assigned after insert or update on public.tasks
  for each row execute function public.notify_task_assigned();
revoke all on function public.notify_task_assigned() from public, authenticated, anon;

-- ── New: objective overdue, once-daily check ──
alter table public.assigned_objectives add column overdue_notified boolean not null default false;

create or replace function public.run_objective_overdue_check()
returns void language plpgsql security definer set search_path = '' as $$
declare r public.assigned_objectives;
begin
  for r in
    select * from public.assigned_objectives
    where status = 'open' and not overdue_notified and due_date is not null and due_date < current_date
  loop
    perform private.notify(r.player_id, 'objective_overdue',
      jsonb_build_object('groupId', r.group_id, 'objectiveIds', r.objective_ids, 'dueDate', r.due_date),
      '/session');
    update public.assigned_objectives set overdue_notified = true where id = r.id;
  end loop;
end;
$$;
revoke all on function public.run_objective_overdue_check() from public, authenticated, anon;

-- ── New: wellbeing mood-decline alert to staff (E6), once-daily check ──
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
    for gm in select user_id from public.group_members where group_id = r.group_id and role in ('owner', 'coach', 'analyst') loop
      perform private.notify(gm.user_id, 'wellbeing_alert',
        jsonb_build_object('groupId', r.group_id, 'playerId', r.player_id), '/coaching');
    end loop;
  end loop;
end;
$$;
revoke all on function public.run_wellbeing_alert_check() from public, authenticated, anon;

select cron.schedule('objective-overdue-check', '30 6 * * *', 'select public.run_objective_overdue_check()');
select cron.schedule('wellbeing-alert-check', '45 6 * * *', 'select public.run_wellbeing_alert_check()');
