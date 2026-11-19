-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 15/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

create table public.calendar_subscriptions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  token text not null unique,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index calendar_subscriptions_group_id_idx on public.calendar_subscriptions(group_id);

alter table public.calendar_subscriptions enable row level security;

-- Staff of the group manage their own group's live-subscription token(s).
-- The Edge Function that actually serves the .ics feed uses the service
-- role (bypasses RLS) to look a token up — a calendar app polling the URL
-- carries no Ascend session, so RLS can't gate that read anyway.
create policy calendar_subscriptions_staff on public.calendar_subscriptions
  for all
  using (private.is_group_staff(group_id))
  with check (private.is_group_staff(group_id));
