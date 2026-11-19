-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 16/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

-- Phase 3 (Planning rework §9): team sessions — lifecycle shell. A
-- scrim/flex/tournament/meeting calendar event auto-becomes a team
-- session (status 'scheduled'); a responsible (owner/coach/manager/
-- captain) sets objectives and starts it ('live'), ends it ('ended').
-- responsible_user_ids is captured at start time, not derived live, so a
-- responsible leaving the roster mid-session doesn't retroactively strip
-- review rights (see teamSessionsCore.ts).

create table public.team_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  calendar_event_id uuid not null unique references public.calendar_events(id) on delete cascade,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended')),
  responsible_user_ids uuid[] not null default '{}',
  queue_filter text check (queue_filter in ('flex', 'scrim', 'ranked5', 'all')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index team_sessions_group_id_idx on public.team_sessions(group_id);
create index team_sessions_status_idx on public.team_sessions(status);

alter table public.team_sessions enable row level security;
create policy team_sessions_read on public.team_sessions
  for select using (private.group_role(group_id) is not null);
create policy team_sessions_write on public.team_sessions
  for update using (private.can_manage_session(group_id)) with check (private.can_manage_session(group_id));

-- Auto-creates the session the moment a qualifying event exists — "ouvre
-- automatiquement" per the request; SECURITY DEFINER so this always
-- succeeds regardless of who (any can_edit_calendar member) created the
-- event, bypassing team_sessions' own RLS (which has no INSERT policy —
-- the trigger is the ONLY way a row is ever created).
create or replace function public.auto_create_team_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('scrim', 'flex', 'tournament', 'meeting') then
    insert into public.team_sessions (group_id, calendar_event_id)
    values (new.group_id, new.id)
    on conflict (calendar_event_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger calendar_event_auto_team_session
  after insert on public.calendar_events
  for each row execute function public.auto_create_team_session();

-- Resolves a session's group for RLS on its child tables (same pattern as
-- private.vod_session_group).
create or replace function private.team_session_group(p_session uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select group_id from public.team_sessions where id = p_session
$$;

create table public.team_session_objectives (
  session_id uuid primary key references public.team_sessions(id) on delete cascade,
  objective_ids text[] not null default '{}',
  kpi_ids text[] not null default '{}',
  set_by uuid references auth.users(id),
  set_at timestamptz not null default now()
);
alter table public.team_session_objectives enable row level security;
create policy team_session_objectives_read on public.team_session_objectives
  for select using (private.group_role(private.team_session_group(session_id)) is not null);
create policy team_session_objectives_write on public.team_session_objectives
  for all
  using (private.can_manage_session(private.team_session_group(session_id)))
  with check (private.can_manage_session(private.team_session_group(session_id)));

-- "+ Add a fundamental" — objective-only (no KPI sub-scoring), merged with
-- the static FUNDAMENTALS list at read time (src/lib/fundamentals.ts).
create table public.group_fundamentals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.group_fundamentals enable row level security;
create policy group_fundamentals_read on public.group_fundamentals
  for select using (private.group_role(group_id) is not null);
create policy group_fundamentals_write on public.group_fundamentals
  for all using (private.can_manage_session(group_id)) with check (private.can_manage_session(group_id));

-- The shared-matchId link row (architecture note: a 5-stack scrim/flex/
-- tournament game shares one Riot matchId across all 10 participants, so
-- this needs exactly one match-v5 fetch per game, not live multi-account
-- polling — any concerned member's own GameDetector can report it,
-- deduped by the unique constraint below).
create table public.team_session_games (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.team_sessions(id) on delete cascade,
  match_id text not null,
  reported_by uuid references auth.users(id),
  status text not null default 'pending_fetch' check (status in ('pending_fetch', 'fetched', 'error')),
  created_at timestamptz not null default now(),
  unique (session_id, match_id)
);
alter table public.team_session_games enable row level security;
create policy team_session_games_read on public.team_session_games
  for select using (private.group_role(private.team_session_group(session_id)) is not null);
create policy team_session_games_write on public.team_session_games
  for all
  using (private.group_role(private.team_session_group(session_id)) is not null)
  with check (private.group_role(private.team_session_group(session_id)) is not null);
