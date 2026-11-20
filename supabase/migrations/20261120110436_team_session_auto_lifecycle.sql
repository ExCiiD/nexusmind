-- Team sessions run on their own (user's request of 20/11/2026, docs/DECISIONS.md): an empty session is created with
-- a Planning slot of kind scrim, flex or tournament (and meeting, as before), it opens by itself at the slot's start
-- time and follows the slot when it moves. When the slot is cancelled or deleted before the session started (empty: no
-- game, review, feedback or attendance), the session goes with it. A session that started is kept.
--
--   1. team_sessions keeps a copy of its slot (event_id, kind, title, times), so a kept session still reads in the
--      history once the slot is deleted. calendar_event_id becomes nullable, "on delete set null" instead of cascade.
--   2. private.team_session_is_empty: no game, no review, no player feedback, no attendance mark.
--   3. Creation on insert (public.auto_create_team_session, as before, plus the copy) and on update when a slot
--      becomes one of those kinds. A slot that moves: the copy follows, and a session opened by the clock with
--      nothing in it goes back to scheduled when its slot moves to a later time. A slot that leaves those kinds takes
--      its empty session away.
--   4. Deleting a slot: its empty session is deleted, a started one is kept (and ended if it was live). A scrim
--      marked cancelled (update_match_detail) takes the empty session of its slot away too.
--   5. public.run_team_session_lifecycle, every minute (pg_cron "team-session-lifecycle"):
--        - a scheduled scrim / flex / tournament session whose slot has started (and not ended more than 1 h ago)
--          opens: status live, started at the slot's start time. What the person who started it chose before is now
--          filled in: responsible = whoever already was, else the slot's creator if still a member, else the group's
--          owners. Queue filter = the slot's kind, a tournament as custom games (its matches are tournament-code custom games,
--          and "all queues" would also collect the solo queue games played meanwhile). The objectives stay editable by the
--          session's managers (team_session_objectives_write, unchanged).
--        - a live scrim / flex / tournament session ends 1 h after its slot's end time, so a forgotten session does
--          not keep collecting games. Meetings keep their manual start and end (MeetingSetupCard).
-- Re-runnable: if not exists, create or replace, drop ... if exists. No semicolon inside a comment.

-- 1. The slot's copy -----------------------------------------------------------------------------------

alter table public.team_sessions add column if not exists event_id uuid;
alter table public.team_sessions add column if not exists event_kind text;
alter table public.team_sessions add column if not exists event_title text;
alter table public.team_sessions add column if not exists event_starts_at timestamptz;
alter table public.team_sessions add column if not exists event_ends_at timestamptz;

update public.team_sessions s set event_id = e.id, event_kind = e.kind, event_title = e.title, event_starts_at = e.starts_at, event_ends_at = e.ends_at
from public.calendar_events e
where e.id = s.calendar_event_id and s.event_id is null;

alter table public.team_sessions alter column calendar_event_id drop not null;
alter table public.team_sessions drop constraint if exists team_sessions_calendar_event_id_fkey;
alter table public.team_sessions add constraint team_sessions_calendar_event_id_fkey
  foreign key (calendar_event_id) references public.calendar_events (id) on delete set null;

-- 2. An empty session ------------------------------------------------------------------------------------

create or replace function private.team_session_is_empty(p_session uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.team_session_games where session_id = p_session)
     and not exists (select 1 from public.team_session_reviews where session_id = p_session)
     and not exists (select 1 from public.team_session_feedback where session_id = p_session)
     and not exists (select 1 from public.team_session_attendance where session_id = p_session)
$$;
revoke all on function private.team_session_is_empty(uuid) from public, anon, authenticated;

-- 3. Creation and following the slot -------------------------------------------------------------------------

create or replace function public.auto_create_team_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('scrim', 'flex', 'tournament', 'meeting') then
    insert into public.team_sessions (group_id, calendar_event_id, event_id, event_kind, event_title, event_starts_at, event_ends_at)
    values (new.group_id, new.id, new.id, new.kind, new.title, new.starts_at, new.ends_at)
    on conflict (calendar_event_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.auto_create_team_session() from public, anon, authenticated;

create or replace function private.team_session_follows_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.team_sessions;
begin
  select * into v_session from public.team_sessions where calendar_event_id = new.id;
  if v_session.id is null then
    if new.kind in ('scrim', 'flex', 'tournament', 'meeting') then
      insert into public.team_sessions (group_id, calendar_event_id, event_id, event_kind, event_title, event_starts_at, event_ends_at)
      values (new.group_id, new.id, new.id, new.kind, new.title, new.starts_at, new.ends_at)
      on conflict (calendar_event_id) do nothing;
    end if;
    return new;
  end if;

  if new.kind not in ('scrim', 'flex', 'tournament', 'meeting') and private.team_session_is_empty(v_session.id) then
    delete from public.team_sessions where id = v_session.id;
    return new;
  end if;

  update public.team_sessions set
    event_kind = new.kind, event_title = new.title, event_starts_at = new.starts_at, event_ends_at = new.ends_at,
    -- Opened by the clock, still empty, and the slot moved to a later time: it waits for the new time.
    status = case when status = 'live' and new.starts_at > now() and new.starts_at is distinct from old.starts_at
                    and private.team_session_is_empty(id) then 'scheduled' else status end,
    started_at = case when status = 'live' and new.starts_at > now() and new.starts_at is distinct from old.starts_at
                        and private.team_session_is_empty(id) then null else started_at end
  where id = v_session.id;
  return new;
end;
$$;
revoke all on function private.team_session_follows_event() from public, anon, authenticated;

drop trigger if exists team_session_follows_event on public.calendar_events;
create trigger team_session_follows_event
  after update of kind, title, starts_at, ends_at on public.calendar_events
  for each row execute function private.team_session_follows_event();

-- 4. A slot deleted or a scrim cancelled ------------------------------------------------------------------------

create or replace function private.team_session_before_event_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
begin
  select id into v_session from public.team_sessions where calendar_event_id = old.id;
  if v_session is not null then
    if private.team_session_is_empty(v_session) then
      delete from public.team_sessions where id = v_session;
    else
      update public.team_sessions set
        status = case when status = 'live' then 'ended' else status end,
        ended_at = case when status = 'live' then now() else ended_at end
      where id = v_session;
    end if;
  end if;
  return old;
end;
$$;
revoke all on function private.team_session_before_event_delete() from public, anon, authenticated;

drop trigger if exists team_session_before_event_delete on public.calendar_events;
create trigger team_session_before_event_delete
  before delete on public.calendar_events
  for each row execute function private.team_session_before_event_delete();

create or replace function private.team_session_scrim_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.team_sessions s
  where s.calendar_event_id = new.calendar_event_id and s.status = 'scheduled' and private.team_session_is_empty(s.id);
  return new;
end;
$$;
revoke all on function private.team_session_scrim_cancelled() from public, anon, authenticated;

drop trigger if exists team_session_scrim_cancelled on public.scrims;
create trigger team_session_scrim_cancelled
  after update of status on public.scrims
  for each row when (new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.calendar_event_id is not null)
  execute function private.team_session_scrim_cancelled();

-- 5. Opening and closing by the clock ---------------------------------------------------------------------------

create or replace function public.run_team_session_lifecycle()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.team_sessions s set
    status = 'live',
    started_at = e.starts_at,
    responsible_user_ids = case
      when cardinality(s.responsible_user_ids) > 0 then s.responsible_user_ids
      when exists (select 1 from public.group_members m where m.group_id = s.group_id and m.user_id = e.created_by) then array[e.created_by]
      else coalesce((select array_agg(m.user_id order by m.joined_at) from public.group_members m where m.group_id = s.group_id and m.role = 'owner'), '{}')
    end,
    queue_filter = coalesce(s.queue_filter, case e.kind when 'flex' then 'flex' else 'scrim' end)
  from public.calendar_events e
  where e.id = s.calendar_event_id and s.status = 'scheduled'
    and e.kind in ('scrim', 'flex', 'tournament')
    and e.starts_at <= now() and e.ends_at > now() - interval '1 hour';

  update public.team_sessions s set status = 'ended', ended_at = now()
  from public.calendar_events e
  where e.id = s.calendar_event_id and s.status = 'live'
    and e.kind in ('scrim', 'flex', 'tournament')
    and e.ends_at <= now() - interval '1 hour';
end;
$$;
revoke all on function public.run_team_session_lifecycle() from public, anon, authenticated;

select cron.schedule('team-session-lifecycle', '* * * * *', 'select public.run_team_session_lifecycle()');
