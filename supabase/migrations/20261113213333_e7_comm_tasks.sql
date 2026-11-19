-- E7: communication & tasks (docs/PLAN_GESTION_EQUIPE.md), v1 scope.
--
-- Pinned team announcements, assignable to-do tasks with a due date and
-- status, and staff-private notes per player (never visible to the player).
--
-- Deferred (documented in PLAN_GESTION_EQUIPE.md): per-scrim/per-draft
-- comment threads (the existing review-comment system already covers
-- per-game comments; a scrim/draft thread is a separate follow-up), and
-- @mentions (needs notification plumbing — depends on E8).

create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  title      text not null check (length(trim(title)) between 1 and 120),
  body       text not null check (length(trim(body)) between 1 and 4000),
  pinned     boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index announcements_group_idx on public.announcements (group_id, pinned desc, created_at desc);

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 200),
  assignee_id uuid references auth.users (id) on delete set null,
  due_date    date,
  status      text not null default 'open' check (status in ('open', 'done')),
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index tasks_group_idx on public.tasks (group_id, status, due_date);

create table public.staff_notes (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  player_id  uuid not null references auth.users (id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 4000),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_notes_group_player_idx on public.staff_notes (group_id, player_id, created_at desc);

alter table public.announcements enable row level security;
alter table public.tasks enable row level security;
alter table public.staff_notes enable row level security;

create policy "announcements_read" on public.announcements for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "announcements_write_staff" on public.announcements for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

create policy "tasks_read" on public.tasks for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "tasks_write_staff" on public.tasks for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));
-- The assignee may also update their own task (to flip its status), without needing staff rights.
create policy "tasks_update_own_assignment" on public.tasks for update to authenticated
  using (assignee_id = (select auth.uid())) with check (assignee_id = (select auth.uid()));

-- Staff-only, never the player: no read policy exists for the player's own user_id.
create policy "staff_notes_read_staff" on public.staff_notes for select to authenticated
  using (private.is_group_staff(group_id));
create policy "staff_notes_write_staff" on public.staff_notes for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

create trigger announcements_touch before update on public.announcements
  for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
create trigger staff_notes_touch before update on public.staff_notes
  for each row execute function public.touch_updated_at();
