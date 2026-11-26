-- Rollback of 20261126090000_team_data_scoped_to_linked_group: back to the production rule of 20261119165435
-- (the reading rule is private.can_read_player_table alone, a staff member of any shared group reads the team data
-- once share_team is true). Re-runnable. No semicolon inside a comment.

drop policy if exists sync_records_read_shared on public.sync_records;
create policy sync_records_read_shared on public.sync_records
  for select to authenticated
  using (private.can_read_player_table(user_id, table_name));

drop function if exists private.can_read_synced_row(uuid, text, jsonb);
drop function if exists private.synced_team_group(uuid, text, jsonb);
