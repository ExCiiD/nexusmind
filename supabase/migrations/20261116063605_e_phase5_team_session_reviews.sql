-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 16/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

create table public.team_session_reviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.team_sessions(id) on delete cascade,
  game_id uuid references public.team_session_games(id) on delete cascade,
  scope text not null check (scope in ('per_game', 'session', 'meeting')),
  recorded_by uuid references auth.users(id),
  recording_local_path text,
  youtube_url text,
  youtube_visibility text not null default 'unlisted' check (youtube_visibility in ('public', 'unlisted', 'private')),
  transcript text,
  summary text,
  status text not null default 'pending' check (status in ('pending', 'recording', 'processing', 'done', 'deferred')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One per_game review per game; one session-level review per session
-- (game_id null); meetings share this table via scope='meeting' (also
-- game_id null) rather than a parallel table — a meeting is still "a kind
-- of team session" per the original request's own framing.
create unique index team_session_reviews_game_unique on public.team_session_reviews(game_id) where game_id is not null;
create unique index team_session_reviews_session_scope_unique on public.team_session_reviews(session_id, scope) where game_id is null;

alter table public.team_session_reviews enable row level security;

create policy team_session_reviews_read on public.team_session_reviews
  for select using (private.group_role(private.team_session_group(session_id)) is not null);

-- Recording/transcribing/publishing a review is a responsible's action
-- (coach/manager/captain) — same gate as starting/ending the session itself.
create policy team_session_reviews_write on public.team_session_reviews
  for all using (private.can_manage_session(private.team_session_group(session_id)))
  with check (private.can_manage_session(private.team_session_group(session_id)));

create table public.team_session_feedback (
  session_id uuid not null references public.team_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  body text not null,
  transcript text,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

alter table public.team_session_feedback enable row level security;

-- Any concerned member can read all feedback for a session they belong to
-- (responsibles reviewing it) and write only their own row.
create policy team_session_feedback_read on public.team_session_feedback
  for select using (private.group_role(private.team_session_group(session_id)) is not null);

create policy team_session_feedback_write on public.team_session_feedback
  for insert with check (user_id = auth.uid() and private.group_role(private.team_session_group(session_id)) is not null);

create policy team_session_feedback_update on public.team_session_feedback
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
