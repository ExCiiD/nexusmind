-- #40 analyst features (docs/DESIGN_STATE.md sections 10-12, mockups validated by the user on 19 November 2026).
-- Local only: production needs the user's go-ahead.
--
-- 1. team_session_games.timeline_summary: a team game's objectives and gold curve, extracted from its match-v5
--    timeline (src/lib/teamTimelineCore.ts, a few kB instead of 0.5 to 2 MB). Cached on the game like match_json, so
--    the first member who opens the Objectives tab pays the Riot call and the whole group reads it afterwards.
--    Written by any member, like match_json (team_session_games_write): the same trust.
-- 2. draft_log: the group's drafts (picks, bans, side, result, typed pick order, notes). Members read, the staff
--    writes. created_by is SET NULL: the log stays with the team when its author deletes their account.
-- 3. opponent_dossiers: the staff's dossier on an opponent (summary, suggested bans, game plan, Riot snapshot).
--    The staff reads and writes. Players read a published dossier only. Publishing goes through
--    set_opponent_dossier_status, which notifies the group.
--
-- Opponents are keyed by opponent_key (the name trimmed and lower case, src/lib/analyst.ts opponentKeyOf), not by
-- team_scouting.id: publishing a team rewrites the group's scouting rows, so their ids change.
-- Re-runnable: if not exists, create or replace, drop ... if exists.

-- 1. Summary of a team game -------------------------------------------------------

alter table public.team_session_games add column if not exists timeline_summary jsonb;
alter table public.team_session_games drop constraint if exists team_session_games_timeline_summary_check;
alter table public.team_session_games add constraint team_session_games_timeline_summary_check check (
  timeline_summary is null
  or (jsonb_typeof(timeline_summary) = 'object' and pg_column_size(timeline_summary) <= 65536)
);

-- CyberSecurity (S19-13, 20/11/2026): the staff and the opponent dossier read these games and their summaries, so
-- their integrity matters. Before, any member of the group could rewrite or delete any game of a session.
--   - read: the group's members (unchanged)
--   - insert: a member, as the game's author (reported_by = their account, filled in by default: the apps already
--     released never send it)
--   - update and delete: whoever may run the session (private.can_manage_session) or the game's author
--   - update by column: never timeline_summary, which only set_team_game_timeline_summary writes (below)
alter table public.team_session_games alter column reported_by set default auth.uid();
drop policy if exists team_session_games_write on public.team_session_games;
drop policy if exists team_session_games_insert on public.team_session_games;
drop policy if exists team_session_games_update on public.team_session_games;
drop policy if exists team_session_games_delete on public.team_session_games;
create policy team_session_games_insert on public.team_session_games for insert to authenticated
  with check (reported_by = (select auth.uid()) and private.group_role(private.team_session_group(session_id)) is not null);
create policy team_session_games_update on public.team_session_games for update to authenticated
  using (reported_by = (select auth.uid()) or private.can_manage_session(private.team_session_group(session_id)))
  with check (reported_by = (select auth.uid()) or private.can_manage_session(private.team_session_group(session_id)));
create policy team_session_games_delete on public.team_session_games for delete to authenticated
  using (reported_by = (select auth.uid()) or private.can_manage_session(private.team_session_group(session_id)));
revoke update on public.team_session_games from anon, authenticated;
grant update (status, match_json, our_team_id, enemy_team_name) on public.team_session_games to authenticated;

-- The summary of a game: the staff of the group, whoever may run the session, or the game's author (the app that
-- extracts it). Returns false when the caller may not (the reader then simply does not cache it).
create or replace function public.set_team_game_timeline_summary(p_game uuid, p_summary jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_game public.team_session_games;
  v_group uuid;
begin
  if v_uid is null then
    return false;
  end if;
  select * into v_game from public.team_session_games where id = p_game;
  if v_game.id is null then
    return false;
  end if;
  v_group := private.team_session_group(v_game.session_id);
  if not (v_game.reported_by = v_uid or private.is_group_staff(v_group, v_uid) or private.can_manage_session(v_group, v_uid)) then
    return false;
  end if;
  update public.team_session_games set timeline_summary = p_summary where id = p_game;
  return true;
end;
$$;
revoke all on function public.set_team_game_timeline_summary(uuid, jsonb) from public, anon;
grant execute on function public.set_team_game_timeline_summary(uuid, jsonb) to authenticated;

-- Shared by the two tables below.
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

-- A JSON array of at most n champion names (text), or null when allowed.
create or replace function private.is_champion_list(p jsonb, n integer)
returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= n
    and not exists (select 1 from jsonb_array_elements(p) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 40)
$$;
revoke all on function private.is_champion_list(jsonb, integer) from public, anon;
grant execute on function private.is_champion_list(jsonb, integer) to authenticated;

-- A JSON array of at most 5 picks: {"champion": text, "role": text or null}.
create or replace function private.is_pick_list(p jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 5
    and not exists (
      select 1 from jsonb_array_elements(p) e
      where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e -> 'champion') <> 'string' or length(e ->> 'champion') > 40
        or (e ? 'role' and e -> 'role' <> 'null'::jsonb and (e ->> 'role') not in ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'))
    )
$$;
revoke all on function private.is_pick_list(jsonb) from public, anon;
grant execute on function private.is_pick_list(jsonb) to authenticated;

-- 2. Draft log ---------------------------------------------------------------------

create table if not exists public.draft_log (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups (id) on delete cascade,
  match_id       text check (match_id is null or match_id ~ '^[A-Z0-9]{2,5}_[0-9]{1,15}$'),
  source         text not null check (source in ('flex', 'scrim', 'tournament', 'manual')),
  played_at      timestamptz not null,
  patch          text check (patch is null or patch ~ '^[0-9]{1,2}\.[0-9]{1,2}$'),
  opponent_name  text check (opponent_name is null or length(trim(opponent_name)) between 1 and 80),
  opponent_key   text check (opponent_key is null or length(opponent_key) between 1 and 80),
  side           text not null check (side in ('blue', 'red')),
  win            boolean,
  duration_sec   int check (duration_sec is null or duration_sec between 60 and 14400),
  our_picks      jsonb not null default '[]'::jsonb check (private.is_pick_list(our_picks)),
  their_picks    jsonb not null default '[]'::jsonb check (private.is_pick_list(their_picks)),
  our_bans       jsonb check (our_bans is null or private.is_champion_list(our_bans, 5)),
  their_bans     jsonb check (their_bans is null or private.is_champion_list(their_bans, 5)),
  pick_order     jsonb check (pick_order is null or private.is_champion_list(pick_order, 10)),
  notes          text check (notes is null or length(notes) <= 4000),
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists draft_log_group_match_uniq on public.draft_log (group_id, match_id) where match_id is not null;
create index if not exists draft_log_group_idx on public.draft_log (group_id, played_at desc);

drop trigger if exists draft_log_touch on public.draft_log;
create trigger draft_log_touch before update on public.draft_log
  for each row execute function private.touch_updated_at();

alter table public.draft_log enable row level security;
drop policy if exists "draft_log_read" on public.draft_log;
create policy "draft_log_read" on public.draft_log for select to authenticated
  using (private.group_role(group_id) is not null);
-- The staff writes. The author is the caller (not forgeable), and a row never moves to another group or game.
drop policy if exists "draft_log_write_staff" on public.draft_log;
drop policy if exists "draft_log_insert_staff" on public.draft_log;
create policy "draft_log_insert_staff" on public.draft_log for insert to authenticated
  with check (private.is_group_staff(group_id) and created_by = (select auth.uid()));
drop policy if exists "draft_log_update_staff" on public.draft_log;
create policy "draft_log_update_staff" on public.draft_log for update to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));
drop policy if exists "draft_log_delete_staff" on public.draft_log;
create policy "draft_log_delete_staff" on public.draft_log for delete to authenticated
  using (private.is_group_staff(group_id));
revoke all on public.draft_log from anon;
revoke update on public.draft_log from authenticated;
grant update (source, played_at, patch, opponent_name, opponent_key, side, win, duration_sec, our_picks, their_picks,
  our_bans, their_bans, pick_order, notes) on public.draft_log to authenticated;

-- 3. Opponent dossiers -------------------------------------------------------------

create table if not exists public.opponent_dossiers (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups (id) on delete cascade,
  opponent_key    text not null check (length(opponent_key) between 1 and 80),
  opponent_name   text not null check (length(trim(opponent_name)) between 1 and 80),
  how_they_play   text check (how_they_play is null or length(how_they_play) <= 600),
  suggested_bans  jsonb not null default '[]'::jsonb check (private.is_champion_list(suggested_bans, 5)),
  game_plan       text check (game_plan is null or length(game_plan) <= 600),
  status          text not null default 'draft' check (status in ('draft', 'published')),
  published_at    timestamptz,
  snapshot        jsonb check (snapshot is null or (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 65536)),
  snapshot_at     timestamptz,
  updated_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (group_id, opponent_key),
  check ((status = 'published') = (published_at is not null))
);

-- updated_at and updated_by are set here, never by the client.
create or replace function private.opponent_dossiers_touch()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end
$$;
revoke all on function private.opponent_dossiers_touch() from public, anon, authenticated;
drop trigger if exists opponent_dossiers_touch on public.opponent_dossiers;
create trigger opponent_dossiers_touch before insert or update on public.opponent_dossiers
  for each row execute function private.opponent_dossiers_touch();

alter table public.opponent_dossiers enable row level security;
-- The staff reads everything, players a published dossier of their group only.
drop policy if exists "opponent_dossiers_read" on public.opponent_dossiers;
create policy "opponent_dossiers_read" on public.opponent_dossiers for select to authenticated
  using (private.is_group_staff(group_id) or (status = 'published' and private.group_role(group_id) is not null));
-- The staff creates drafts and edits them. The status only changes through set_opponent_dossier_status.
drop policy if exists "opponent_dossiers_insert_staff" on public.opponent_dossiers;
create policy "opponent_dossiers_insert_staff" on public.opponent_dossiers for insert to authenticated
  with check (private.is_group_staff(group_id) and status = 'draft' and published_at is null);
drop policy if exists "opponent_dossiers_update_staff" on public.opponent_dossiers;
create policy "opponent_dossiers_update_staff" on public.opponent_dossiers for update to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));
drop policy if exists "opponent_dossiers_delete_staff" on public.opponent_dossiers;
create policy "opponent_dossiers_delete_staff" on public.opponent_dossiers for delete to authenticated
  using (private.is_group_staff(group_id));
revoke all on public.opponent_dossiers from anon;
revoke update on public.opponent_dossiers from authenticated;
grant update (opponent_name, how_they_play, suggested_bans, game_plan, snapshot, snapshot_at)
  on public.opponent_dossiers to authenticated;

-- Publish (notifies every other member of the group) or back to draft. Staff only.
create or replace function public.set_opponent_dossier_status(p_id uuid, p_status text)
returns public.opponent_dossiers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.opponent_dossiers;
  member record;
begin
  if p_status not in ('draft', 'published') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  select * into v_row from public.opponent_dossiers where id = p_id for update;
  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null or not private.is_group_staff(v_row.group_id, v_uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_row.status = p_status then
    return v_row;
  end if;
  update public.opponent_dossiers
    set status = p_status,
        published_at = case when p_status = 'published' then now() else null end,
        updated_by = v_uid
    where id = p_id
    returning * into v_row;
  if p_status = 'published' then
    for member in select user_id from public.group_members where group_id = v_row.group_id and user_id <> v_uid loop
      perform private.notify(member.user_id, 'dossier_published',
        jsonb_build_object('groupId', v_row.group_id, 'dossierId', v_row.id, 'opponentKey', v_row.opponent_key, 'opponentName', v_row.opponent_name),
        '/coaching');
    end loop;
  end if;
  return v_row;
end;
$$;
revoke all on function public.set_opponent_dossier_status(uuid, text) from public, anon;
grant execute on function public.set_opponent_dossier_status(uuid, text) to authenticated;

-- 4. Notification types: the full list, the same as 20261119280000_member_staff_roles, so the two migrations can be
--    applied in either order without one dropping the other's types.
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
