-- Fix: team_rosters/team_pool_entries.role used Riot's TOP/JUNGLE/MIDDLE/
-- BOTTOM/UTILITY naming, but this table mirrors the LOCAL TeamMember /
-- ChampionPoolEntry models, which use TOP/JUNGLE/MID/ADC/SUPPORT (see
-- src/pages/Team/RosterTab.tsx). Matching it avoids a translation layer
-- (and the bugs that come with one) between the desktop publish flow and
-- these tables. No data exists yet (just-applied migration), so a plain
-- constraint swap is safe.

alter table public.team_rosters drop constraint team_rosters_role_check;
alter table public.team_rosters add constraint team_rosters_role_check
  check (role in ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'));

alter table public.team_pool_entries drop constraint team_pool_entries_role_check;
alter table public.team_pool_entries add constraint team_pool_entries_role_check
  check (role in ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'));
