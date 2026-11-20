-- Scalability batch 1 (20/11/2026): Supabase Realtime instead of polling.
-- The tables the apps polled in a loop are added to the supabase_realtime publication. Realtime then pushes
-- INSERT and UPDATE events to the subscribers whose RLS SELECT policies let them read the row (each table below
-- has RLS on, with policies scoped to the user or to the user's groups). The clients subscribe to INSERT and
-- UPDATE only (src/lib/realtimeCore.ts), since DELETE events are not filtered by RLS.
-- sync_records is left out on purpose: its rows carry large json and every push would echo to the device that
-- made it, for a slow multi-device sync that polling serves well.
-- Idempotent: a table already published is skipped.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['notifications', 'team_sessions', 'calendar_events', 'calendar_event_responses', 'announcements', 'team_session_reviews'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
