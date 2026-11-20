-- Rollback of 20261120110436_team_session_auto_lifecycle (team sessions that open on their own). Run it as one
-- transaction. Sessions go back to the manual start and end, and to "deleting the slot deletes the session".
-- Lost: the sessions kept after their slot was deleted (calendar_event_id null), which the old schema cannot hold.

select cron.unschedule('team-session-lifecycle');
drop function if exists public.run_team_session_lifecycle();

drop trigger if exists team_session_scrim_cancelled on public.scrims;
drop function if exists private.team_session_scrim_cancelled();
drop trigger if exists team_session_before_event_delete on public.calendar_events;
drop function if exists private.team_session_before_event_delete();
drop trigger if exists team_session_follows_event on public.calendar_events;
drop function if exists private.team_session_follows_event();

-- Body of 20261116015733_e_phase3_team_sessions.
create or replace function public.auto_create_team_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('scrim', 'flex', 'tournament', 'meeting') then
    insert into public.team_sessions (group_id, calendar_event_id)
    values (new.group_id, new.id)
    on conflict (calendar_event_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.auto_create_team_session() from public, anon, authenticated;

drop function if exists private.team_session_is_empty(uuid);

delete from public.team_sessions where calendar_event_id is null;
alter table public.team_sessions drop constraint if exists team_sessions_calendar_event_id_fkey;
alter table public.team_sessions add constraint team_sessions_calendar_event_id_fkey
  foreign key (calendar_event_id) references public.calendar_events (id) on delete cascade;
alter table public.team_sessions alter column calendar_event_id set not null;

alter table public.team_sessions drop column if exists event_ends_at;
alter table public.team_sessions drop column if exists event_starts_at;
alter table public.team_sessions drop column if exists event_title;
alter table public.team_sessions drop column if exists event_kind;
alter table public.team_sessions drop column if exists event_id;
