-- Rollback of 20261119223819_analyst_draft_log_dossiers (#40 analyst features). Run it as one transaction.
-- It removes what the migration added:
--   1. the two tables (draft_log, opponent_dossiers) with their triggers and policies, and the publishing RPC
--   2. the helper functions only these tables use
--   3. team_session_games.timeline_summary and its check, and the game access rules of S19-13 (back to "any member
--      writes", as in production before)
-- The draft log, the dossiers and the cached game summaries written since are LOST (export them first if needed).
-- The notification type list is left as it is: 20261119211601_member_staff_roles (in production) already holds
-- 'dossier_published', so this rollback has nothing to restore there.
-- Re-runnable: drop ... if exists.

drop function if exists public.set_opponent_dossier_status(uuid, text);
drop table if exists public.opponent_dossiers;
drop table if exists public.draft_log;
drop function if exists private.opponent_dossiers_touch();
drop function if exists private.is_pick_list(jsonb);
drop function if exists private.is_champion_list(jsonb, integer);
drop function if exists private.touch_updated_at();

-- team_session_games' access back to its production state (e_phase3_team_sessions): one write policy for any
-- member, the table's default grants, no default author.
drop function if exists public.set_team_game_timeline_summary(uuid, jsonb);
drop policy if exists team_session_games_insert on public.team_session_games;
drop policy if exists team_session_games_update on public.team_session_games;
drop policy if exists team_session_games_delete on public.team_session_games;
drop policy if exists team_session_games_write on public.team_session_games;
create policy team_session_games_write on public.team_session_games
  for all
  using (private.group_role(private.team_session_group(session_id)) is not null)
  with check (private.group_role(private.team_session_group(session_id)) is not null);
revoke update (status, match_json, our_team_id, enemy_team_name) on public.team_session_games from authenticated;
grant update on public.team_session_games to anon, authenticated;
alter table public.team_session_games alter column reported_by drop default;

alter table public.team_session_games drop constraint if exists team_session_games_timeline_summary_check;
alter table public.team_session_games drop column if exists timeline_summary;
