-- Deleting team sessions, one or several at once (user's decision of 28/11/2026, docs/DECISIONS.md "Suppression des
-- sessions d'équipe"). NOT APPLIED: Cyber review then the user's go first. Rollback: supabase/rollback/20261128150000_rollback.sql.
--
--   1. Who: the group's owner, coach and manager (main role or extra staff role, private.has_group_role). Not the
--      captain, not the analyst, not a player. Checked here, server side: team_sessions has no DELETE policy, so a
--      direct DELETE through the REST API stays refused by RLS, and this function is the only way.
--   2. What goes: the session row and, through the existing "on delete cascade" (checked on production on 28/11):
--      team_session_objectives, team_session_games (the session-game links and their cached Riot match),
--      team_session_reviews, team_session_feedback, team_session_attendance, team_session_objective_results,
--      team_session_player_objectives, team_session_prep_notes, team_session_drafts. Nothing outside those tables
--      references team_sessions or team_session_games.
--      What stays: each player's games, stats and videos (sync_records and each PC's local base: no foreign key to
--      these tables), the Planning slot (calendar_events, its scrim row and its responses), the recording files on disk.
--   3. Only an ended session (the history lists ended sessions only). A scheduled or live one is refused (not_ended).
--   4. It does not come back: private.team_session_deletions remembers the slot of a deleted session, and
--      private.team_session_follows_event (the trigger that recreates a session when a slot of a team kind is updated)
--      skips those slots. The clients re-read the history from the cloud: no local copy to purge.
--   5. One call, a list of ids (100 at most, duplicates counted once), one result per id in the order given:
--      deleted, refused (not_staff, not_ended, error) or not_found. Each session is deleted in its own subtransaction:
--      one that fails does not undo the others. A session of a group the caller is not a member of reads not_found
--      (its existence is not revealed).
-- Re-runnable: if not exists, create or replace. No semicolon inside a comment.

-- 1. The slots of deleted sessions --------------------------------------------------------------------------------

create table if not exists private.team_session_deletions (
  event_id uuid primary key,
  session_id uuid not null,
  group_id uuid not null references public.groups (id) on delete cascade,
  deleted_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz not null default now()
);
create index if not exists team_session_deletions_group on private.team_session_deletions (group_id);
revoke all on private.team_session_deletions from public, anon, authenticated;

-- 2. A deleted session's slot does not get a new session ----------------------------------------------------------
-- Body of 20261120110436_team_session_auto_lifecycle, plus the "and not exists (... team_session_deletions ...)".

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
    if new.kind in ('scrim', 'flex', 'tournament', 'meeting')
       and not exists (select 1 from private.team_session_deletions d where d.event_id = new.id) then
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

-- 3. Deleting -----------------------------------------------------------------------------------------------------

create or replace function public.delete_team_sessions(p_session_ids uuid[])
returns table (session_id uuid, status text, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_row public.team_sessions;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_session_ids is null or cardinality(p_session_ids) = 0 then
    return;
  end if;
  if cardinality(p_session_ids) > 100 then
    raise exception 'TOO_MANY' using errcode = '22023';
  end if;

  for v_id in
    select u.id from unnest(p_session_ids) with ordinality as u(id, n)
    where u.id is not null
    group by u.id order by min(u.n)
  loop
    session_id := v_id;
    reason := null;
    begin
      select * into v_row from public.team_sessions s where s.id = v_id for update;
      if v_row.id is null or private.group_role(v_row.group_id, v_uid) is null then
        status := 'not_found';
      elsif not private.has_group_role(v_row.group_id, array['owner', 'coach', 'manager'], v_uid) then
        status := 'refused'; reason := 'not_staff';
      elsif v_row.status <> 'ended' then
        status := 'refused'; reason := 'not_ended';
      else
        if coalesce(v_row.calendar_event_id, v_row.event_id) is not null then
          insert into private.team_session_deletions (event_id, session_id, group_id, deleted_by)
          values (coalesce(v_row.calendar_event_id, v_row.event_id), v_row.id, v_row.group_id, v_uid)
          on conflict (event_id) do update set session_id = excluded.session_id, deleted_by = excluded.deleted_by, deleted_at = now();
        end if;
        delete from public.team_sessions s where s.id = v_id;
        status := 'deleted';
      end if;
    exception when others then
      -- This session only: its subtransaction is rolled back, the others keep their result.
      status := 'refused'; reason := 'error';
    end;
    v_row := null;
    return next;
  end loop;
end;
$$;
revoke all on function public.delete_team_sessions(uuid[]) from public, anon;
grant execute on function public.delete_team_sessions(uuid[]) to authenticated;
