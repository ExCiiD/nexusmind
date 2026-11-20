-- Rollback of 20261120110354_team_session_objective_results (team session history). Run it as one transaction.
-- The staff's "held / not held" verdicts are lost. Nothing else changes.

drop function if exists public.set_team_session_objective_result(uuid, text, uuid, boolean);
drop table if exists public.team_session_objective_results;
