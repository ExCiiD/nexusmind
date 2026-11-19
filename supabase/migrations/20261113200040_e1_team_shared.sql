-- E1: shared team workspace (docs/PLAN_GESTION_EQUIPE.md). A group's roster,
-- champion pools, drafts and scouting notes, editable by the group's staff
-- (owner/coach/analyst) instead of living only on one PC. Players additionally
-- get write access to their OWN pool entries ("son propre pool", §3 of the
-- plan) when their roster row is linked to their account (user_id set).
--
-- v1 scope: publish-once from the desktop (no live two-way sync yet) — see
-- the "publish my team" flow in team.ipc.ts / teamCore.ts.

create table public.team_rosters (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id) on delete cascade,
  -- Set when this roster row corresponds to an actual signed-in group member
  -- (enables "edit my own pool"); null for a roster entry that is just a
  -- name (no account yet, or an external trialist).
  user_id      uuid references auth.users (id) on delete set null,
  display_name text not null check (length(trim(display_name)) between 1 and 64),
  ign          text check (ign is null or length(ign) <= 64),
  tag_line     text check (tag_line is null or length(tag_line) <= 16),
  region       text check (region is null or length(region) <= 16),
  role         text not null check (role in ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')),
  status       text not null default 'starter' check (status in ('starter', 'substitute', 'trial')),
  puuid        text check (puuid is null or length(puuid) <= 100),
  created_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index team_rosters_group_idx on public.team_rosters (group_id);
create unique index team_rosters_group_user_idx on public.team_rosters (group_id, user_id) where user_id is not null;

create table public.team_pool_entries (
  id            uuid primary key default gen_random_uuid(),
  roster_id     uuid not null references public.team_rosters (id) on delete cascade,
  champion_key  text not null check (length(champion_key) between 1 and 64),
  role          text not null check (role in ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')),
  tier          text not null default 'comfort' check (tier in ('main', 'comfort', 'flex', 'learning')),
  notes         text check (notes is null or length(notes) <= 2000),
  play_rate     int check (play_rate is null or play_rate >= 0),
  win_rate      int check (win_rate is null or win_rate between 0 and 100),
  mastery_points int check (mastery_points is null or mastery_points >= 0),
  updated_at    timestamptz not null default now(),
  unique (roster_id, champion_key, role)
);
create index team_pool_entries_roster_idx on public.team_pool_entries (roster_id);

create table public.team_scouting (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  tag          text check (tag is null or length(tag) <= 16),
  scout_notes  text check (scout_notes is null or length(scout_notes) <= 8000),
  created_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index team_scouting_group_idx on public.team_scouting (group_id);

create table public.team_drafts (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 80),
  vs_scouting_id uuid references public.team_scouting (id) on delete set null,
  blue_picks    jsonb not null default '[]'::jsonb check (jsonb_typeof(blue_picks) = 'array' and jsonb_array_length(blue_picks) <= 5),
  blue_bans     jsonb not null default '[]'::jsonb check (jsonb_typeof(blue_bans) = 'array' and jsonb_array_length(blue_bans) <= 5),
  red_picks     jsonb not null default '[]'::jsonb check (jsonb_typeof(red_picks) = 'array' and jsonb_array_length(red_picks) <= 5),
  red_bans      jsonb not null default '[]'::jsonb check (jsonb_typeof(red_bans) = 'array' and jsonb_array_length(red_bans) <= 5),
  my_team_side  text not null default 'blue' check (my_team_side in ('blue', 'red')),
  notes         text check (notes is null or length(notes) <= 4000),
  created_by    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index team_drafts_group_idx on public.team_drafts (group_id);

alter table public.team_rosters enable row level security;
alter table public.team_pool_entries enable row level security;
alter table public.team_scouting enable row level security;
alter table public.team_drafts enable row level security;

-- Rosters / scouting / drafts: any member reads, only staff writes.
create policy "team_rosters_read" on public.team_rosters for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "team_rosters_write_staff" on public.team_rosters for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

create policy "team_scouting_read" on public.team_scouting for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "team_scouting_write_staff" on public.team_scouting for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

create policy "team_drafts_read" on public.team_drafts for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "team_drafts_write_staff" on public.team_drafts for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

-- Pool entries: any group member reads (via the roster's group); staff write
-- any entry, a player writes only the entry linked to their own roster row.
create policy "team_pool_read" on public.team_pool_entries for select to authenticated
  using (exists (
    select 1 from public.team_rosters r
    where r.id = team_pool_entries.roster_id and private.group_role(r.group_id) is not null
  ));
create policy "team_pool_write" on public.team_pool_entries for all to authenticated
  using (exists (
    select 1 from public.team_rosters r
    where r.id = team_pool_entries.roster_id
      and (private.is_group_staff(r.group_id) or r.user_id = (select auth.uid()))
  ))
  with check (exists (
    select 1 from public.team_rosters r
    where r.id = team_pool_entries.roster_id
      and (private.is_group_staff(r.group_id) or r.user_id = (select auth.uid()))
  ));

create trigger team_rosters_touch before update on public.team_rosters
  for each row execute function public.touch_updated_at();
create trigger team_scouting_touch before update on public.team_scouting
  for each row execute function public.touch_updated_at();
create trigger team_drafts_touch before update on public.team_drafts
  for each row execute function public.touch_updated_at();
