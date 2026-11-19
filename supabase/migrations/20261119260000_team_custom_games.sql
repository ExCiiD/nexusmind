-- #41a (docs/AUDIT_SECURITE.md, 19/11/2026): the group's players had no
-- Scrim / Tournament stats. Custom games imported from a Replaybook CSV
-- stayed in the SQLite of the staff member's PC; the only way across was
-- their personal sync_records (S19-17: the wrong scope, now staff only).
--
-- team_custom_games belongs to the group, like team_rosters and team_drafts:
-- every member reads, the staff writes. The staff's app publishes each
-- import here (keyed by its local id, so a re-publish never duplicates) and
-- reads the group's games back for the group's team. created_by is SET NULL:
-- the games stay with the team when their importer deletes their account.
-- Not applied anywhere yet: production needs the user's go-ahead.

create table if not exists public.team_custom_games (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  game_type     text not null check (game_type in ('scrim', 'tournament')),
  game_date     timestamptz,
  duration_sec  int not null check (duration_sec between 60 and 14400),
  win           boolean,
  -- Participant rows in Riot match-V5 shape (see CustomGame.participantsJson).
  participants  jsonb not null
    check (jsonb_typeof(participants) = 'array' and jsonb_array_length(participants) between 1 and 20),
  source_file   text check (source_file is null or length(source_file) <= 200),
  -- The CustomGame id on the importing PC: de-duplication and deletion.
  local_id      text check (local_id is null or length(local_id) <= 64),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (group_id, local_id)
);
create index if not exists team_custom_games_group_idx on public.team_custom_games (group_id, game_type, created_at desc);

alter table public.team_custom_games enable row level security;

drop policy if exists "team_custom_games_read" on public.team_custom_games;
create policy "team_custom_games_read" on public.team_custom_games for select to authenticated
  using (private.group_role(group_id) is not null);

drop policy if exists "team_custom_games_write_staff" on public.team_custom_games;
create policy "team_custom_games_write_staff" on public.team_custom_games for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

revoke all on public.team_custom_games from anon;
