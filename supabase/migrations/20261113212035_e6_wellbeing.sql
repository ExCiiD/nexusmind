-- E6: wellbeing & load (docs/PLAN_GESTION_EQUIPE.md), v1 scope.
--
-- A quick, optional check-in (energy/mood/sleep, 1-5) the player can log
-- before a session. Private by default — visible to a group's staff only
-- once the player opts in via a new `share_wellbeing` sharing flag (unlike
-- the other three sharing flags, this one defaults to false).
--
-- Deferred (documented in PLAN_GESTION_EQUIPE.md): the "weekly playtime > X h
-- + mood declining 3 days" staff alert combines this with Game stats under a
-- SEPARATE consent (share_stats) — v1 ships only the mood-decline half,
-- computed purely from check-ins, to avoid entangling two consent flags in
-- one alert for a first slice.

alter table public.group_sharing add column share_wellbeing boolean not null default false;

create table public.wellbeing_checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  energy     int not null check (energy between 1 and 5),
  mood       int not null check (mood between 1 and 5),
  sleep      int not null check (sleep between 1 and 5),
  note       text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now()
);
create index wellbeing_checkins_user_idx on public.wellbeing_checkins (user_id, created_at desc);

-- Mirrors private.can_read_player_table's shape, dedicated to this one
-- table since it isn't part of the generic sync_records dispatch.
create or replace function private.can_read_wellbeing(p_owner uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members viewer
    join public.group_members owner_m on owner_m.group_id = viewer.group_id and owner_m.user_id = p_owner
    join public.group_sharing s on s.group_id = viewer.group_id and s.user_id = p_owner
    where viewer.user_id = auth.uid()
      and viewer.user_id <> p_owner
      and viewer.role in ('owner', 'coach', 'analyst')
      and s.share_wellbeing = true
  )
$$;
revoke all on function private.can_read_wellbeing(uuid) from public;
grant execute on function private.can_read_wellbeing(uuid) to authenticated;

alter table public.wellbeing_checkins enable row level security;

create policy "wellbeing_checkins_read_own" on public.wellbeing_checkins for select to authenticated
  using (user_id = (select auth.uid()) or private.can_read_wellbeing(user_id));
create policy "wellbeing_checkins_write_own" on public.wellbeing_checkins for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
