-- Rollback of 20261120140000_realtime_publication: the six tables leave the supabase_realtime publication.
-- The publication itself stays (Supabase owns it). The apps fall back to their slow polling on their own.

do $$
declare
  t text;
begin
  foreach t in array array['notifications', 'team_sessions', 'calendar_events', 'calendar_event_responses', 'announcements', 'team_session_reviews'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$$;
