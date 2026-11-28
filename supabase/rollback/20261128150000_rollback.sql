-- Rollback of 20261128150000_team_session_delete (deleting team sessions). Run it as one transaction.
-- The deleted sessions do not come back (their rows and what cascaded are gone). What changes: the staff can no
-- longer delete sessions, and a slot whose session was deleted gets an empty session again the next time the slot
-- is edited (the trigger body of 20261120110436_team_session_auto_lifecycle, restored below).

drop function if exists public.delete_team_sessions(uuid[]);

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

drop table if exists private.team_session_deletions;
