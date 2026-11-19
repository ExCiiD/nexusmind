-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 15/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

create table public.team_discussion_comments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  subject_type text not null check (subject_type in ('scrim', 'draft')),
  subject_id uuid not null,
  author_id uuid not null default auth.uid() references auth.users(id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index team_discussion_comments_subject_idx on public.team_discussion_comments(subject_type, subject_id, created_at);

alter table public.team_discussion_comments enable row level security;

-- Same access model as vod_review_comments (E5): any group member reads
-- and comments, author or staff can delete. group_id is denormalized here
-- (scrims.group_id / team_drafts.group_id are both already direct columns,
-- unlike vod_review_comments which has to resolve through session_id) so
-- RLS reads it straight off the row, no helper function needed.
create policy team_discussion_read on public.team_discussion_comments
  for select
  using (private.group_role(group_id) is not null);

create policy team_discussion_insert on public.team_discussion_comments
  for insert
  with check (author_id = auth.uid() and private.group_role(group_id) is not null);

create policy team_discussion_delete on public.team_discussion_comments
  for delete
  using (author_id = auth.uid() or private.is_group_staff(group_id));
