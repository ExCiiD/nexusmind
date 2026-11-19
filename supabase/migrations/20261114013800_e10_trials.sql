-- E10: recruitment / trials (docs/PLAN_GESTION_EQUIPE.md), v1 scope.
--
-- Kept independent from team_rosters on purpose: publishing a team (E1)
-- deletes and reinserts every roster row, so a trial record FK'd to
-- roster_id would be silently wiped on the next publish. A trial candidate
-- is its own standalone entity instead — a name + role the staff are
-- evaluating, optionally linked to a real account once they sign up.
--
-- Deferred (documented in PLAN_GESTION_EQUIPE.md): automated promotion into
-- the live roster (no live roster editing exists yet, see E1's own
-- remaining items) and a real performance diff against the starter (would
-- need the starter's shared stats under consent) — v1 shows the trial's
-- own evaluation scores next to whoever the published roster currently
-- lists as starter for that role, for staff to judge manually.

create table public.trial_candidates (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 64),
  role         text not null check (role in ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT')),
  -- Set once the trialist has signed up and staff link their account.
  user_id      uuid references auth.users (id) on delete set null,
  status       text not null default 'trialing' check (status in ('trialing', 'kept', 'rejected')),
  period_start date,
  period_end   date,
  notes        text check (notes is null or length(notes) <= 4000),
  created_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index trial_candidates_group_idx on public.trial_candidates (group_id, status);

create table public.trial_evaluations (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.trial_candidates (id) on delete cascade,
  criterion    text not null check (length(trim(criterion)) between 1 and 80),
  score        int not null check (score between 1 and 5),
  note         text check (note is null or length(note) <= 1000),
  created_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index trial_evaluations_candidate_idx on public.trial_evaluations (candidate_id);

alter table public.trial_candidates enable row level security;
alter table public.trial_evaluations enable row level security;

-- Staff-only end to end: trials are an internal recruitment tool, not
-- something the candidate (who may not even have signed up yet) needs to see.
create policy "trial_candidates_staff" on public.trial_candidates for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

create policy "trial_evaluations_staff" on public.trial_evaluations for all to authenticated
  using (exists (select 1 from public.trial_candidates c where c.id = trial_evaluations.candidate_id and private.is_group_staff(c.group_id)))
  with check (exists (select 1 from public.trial_candidates c where c.id = trial_evaluations.candidate_id and private.is_group_staff(c.group_id)));

create trigger trial_candidates_touch before update on public.trial_candidates
  for each row execute function public.touch_updated_at();
