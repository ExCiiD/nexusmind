-- Bug reports and feature requests sent from the desktop app and the web app.
-- Users insert and read their own; the developer reads everything with the
-- service role (Supabase dashboard / MCP). `status` and `dev_note` are only
-- changed by the developer and shown back to the user.

create table public.feedback_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('bug', 'feature')),
  title        text not null check (length(trim(title)) between 3 and 140),
  description  text not null check (length(trim(description)) between 10 and 8000),
  -- bug only: what was expected vs. what happened (optional)
  expected     text check (expected is null or length(expected) <= 4000),
  source       text not null check (source in ('desktop', 'web')),
  app_version  text check (app_version is null or length(app_version) <= 40),
  platform     text check (platform is null or length(platform) <= 200),
  route        text check (route is null or length(route) <= 200),
  -- only when the user ticks "attach technical info"
  diagnostics  jsonb check (diagnostics is null or pg_column_size(diagnostics) < 65536),
  contact_ok   boolean not null default true,
  status       text not null default 'new' check (status in ('new', 'seen', 'planned', 'in_progress', 'done', 'wont_do', 'duplicate')),
  dev_note     text check (dev_note is null or length(dev_note) <= 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index feedback_reports_status_idx on public.feedback_reports (status, created_at desc);
create index feedback_reports_user_idx on public.feedback_reports (user_id, created_at desc);

alter table public.feedback_reports enable row level security;

create policy "feedback_read_own" on public.feedback_reports for select to authenticated
  using (user_id = (select auth.uid()));
-- Users can only create rows as themselves, always starting as 'new' with no dev note.
create policy "feedback_insert_own" on public.feedback_reports for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'new' and dev_note is null);
-- No update/delete policy for users: the developer triages with the service role.

-- Abuse guard: at most 20 reports per user per 24 h.
create or replace function private.feedback_rate_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.feedback_reports
      where user_id = new.user_id and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'feedback rate limit' using errcode = '54000';
  end if;
  return new;
end;
$$;
create trigger feedback_reports_rate_limit before insert on public.feedback_reports
  for each row execute function private.feedback_rate_limit();
create trigger feedback_reports_touch before update on public.feedback_reports
  for each row execute function public.touch_updated_at();
