-- Pre-W1 coaching/sync schema, replaced by sync_records (W2) and groups (W3).
-- Dependencies only exist between these tables (FKs + one cross-table policy).
drop table if exists public.coach_comments;
drop table if exists public.synced_assessment_scores;
drop table if exists public.synced_assessments;
drop table if exists public.synced_reviews;
drop table if exists public.synced_games;
drop table if exists public.synced_sessions;
drop policy if exists "profiles_select_coach" on public.profiles;
drop table if exists public.coach_students;
drop table if exists public.profiles;
drop function if exists public.handle_updated_at();
