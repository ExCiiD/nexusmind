-- Handoff #11 (docs/notes/BACKEND_NOTES.md): deletion markers of sync_records (deleted = true) pile up for ever.
-- private.purge_sync_tombstones(p_days) removes the ones older than p_days (90 by default, never less than 30).
-- Run by the service role only (no cron here, a schedule is a separate decision). A device that stayed offline longer
-- than p_days and still holds the deleted row would push it back: the retention must stay above the longest offline
-- period the app tolerates, which is why the floor is 30 and the default 90. Returns the number of rows removed.
-- Re-runnable. No semicolon inside a comment.

create or replace function private.purge_sync_tombstones(p_days int default 90)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  n bigint;
begin
  if p_days is null or p_days < 30 then
    raise exception 'p_days must be at least 30';
  end if;
  delete from public.sync_records
  where deleted and updated_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function private.purge_sync_tombstones(int) from public, anon, authenticated;
grant execute on function private.purge_sync_tombstones(int) to service_role;
