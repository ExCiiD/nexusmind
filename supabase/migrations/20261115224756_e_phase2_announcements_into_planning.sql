-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 15/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

-- Phase 2 (Planning rework §9): announcements move into Planning's
-- permission model (can_edit_calendar instead of is_group_staff — Tasks and
-- StaffNotes are untouched, still is_group_staff) and gain a per-user
-- dismissal record so the in-app "persistent bubble until explicitly
-- closed" can survive restarts and never re-stack a duplicate.

drop policy announcements_write_staff on public.announcements;
create policy announcements_write on public.announcements
  for all
  using (private.can_edit_calendar(group_id))
  with check (private.can_edit_calendar(group_id));

create table public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
alter table public.announcement_dismissals enable row level security;

create policy announcement_dismissals_own on public.announcement_dismissals
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
