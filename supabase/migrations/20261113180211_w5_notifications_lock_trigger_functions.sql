-- The 4 trigger functions below are still exposed via PostgREST RPC to
-- `anon` and `authenticated` by default (every new function grants PUBLIC
-- EXECUTE unless revoked). Revoking EXECUTE closes that surface; it does
-- NOT stop them firing as triggers, since trigger invocation is done by the
-- system and never checks the function's EXECUTE grant.

revoke all on function public.notify_review_comment() from public, anon, authenticated;
revoke all on function public.notify_objective_assigned() from public, anon, authenticated;
revoke all on function public.notify_scrim_created() from public, anon, authenticated;
revoke all on function public.notify_scrim_updated() from public, anon, authenticated;
