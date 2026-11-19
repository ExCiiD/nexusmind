-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 14/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

-- E14: web port of the local Team page (roster/pool/draft/scouting).
-- Scouted opponent teams only carried a name/tag/notes stub so far
-- (team_scouting) — their per-member roster+pool was never published,
-- so "scouting" on the web was useless beyond a label. This lets an
-- opponent's roster live in team_rosters too, linked via scouting_id
-- (null = the group's own roster; set = that scouted opponent's roster).
-- No RLS changes needed: team_rosters_write_staff / team_pool_write
-- already key off group_id / roster_id, not on whether a row is an
-- opponent, so staff can already manage opponent rosters+pools and a
-- player still can't touch them (their own-pool carve-out only matches
-- r.user_id = auth.uid(), which a scouted opponent member never has).

alter table public.team_rosters
  add column scouting_id uuid references public.team_scouting (id) on delete cascade;
create index team_rosters_scouting_idx on public.team_rosters (scouting_id);

-- Parity with the desktop ChampionPoolEntry.kda column added for E12
-- (src/lib/threatCore.ts) — average (kills+assists)/max(1,deaths),
-- gated by a 20-game minimum before it's trusted as a threat signal.
alter table public.team_pool_entries
  add column kda double precision check (kda is null or kda >= 0);
