-- Rollback of 20261120120000_scrims_in_planning (#49). Run it as one transaction. It undoes, in order:
--   1. the two RPCs and the trigger that makes a scrim follow its slot
--   2. run_scrim_availability_check, back to its body of 20261119211601_member_staff_roles
--   3. the new columns, constraints and indexes, and the helper functions
-- It keeps: the slots the backfill created for older scrims (valid Planning slots, linked by linked_scrim_id as
-- before #49), the team sessions of the upcoming ones, and the opponents created from a slot (team_scouting rows,
-- source 'match', and their rosters), which become ordinary scouted teams. A scrim keeps its opponent_scouting_id.
-- Re-runnable: drop ... if exists, create or replace.

-- 1. The writes from the Planning -------------------------------------------------------------

drop function if exists public.save_match_event(uuid, jsonb, jsonb);
drop function if exists public.update_match_detail(uuid, jsonb);
drop trigger if exists scrim_follows_its_event on public.calendar_events;
drop function if exists private.scrim_follows_its_event();

-- 2. run_scrim_availability_check, body of 20261119211601_member_staff_roles -----------------------

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
revoke all on function public.run_scrim_availability_check() from public, anon, authenticated;

-- 3. Columns, constraints, indexes, helpers ---------------------------------------------------------

drop index if exists public.scrims_calendar_event_id_key;
alter table public.scrims drop constraint if exists scrims_calendar_event_id_fkey;
alter table public.scrims drop column if exists calendar_event_id;
alter table public.scrims drop constraint if exists scrims_kind_check;
alter table public.scrims drop column if exists kind;
alter table public.scrims drop constraint if exists scrims_opponent_key_check;
alter table public.scrims drop column if exists opponent_key;

drop trigger if exists team_scouting_key on public.team_scouting;
drop trigger if exists team_scouting_key_moved on public.team_scouting;
drop function if exists private.team_scouting_key();
drop function if exists private.team_scouting_key_moved();
drop index if exists public.team_scouting_group_opponent_key;
alter table public.team_scouting drop constraint if exists team_scouting_opponent_key_check;
alter table public.team_scouting drop column if exists opponent_key;
alter table public.team_scouting drop constraint if exists team_scouting_source_check;
alter table public.team_scouting drop column if exists source;
alter table public.team_scouting drop constraint if exists team_scouting_opgg_url_check;
alter table public.team_scouting drop column if exists opgg_url;

drop function if exists private.match_kind_of(text);
drop function if exists private.opponent_key_of(text);
