-- Rollback of 20261120110520_team_session_prep (preparing a team session ahead). Run it as one transaction.
-- Lost: each player's session objectives, the coach's messages and the drafts attached to sessions. The collective
-- objectives stay.

drop table if exists public.team_session_drafts;
drop table if exists public.team_session_prep_notes;
drop table if exists public.team_session_player_objectives;
drop function if exists public.can_prepare_team_session(uuid);
drop function if exists private.session_draft_same_group();
drop function if exists private.is_draft_slots(jsonb);
drop function if exists private.text_items_within(text[], int);

-- The collective objectives: back to the session's managers only (20261116015733_e_phase3_team_sessions).
drop policy if exists team_session_objectives_write on public.team_session_objectives;
create policy team_session_objectives_write on public.team_session_objectives
  for all
  using (private.can_manage_session(private.team_session_group(session_id)))
  with check (private.can_manage_session(private.team_session_group(session_id)));
drop function if exists private.can_prepare_session(uuid, uuid);
