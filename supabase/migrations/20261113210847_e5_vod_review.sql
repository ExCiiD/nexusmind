-- E5: collaborative VOD review (docs/PLAN_GESTION_EQUIPE.md), v1 scope.
--
-- A review session is tied to a scrim (W4) and a shared VOD link (YouTube /
-- clip). Timestamped comments from any member, team-level mistake tags
-- (rotation/objective setup/communication/other), action items to remember,
-- and per-player "review this window" assignments with a done/not-done
-- status that shows in their app.
--
-- Deferred (documented in PLAN_GESTION_EQUIPE.md): auto-generated scrim
-- summary (customs import + per-player stats + auto-detected mistakes —
-- depends on T5, not built), richer team-mistake taxonomy.

create table public.vod_review_sessions (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  scrim_id   uuid references public.scrims (id) on delete set null,
  title      text not null check (length(trim(title)) between 1 and 120),
  vod_url    text not null check (length(vod_url) between 1 and 500),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vod_review_sessions_group_idx on public.vod_review_sessions (group_id, created_at desc);

create table public.vod_review_comments (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.vod_review_sessions (id) on delete cascade,
  author_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  video_time_sec int check (video_time_sec is null or video_time_sec >= 0),
  team_tag       text check (team_tag is null or team_tag in ('rotation', 'objective_setup', 'communication', 'other')),
  body           text not null check (length(trim(body)) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index vod_review_comments_session_idx on public.vod_review_comments (session_id, video_time_sec);

create table public.vod_review_action_items (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.vod_review_sessions (id) on delete cascade,
  text       text not null check (length(trim(text)) between 1 and 500),
  done       boolean not null default false,
  done_by    uuid references auth.users (id) on delete set null,
  done_at    timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index vod_review_action_items_session_idx on public.vod_review_action_items (session_id);

create table public.vod_review_assignments (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.vod_review_sessions (id) on delete cascade,
  player_id       uuid not null references auth.users (id) on delete cascade,
  range_start_sec int not null check (range_start_sec >= 0),
  range_end_sec   int not null check (range_end_sec > range_start_sec),
  status          text not null default 'pending' check (status in ('pending', 'done')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index vod_review_assignments_session_idx on public.vod_review_assignments (session_id);
create index vod_review_assignments_player_idx on public.vod_review_assignments (player_id);

-- Group of a session's child rows, for RLS without recursion (same pattern as private.scrim_group).
create or replace function private.vod_session_group(p_session uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select group_id from public.vod_review_sessions where id = p_session $$;
revoke all on function private.vod_session_group(uuid) from public;
grant execute on function private.vod_session_group(uuid) to authenticated;

alter table public.vod_review_sessions enable row level security;
alter table public.vod_review_comments enable row level security;
alter table public.vod_review_action_items enable row level security;
alter table public.vod_review_assignments enable row level security;

create policy "vod_sessions_read" on public.vod_review_sessions for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "vod_sessions_write_staff" on public.vod_review_sessions for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

create policy "vod_comments_read" on public.vod_review_comments for select to authenticated
  using (private.group_role(private.vod_session_group(session_id)) is not null);
create policy "vod_comments_insert" on public.vod_review_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and private.group_role(private.vod_session_group(session_id)) is not null);
create policy "vod_comments_delete" on public.vod_review_comments for delete to authenticated
  using (author_id = (select auth.uid()) or private.is_group_staff(private.vod_session_group(session_id)));

create policy "vod_action_items_read" on public.vod_review_action_items for select to authenticated
  using (private.group_role(private.vod_session_group(session_id)) is not null);
create policy "vod_action_items_insert" on public.vod_review_action_items for insert to authenticated
  with check (created_by = (select auth.uid()) and private.group_role(private.vod_session_group(session_id)) is not null);
create policy "vod_action_items_update" on public.vod_review_action_items for update to authenticated
  using (private.group_role(private.vod_session_group(session_id)) is not null)
  with check (private.group_role(private.vod_session_group(session_id)) is not null);
create policy "vod_action_items_delete" on public.vod_review_action_items for delete to authenticated
  using (created_by = (select auth.uid()) or private.is_group_staff(private.vod_session_group(session_id)));

create policy "vod_assignments_read" on public.vod_review_assignments for select to authenticated
  using (private.group_role(private.vod_session_group(session_id)) is not null);
create policy "vod_assignments_write_staff" on public.vod_review_assignments for all to authenticated
  using (private.is_group_staff(private.vod_session_group(session_id)))
  with check (private.is_group_staff(private.vod_session_group(session_id)));
create policy "vod_assignments_update_own_status" on public.vod_review_assignments for update to authenticated
  using (player_id = (select auth.uid()))
  with check (player_id = (select auth.uid()));

create trigger vod_review_sessions_touch before update on public.vod_review_sessions
  for each row execute function public.touch_updated_at();
create trigger vod_review_assignments_touch before update on public.vod_review_assignments
  for each row execute function public.touch_updated_at();
