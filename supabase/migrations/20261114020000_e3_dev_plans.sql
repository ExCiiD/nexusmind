-- E3: individual development plans (docs/PLAN_GESTION_EQUIPE.md). Per
-- (group, player): 2-3 quarterly axes (fundamentals) with a staff-set
-- status, plus a 1:1 history. The player reads everything and marks their
-- own progress in a separate table (dev_plan_progress) so RLS doesn't need
-- a column-level guard on the staff-owned axis row.

create table public.dev_plans (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id) on delete cascade,
  player_id    uuid not null references auth.users (id) on delete cascade,
  title        text not null check (length(trim(title)) between 1 and 80),
  period_start date,
  period_end   date,
  created_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index dev_plans_group_player_idx on public.dev_plans (group_id, player_id);

create table public.dev_plan_axes (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.dev_plans (id) on delete cascade,
  fundamental_id text not null check (length(fundamental_id) <= 64),
  target_text  text not null check (length(trim(target_text)) between 1 and 500),
  position     int not null default 1 check (position between 1 and 3),
  status       text not null default 'active' check (status in ('active', 'done', 'dropped')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (plan_id, position)
);
create index dev_plan_axes_plan_idx on public.dev_plan_axes (plan_id);

create table public.dev_plan_checkins (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.dev_plans (id) on delete cascade,
  note       text not null check (length(trim(note)) between 1 and 4000),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index dev_plan_checkins_plan_idx on public.dev_plan_checkins (plan_id, created_at desc);

create table public.dev_plan_progress (
  axis_id           uuid primary key references public.dev_plan_axes (id) on delete cascade,
  player_marked_done boolean not null default false,
  player_note       text check (player_note is null or length(player_note) <= 1000),
  updated_at        timestamptz not null default now()
);

alter table public.dev_plans enable row level security;
alter table public.dev_plan_axes enable row level security;
alter table public.dev_plan_checkins enable row level security;
alter table public.dev_plan_progress enable row level security;

-- Plans: the player it's about, or the group's staff.
create policy "dev_plans_read" on public.dev_plans for select to authenticated
  using (player_id = (select auth.uid()) or private.is_group_staff(group_id));
create policy "dev_plans_write_staff" on public.dev_plans for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

create policy "dev_plan_axes_read" on public.dev_plan_axes for select to authenticated
  using (exists (
    select 1 from public.dev_plans p where p.id = dev_plan_axes.plan_id
      and (p.player_id = (select auth.uid()) or private.is_group_staff(p.group_id))
  ));
create policy "dev_plan_axes_write_staff" on public.dev_plan_axes for all to authenticated
  using (exists (select 1 from public.dev_plans p where p.id = dev_plan_axes.plan_id and private.is_group_staff(p.group_id)))
  with check (exists (select 1 from public.dev_plans p where p.id = dev_plan_axes.plan_id and private.is_group_staff(p.group_id)));

create policy "dev_plan_checkins_read" on public.dev_plan_checkins for select to authenticated
  using (exists (
    select 1 from public.dev_plans p where p.id = dev_plan_checkins.plan_id
      and (p.player_id = (select auth.uid()) or private.is_group_staff(p.group_id))
  ));
create policy "dev_plan_checkins_write_staff" on public.dev_plan_checkins for all to authenticated
  using (exists (select 1 from public.dev_plans p where p.id = dev_plan_checkins.plan_id and private.is_group_staff(p.group_id)))
  with check (exists (select 1 from public.dev_plans p where p.id = dev_plan_checkins.plan_id and private.is_group_staff(p.group_id)));

-- Progress: staff reads (to see "l'effet mesuré"), only the player writes their own.
create policy "dev_plan_progress_read" on public.dev_plan_progress for select to authenticated
  using (exists (
    select 1 from public.dev_plan_axes a join public.dev_plans p on p.id = a.plan_id
    where a.id = dev_plan_progress.axis_id and (p.player_id = (select auth.uid()) or private.is_group_staff(p.group_id))
  ));
create policy "dev_plan_progress_write_own" on public.dev_plan_progress for all to authenticated
  using (exists (
    select 1 from public.dev_plan_axes a join public.dev_plans p on p.id = a.plan_id
    where a.id = dev_plan_progress.axis_id and p.player_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.dev_plan_axes a join public.dev_plans p on p.id = a.plan_id
    where a.id = dev_plan_progress.axis_id and p.player_id = (select auth.uid())
  ));

create trigger dev_plans_touch before update on public.dev_plans
  for each row execute function public.touch_updated_at();
create trigger dev_plan_axes_touch before update on public.dev_plan_axes
  for each row execute function public.touch_updated_at();
create trigger dev_plan_progress_touch before update on public.dev_plan_progress
  for each row execute function public.touch_updated_at();
