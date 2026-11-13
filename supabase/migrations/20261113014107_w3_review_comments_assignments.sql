-- Coach ↔ player conversation on a review (optionally at a video timestamp),
-- and objectives a coach assigns to a player for upcoming sessions.
-- Policies are re-created on the private helpers by
-- 20261113014149_w3_move_rls_helpers_private.

create table public.review_comments (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups (id) on delete cascade,
  player_id      uuid not null references auth.users (id) on delete cascade,
  review_id      text not null check (length(review_id) between 1 and 128),  -- the player's local Review id (= sync record id)
  game_id        text check (game_id is null or length(game_id) <= 128),
  author_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id      uuid references public.review_comments (id) on delete cascade,
  video_time_sec int check (video_time_sec is null or video_time_sec between 0 and 36000),
  body           text not null check (length(trim(body)) between 1 and 4000),
  resolved       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index review_comments_player_review_idx on public.review_comments (player_id, review_id);
create index review_comments_group_idx on public.review_comments (group_id, created_at desc);

alter table public.review_comments enable row level security;

create policy "comments_read" on public.review_comments for select to authenticated
  using (player_id = (select auth.uid()) or public.is_group_staff(group_id));
create policy "comments_insert" on public.review_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.group_role(group_id, player_id) is not null
    and (
      player_id = (select auth.uid())
      or (public.is_group_staff(group_id) and public.can_read_player_table(player_id, 'Review'))
    )
  );
create policy "comments_update" on public.review_comments for update to authenticated
  using (author_id = (select auth.uid()) or player_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) or player_id = (select auth.uid()));
create policy "comments_delete" on public.review_comments for delete to authenticated
  using (author_id = (select auth.uid()) or public.group_role(group_id) = 'owner');

create table public.assigned_objectives (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  player_id     uuid not null references auth.users (id) on delete cascade,
  assigned_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  objective_ids text[] not null check (cardinality(objective_ids) between 1 and 3),
  kpi_ids       text[] not null default '{}',
  note          text check (note is null or length(note) <= 1000),
  due_date      date,
  status        text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index assigned_objectives_player_idx on public.assigned_objectives (player_id, status, created_at desc);

alter table public.assigned_objectives enable row level security;

create policy "assignments_read" on public.assigned_objectives for select to authenticated
  using (player_id = (select auth.uid()) or public.is_group_staff(group_id));
create policy "assignments_insert_staff" on public.assigned_objectives for insert to authenticated
  with check (
    assigned_by = (select auth.uid())
    and public.is_group_staff(group_id)
    and public.group_role(group_id, player_id) is not null
  );
create policy "assignments_update" on public.assigned_objectives for update to authenticated
  using (player_id = (select auth.uid()) or public.is_group_staff(group_id))
  with check (player_id = (select auth.uid()) or public.is_group_staff(group_id));
create policy "assignments_delete_staff" on public.assigned_objectives for delete to authenticated
  using (public.is_group_staff(group_id));

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger review_comments_touch before update on public.review_comments
  for each row execute function public.touch_updated_at();
create trigger assigned_objectives_touch before update on public.assigned_objectives
  for each row execute function public.touch_updated_at();
create trigger group_sharing_touch before update on public.group_sharing
  for each row execute function public.touch_updated_at();
