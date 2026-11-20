-- Team session history (DESIGN_STATE.md § 15, 20/11/2026, contract docs/contracts/team-session-history.md): the
-- staff's verdict "held / not held" on each objective of a team session, game by game or for the whole session.
-- The automatic measure (PROPOSITION_ANALYSTE.md § 8) does not exist yet and the session KPIs are qualitative, so the
-- page of a finished session shows "held / not held" from this verdict.
--
--   - one row per (session, objective, game), game null = the whole session (unique nulls not distinct)
--   - objective_id: the fundamental's id, as in team_session_objectives.objective_ids
--   - read by the group's members (same rule as team_session_objectives)
--   - written only through public.set_team_session_objective_result, by the session's managers
--     (private.can_manage_session: owner, coach, manager, captain). p_met null removes the verdict.
--   - a game of another session is NOT_FOUND
-- Re-runnable: if not exists, create or replace. No semicolon inside a comment.

create table if not exists public.team_session_objective_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.team_sessions (id) on delete cascade,
  game_id uuid references public.team_session_games (id) on delete cascade,
  objective_id text not null check (length(objective_id) between 1 and 128),
  met boolean not null,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  constraint team_session_objective_results_one unique nulls not distinct (session_id, objective_id, game_id)
);
create index if not exists team_session_objective_results_game on public.team_session_objective_results (game_id);

alter table public.team_session_objective_results enable row level security;
drop policy if exists team_session_objective_results_read on public.team_session_objective_results;
create policy team_session_objective_results_read on public.team_session_objective_results
  for select to authenticated using (private.group_role(private.team_session_group(session_id)) is not null);
revoke all on public.team_session_objective_results from anon, authenticated;
grant select on public.team_session_objective_results to authenticated;

create or replace function public.set_team_session_objective_result(p_session uuid, p_objective text, p_game uuid, p_met boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
begin
  select group_id into v_group from public.team_sessions where id = p_session;
  if v_group is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null or not private.can_manage_session(v_group, v_uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_objective is null or length(p_objective) not between 1 and 128 then
    raise exception 'INVALID_OBJECTIVE' using errcode = '22023';
  end if;
  if p_game is not null and not exists (select 1 from public.team_session_games where id = p_game and session_id = p_session) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_met is null then
    delete from public.team_session_objective_results
    where session_id = p_session and objective_id = p_objective and game_id is not distinct from p_game;
    return;
  end if;
  insert into public.team_session_objective_results (session_id, game_id, objective_id, met, set_by)
  values (p_session, p_game, p_objective, p_met, v_uid)
  on conflict on constraint team_session_objective_results_one
  do update set met = excluded.met, set_by = excluded.set_by, set_at = now();
end;
$$;
revoke all on function public.set_team_session_objective_result(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.set_team_session_objective_result(uuid, text, uuid, boolean) to authenticated;
