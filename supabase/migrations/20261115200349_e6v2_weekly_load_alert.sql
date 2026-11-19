-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 15/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

-- E6 v2: "weekly play load + declining mood" alert — deliberately gated on
-- BOTH share_stats AND share_wellbeing (a player who only gave one consent
-- never triggers this; the v1 note explicitly avoided mixing two consents
-- in one alert, this resolves that by requiring both, not neither).
alter table public.groups add column weekly_load_threshold_hours integer not null default 20;

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

    for staffer in select user_id from public.group_members where group_id = r.group_id and role in ('owner', 'coach', 'analyst') loop
      perform private.notify(staffer.user_id, 'weekly_load_alert',
        jsonb_build_object('groupId', r.group_id, 'playerId', r.player_id, 'hours', round(hours, 1), 'thresholdHours', r.weekly_load_threshold_hours),
        '/coaching');
    end loop;
  end loop;
end;
$$;

select cron.schedule('weekly-load-check', '0 7 * * *', $$select public.run_weekly_load_check()$$);
