-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 15/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

-- E9 v2: a persistent, revocable shareable link for an already-computed
-- report snapshot. The snapshot is taken at generation time, using the
-- generating staff member's own RLS-gated read (same data they could
-- already see and paste via "Copy as text") — no live recomputation, no
-- new exposure of consented-to-staff data beyond what staff already had.
create table public.report_shares (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  token text not null unique,
  group_name text not null,
  report jsonb not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index report_shares_group_id_idx on public.report_shares(group_id);

alter table public.report_shares enable row level security;

create policy report_shares_staff on public.report_shares
  for all
  using (private.is_group_staff(group_id))
  with check (private.is_group_staff(group_id));
