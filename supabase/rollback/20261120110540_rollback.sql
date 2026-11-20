-- Rollback of 20261120110540_team_sessions_hardening. Run it as one transaction.
-- The table-level UPDATE grant comes back, to authenticated only (CyberSecurity: anon never needed it, the RLS refused it).
-- The availability policies go back to their 20261115221015 body. The recording paths already shortened to a file name stay short: the full
-- local paths cannot be rebuilt (and should not be).

drop trigger if exists team_session_reviews_recording_file_name on public.team_session_reviews;
drop function if exists private.recording_file_name_only();

revoke update (status, responsible_user_ids, queue_filter, started_at, ended_at) on public.team_sessions from authenticated;
grant update on public.team_sessions to authenticated;

drop policy if exists availability_rules_write on public.availability_rules;
create policy availability_rules_write on public.availability_rules
  for all
  using (user_id = auth.uid() or private.can_edit_calendar(group_id))
  with check (user_id = auth.uid() or private.can_edit_calendar(group_id));
drop policy if exists availability_exceptions_write on public.availability_exceptions;
create policy availability_exceptions_write on public.availability_exceptions
  for all
  using (user_id = auth.uid() or private.can_edit_calendar(group_id))
  with check (user_id = auth.uid() or private.can_edit_calendar(group_id));
