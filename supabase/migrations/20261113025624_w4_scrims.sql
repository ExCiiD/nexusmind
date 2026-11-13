-- W4: scrim planning for a group (prep + availability + post-scrim analysis).
-- Readable by every member; staff (owner/coach/analyst) manage scrims;
-- each member sets their own availability.

create table public.scrims (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  title         text not null check (length(trim(title)) between 1 and 120),
  opponent      text check (opponent is null or length(opponent) <= 120),
  scheduled_at  timestamptz not null,
  duration_min  int not null default 120 check (duration_min between 15 and 600),
  status        text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  prep_notes    text check (prep_notes is null or length(prep_notes) <= 8000),
  -- [{ "label": "...", "done": false }]
  checklist     jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 50),
  -- DraftPrep record ids (synced by the staff member who prepared them)
  draft_ids     text[] not null default '{}' check (cardinality(draft_ids) <= 10),
  review_notes  text check (review_notes is null or length(review_notes) <= 8000),
  created_by    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index scrims_group_time_idx on public.scrims (group_id, scheduled_at);

create table public.scrim_availability (
  scrim_id   uuid not null references public.scrims (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  status     text not null check (status in ('yes', 'maybe', 'no')),
  comment    text check (comment is null or length(comment) <= 300),
  updated_at timestamptz not null default now(),
  primary key (scrim_id, user_id)
);

-- Group of a scrim, for availability policies (no RLS recursion).
create or replace function private.scrim_group(p_scrim uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select group_id from public.scrims where id = p_scrim $$;
revoke all on function private.scrim_group(uuid) from public;
grant execute on function private.scrim_group(uuid) to authenticated;

alter table public.scrims enable row level security;
alter table public.scrim_availability enable row level security;

create policy "scrims_read_members" on public.scrims for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "scrims_insert_staff" on public.scrims for insert to authenticated
  with check (created_by = (select auth.uid()) and private.is_group_staff(group_id));
create policy "scrims_update_staff" on public.scrims for update to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));
create policy "scrims_delete_staff" on public.scrims for delete to authenticated
  using (private.is_group_staff(group_id));

create policy "availability_read_members" on public.scrim_availability for select to authenticated
  using (private.group_role(private.scrim_group(scrim_id)) is not null);
create policy "availability_write_own" on public.scrim_availability for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.group_role(private.scrim_group(scrim_id)) is not null);

create trigger scrims_touch before update on public.scrims
  for each row execute function public.touch_updated_at();
create trigger scrim_availability_touch before update on public.scrim_availability
  for each row execute function public.touch_updated_at();
