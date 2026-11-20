-- Two low CyberSecurity findings (20/11/2026, before the next release, not blocking):
--
--   (b) team_sessions: the session's managers may UPDATE the row (policy team_sessions_write), and the table-level grant
--       let them write any column, group_id and calendar_event_id included (and the slot's copy, event_*, of
--       20261120160000). The grant is now per column: what the app writes when it starts or ends a session (status,
--       responsible_user_ids, queue_filter, started_at, ended_at). The triggers and the clock job run as the owner and
--       keep writing the other columns.
--   (e) availability_rules_write and availability_exceptions_write (CyberSecurity, beta.13): the availability's owner
--       must be a member of the group, whoever writes it (themself, or someone who edits the calendar). Before, a
--       signed-in user could write their own availability into any group.
--   (c) team_session_reviews.recording_local_path showed the group's members the recorder's local path, with the
--       Windows user name in it. Only the file name is kept: a trigger strips the folders from what any app version
--       writes, and the existing rows are cleaned here. The desktop finds the file again by its name in its own
--       recordings folders (electron/main/mediaAccess.ts, resolveMediaFile).
-- Re-runnable: create or replace, drop ... if exists. No semicolon inside a comment.

-- (b) -----------------------------------------------------------------------------------------------------

revoke update on public.team_sessions from anon, authenticated;
grant update (status, responsible_user_ids, queue_filter, started_at, ended_at) on public.team_sessions to authenticated;

-- (e) -----------------------------------------------------------------------------------------------------

drop policy if exists availability_rules_write on public.availability_rules;
create policy availability_rules_write on public.availability_rules
  for all
  using (user_id = auth.uid() or private.can_edit_calendar(group_id))
  with check (private.group_role(group_id, user_id) is not null and (user_id = auth.uid() or private.can_edit_calendar(group_id)));

drop policy if exists availability_exceptions_write on public.availability_exceptions;
create policy availability_exceptions_write on public.availability_exceptions
  for all
  using (user_id = auth.uid() or private.can_edit_calendar(group_id))
  with check (private.group_role(group_id, user_id) is not null and (user_id = auth.uid() or private.can_edit_calendar(group_id)));

-- (c) -----------------------------------------------------------------------------------------------------

create or replace function private.recording_file_name_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recording_local_path is not null then
    new.recording_local_path := nullif(regexp_replace(new.recording_local_path, '^.*[/\\]', ''), '');
  end if;
  return new;
end;
$$;
revoke all on function private.recording_file_name_only() from public, anon, authenticated;

drop trigger if exists team_session_reviews_recording_file_name on public.team_session_reviews;
create trigger team_session_reviews_recording_file_name
  before insert or update of recording_local_path on public.team_session_reviews
  for each row execute function private.recording_file_name_only();

update public.team_session_reviews
set recording_local_path = nullif(regexp_replace(recording_local_path, '^.*[/\\]', ''), '')
where recording_local_path ~ '[/\\]';
