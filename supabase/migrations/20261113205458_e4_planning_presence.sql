-- E4: planning & presence (docs/PLAN_GESTION_EQUIPE.md), v1 scope.
--
-- Scrims already have their own workflow (W4: public.scrims / scrim_availability,
-- web-only, with prep checklist + per-scrim RSVP) — not duplicated here. This
-- adds the OTHER calendar event kinds the plan asks for (tournament, team
-- review, 1:1, soloQ block, rest) plus recurring weekly availability with
-- date-specific exceptions, so staff can see when all starters are free.
--
-- Deferred (documented in PLAN_GESTION_EQUIPE.md): merging scrims into one
-- unified calendar view, auto-matching played customs to a slot for a real
-- attendance rate (T5 — depends on custom-game auto-import, not built yet),
-- and a live iCal *subscription* URL (v1 ships a point-in-time .ics download
-- instead, generated client-side — no Edge Function needed for that).

create table public.calendar_events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  kind       text not null check (kind in ('tournament', 'team_review', 'one_on_one', 'soloq_block', 'rest', 'other')),
  title      text not null check (length(trim(title)) between 1 and 120),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null check (ends_at > starts_at),
  notes      text check (notes is null or length(notes) <= 2000),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calendar_events_group_starts_idx on public.calendar_events (group_id, starts_at);

-- Recurring weekly availability: "every Monday 18:00-22:00" etc.
create table public.availability_rules (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  weekday    int not null check (weekday between 0 and 6), -- 0 = Sunday, matches JS Date#getDay()
  start_time time not null,
  end_time   time not null check (end_time > start_time),
  created_at timestamptz not null default now()
);
create index availability_rules_group_user_idx on public.availability_rules (group_id, user_id);

-- One-off overrides for a specific date (exception to the recurring rule):
-- either "not available that day" (available = false) or a different window.
create table public.availability_exceptions (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date       date not null,
  available  boolean not null default false,
  start_time time,
  end_time   time check (end_time is null or start_time is null or end_time > start_time),
  note       text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (group_id, user_id, date)
);
create index availability_exceptions_group_date_idx on public.availability_exceptions (group_id, date);

alter table public.calendar_events enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;

-- Events: any group member reads, only staff writes (scrims keep their own
-- staff-managed workflow; this covers the other event kinds).
create policy "calendar_events_read" on public.calendar_events for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "calendar_events_write_staff" on public.calendar_events for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

-- Availability: any group member reads everyone's (needed to find common free
-- slots); each user writes only their own rows, staff can also manage any
-- (covers setting up availability for a player who hasn't signed in yet).
create policy "availability_rules_read" on public.availability_rules for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "availability_rules_write" on public.availability_rules for all to authenticated
  using (user_id = (select auth.uid()) or private.is_group_staff(group_id))
  with check (user_id = (select auth.uid()) or private.is_group_staff(group_id));

create policy "availability_exceptions_read" on public.availability_exceptions for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "availability_exceptions_write" on public.availability_exceptions for all to authenticated
  using (user_id = (select auth.uid()) or private.is_group_staff(group_id))
  with check (user_id = (select auth.uid()) or private.is_group_staff(group_id));

create trigger calendar_events_touch before update on public.calendar_events
  for each row execute function public.touch_updated_at();
