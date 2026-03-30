-- NexusMind Supabase Schema
-- Run this in the Supabase SQL Editor after creating your project.

-- ============================================================
-- PROFILES (one per Supabase Auth user)
-- ============================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  local_puuid   text not null,
  display_name  text not null default '',
  role          text not null default 'student' check (role in ('student', 'coach', 'both')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users can read/write their own profile
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- ============================================================
-- COACH STUDENTS (relationships)
-- ============================================================
create table if not exists public.coach_students (
  id           uuid primary key default gen_random_uuid(),
  coach_id     uuid not null references public.profiles(id) on delete cascade,
  student_id   uuid not null references public.profiles(id) on delete cascade,
  invite_code  text unique not null,
  status       text not null default 'pending' check (status in ('pending', 'active')),
  created_at   timestamptz not null default now(),
  unique (coach_id, student_id)
);

alter table public.coach_students enable row level security;

-- Coach sees their own relationships
create policy "coach_students_coach" on public.coach_students
  for all using (coach_id = auth.uid());

-- Student sees relationships where they are the student
create policy "coach_students_student" on public.coach_students
  for select using (student_id = auth.uid());

-- Anyone can read a pending invite by code (for redemption)
create policy "coach_students_invite_read" on public.coach_students
  for select using (status = 'pending');

-- Student can update rows where they are the student (e.g. cancel invite)
create policy "coach_students_student_update" on public.coach_students
  for update using (student_id = auth.uid());

-- Any authenticated user can claim a pending invite (become the coach)
-- The app code validates the invite code and prevents self-redemption
create policy "coach_students_invite_claim" on public.coach_students
  for update using (status = 'pending' and coach_id = student_id);

-- Coaches can read their students' profiles (requires coach_students to exist)
create policy "profiles_select_coach" on public.profiles
  for select using (
    exists (
      select 1 from public.coach_students
      where coach_id = auth.uid() and student_id = profiles.id and status = 'active'
    )
  );

-- ============================================================
-- SYNCED SESSIONS
-- ============================================================
create table if not exists public.synced_sessions (
  id              text primary key,
  student_id      uuid not null references public.profiles(id) on delete cascade,
  date            timestamptz not null,
  objective_id    text not null,
  objective_ids   text not null default '[]',
  selected_kpi_ids text not null default '[]',
  sub_objective   text,
  custom_note     text,
  status          text not null default 'active',
  ai_summary      text,
  synced_at       timestamptz not null default now()
);

alter table public.synced_sessions enable row level security;

create policy "synced_sessions_student_write" on public.synced_sessions
  for all using (student_id = auth.uid());

create policy "synced_sessions_coach_read" on public.synced_sessions
  for select using (
    exists (
      select 1 from public.coach_students
      where coach_id = auth.uid() and student_id = synced_sessions.student_id and status = 'active'
    )
  );

-- ============================================================
-- SYNCED GAMES
-- ============================================================
create table if not exists public.synced_games (
  id                text primary key,
  session_id        text not null references public.synced_sessions(id) on delete cascade,
  student_id        uuid not null references public.profiles(id) on delete cascade,
  match_id          text not null,
  champion          text not null,
  opponent_champion text,
  review_status     text not null default 'pending',
  role              text not null,
  kills             int not null,
  deaths            int not null,
  assists           int not null,
  cs                int not null,
  vision_score      int not null,
  duration          int not null,
  win               boolean not null,
  rank              text,
  lp                int,
  game_end_at       timestamptz not null,
  youtube_url       text,
  synced_at         timestamptz not null default now()
);

alter table public.synced_games enable row level security;

create policy "synced_games_student_write" on public.synced_games
  for all using (student_id = auth.uid());

create policy "synced_games_coach_read" on public.synced_games
  for select using (
    exists (
      select 1 from public.coach_students
      where coach_id = auth.uid() and student_id = synced_games.student_id and status = 'active'
    )
  );

-- ============================================================
-- SYNCED REVIEWS
-- ============================================================
create table if not exists public.synced_reviews (
  id                  text primary key,
  game_id             text not null references public.synced_games(id) on delete cascade,
  student_id          uuid not null references public.profiles(id) on delete cascade,
  timeline_notes      text not null,
  kpi_scores          text not null,
  free_text           text,
  ai_summary          text,
  objective_respected boolean not null,
  created_at          timestamptz not null,
  synced_at           timestamptz not null default now()
);

alter table public.synced_reviews enable row level security;

create policy "synced_reviews_student_write" on public.synced_reviews
  for all using (student_id = auth.uid());

create policy "synced_reviews_coach_read" on public.synced_reviews
  for select using (
    exists (
      select 1 from public.coach_students
      where coach_id = auth.uid() and student_id = synced_reviews.student_id and status = 'active'
    )
  );

-- ============================================================
-- SYNCED ASSESSMENTS
-- ============================================================
create table if not exists public.synced_assessments (
  id         text primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null,
  synced_at  timestamptz not null default now()
);

alter table public.synced_assessments enable row level security;

create policy "synced_assessments_student_write" on public.synced_assessments
  for all using (student_id = auth.uid());

create policy "synced_assessments_coach_read" on public.synced_assessments
  for select using (
    exists (
      select 1 from public.coach_students
      where coach_id = auth.uid() and student_id = synced_assessments.student_id and status = 'active'
    )
  );

create table if not exists public.synced_assessment_scores (
  id             text primary key,
  assessment_id  text not null references public.synced_assessments(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  fundamental_id text not null,
  subcategory_id text,
  score          int not null
);

alter table public.synced_assessment_scores enable row level security;

create policy "synced_assessment_scores_student_write" on public.synced_assessment_scores
  for all using (student_id = auth.uid());

create policy "synced_assessment_scores_coach_read" on public.synced_assessment_scores
  for select using (
    exists (
      select 1 from public.coach_students
      where coach_id = auth.uid() and student_id = synced_assessment_scores.student_id and status = 'active'
    )
  );

-- ============================================================
-- COACH COMMENTS
-- ============================================================
create table if not exists public.coach_comments (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references public.profiles(id) on delete cascade,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('session', 'game', 'review')),
  target_id   text not null,
  content     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.coach_comments enable row level security;

-- Coach can manage their own comments
create policy "coach_comments_coach" on public.coach_comments
  for all using (coach_id = auth.uid());

-- Student can read comments on their data
create policy "coach_comments_student_read" on public.coach_comments
  for select using (student_id = auth.uid());

-- ============================================================
-- HELPER: updated_at trigger
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

create trigger coach_comments_updated_at
  before update on public.coach_comments
  for each row execute procedure public.handle_updated_at();
