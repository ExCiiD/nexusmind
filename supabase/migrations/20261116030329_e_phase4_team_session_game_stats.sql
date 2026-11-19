-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 16/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

alter table public.team_session_games
  add column match_json jsonb,
  add column our_team_id int check (our_team_id in (100, 200)),
  add column enemy_team_name text;
