-- W1: cloud backups of the desktop app's local database.
-- One private storage folder per user: backups/<auth uid>/<file>.nexusmind

create table if not exists public.cloud_backups (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  storage_path   text not null unique,
  size_bytes     bigint not null check (size_bytes >= 0),
  format_version int  not null,
  app_version    text,
  device         text,
  counts         jsonb not null default '{}'::jsonb,
  constraint cloud_backups_path_in_own_folder check (storage_path like user_id::text || '/%')
);

create index if not exists cloud_backups_user_created_idx on public.cloud_backups (user_id, created_at desc);

alter table public.cloud_backups enable row level security;

create policy "cloud_backups_select_own" on public.cloud_backups
  for select to authenticated using (user_id = (select auth.uid()));
create policy "cloud_backups_insert_own" on public.cloud_backups
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "cloud_backups_delete_own" on public.cloud_backups
  for delete to authenticated using (user_id = (select auth.uid()));

-- Private bucket, gzip payloads only, 50 MB cap (free-plan per-file limit).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 52428800, array['application/gzip'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "backups_read_own_folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "backups_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "backups_delete_own_folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
