-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 15/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

-- Phase 1 (Planning rework): new event kinds (scrim/flex/meeting), a scrim
-- link, an attendee scope + snapshot, an "event request" queue for
-- non-editors, and the RLS switch from is_group_staff to can_edit_calendar
-- (Phase 0) for calendar_events/availability_rules/availability_exceptions.

alter table public.calendar_events drop constraint calendar_events_kind_check;
alter table public.calendar_events add constraint calendar_events_kind_check
  check (kind = any (array['tournament', 'team_review', 'one_on_one', 'soloq_block', 'rest', 'other', 'scrim', 'flex', 'meeting']));

alter table public.calendar_events add column linked_scrim_id uuid references public.scrims(id) on delete set null;
alter table public.calendar_events add column attendee_scope text not null default 'custom'
  check (attendee_scope in ('whole_team', 'all_players', 'all_staff', 'custom'));

-- Snapshot, not a live group reference: who was invited stays stable even
-- if someone later leaves the group (matters for .ics history/export).
create table public.calendar_event_attendees (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (event_id, user_id)
);
alter table public.calendar_event_attendees enable row level security;

create policy calendar_event_attendees_read on public.calendar_event_attendees
  for select
  using (exists (select 1 from public.calendar_events e where e.id = event_id and private.group_role(e.group_id) is not null));

create policy calendar_event_attendees_write on public.calendar_event_attendees
  for all
  using (exists (select 1 from public.calendar_events e where e.id = event_id and private.can_edit_calendar(e.group_id)))
  with check (exists (select 1 from public.calendar_events e where e.id = event_id and private.can_edit_calendar(e.group_id)));

-- "Request an event" — purely informational, never writes a real
-- calendar_events row; any member can submit one, only calendar editors
-- can see/action the queue.
create table public.calendar_event_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  requested_by uuid not null default auth.uid() references auth.users(id),
  event_name text not null check (char_length(trim(event_name)) between 1 and 120),
  people_concerned jsonb not null default '[]'::jsonb,
  preferred_start timestamptz,
  preferred_end timestamptz,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);
alter table public.calendar_event_requests enable row level security;

create policy calendar_event_requests_insert on public.calendar_event_requests
  for insert
  with check (requested_by = auth.uid() and private.group_role(group_id) is not null);

create policy calendar_event_requests_read on public.calendar_event_requests
  for select
  using (requested_by = auth.uid() or private.can_edit_calendar(group_id));

create policy calendar_event_requests_update on public.calendar_event_requests
  for update
  using (private.can_edit_calendar(group_id))
  with check (private.can_edit_calendar(group_id));

create policy calendar_event_requests_delete on public.calendar_event_requests
  for delete
  using (requested_by = auth.uid() or private.can_edit_calendar(group_id));

create or replace function public.notify_calendar_event_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare staffer record;
declare requester_name text;
begin
  select display_name into requester_name from public.group_members where group_id = new.group_id and user_id = new.requested_by;
  for staffer in select user_id from public.group_members where group_id = new.group_id and role in ('owner', 'coach', 'manager') loop
    perform private.notify(staffer.user_id, 'calendar_event_request',
      jsonb_build_object('groupId', new.group_id, 'requestId', new.id, 'eventName', new.event_name, 'requestedByName', coalesce(requester_name, '?')),
      '/coaching');
  end loop;
  return new;
end;
$$;

create trigger calendar_event_request_notify
  after insert on public.calendar_event_requests
  for each row execute function public.notify_calendar_event_request();

-- Phase 0's can_edit_calendar replaces is_group_staff for calendar writes —
-- analyst loses write, manager gains it. Staff-bulk-entry-for-others on
-- availability keeps the same "own row OR editor" shape, just the editor
-- check is narrower now.
drop policy calendar_events_write_staff on public.calendar_events;
create policy calendar_events_write on public.calendar_events
  for all
  using (private.can_edit_calendar(group_id))
  with check (private.can_edit_calendar(group_id));

drop policy availability_rules_write on public.availability_rules;
create policy availability_rules_write on public.availability_rules
  for all
  using (user_id = auth.uid() or private.can_edit_calendar(group_id))
  with check (user_id = auth.uid() or private.can_edit_calendar(group_id));

drop policy availability_exceptions_write on public.availability_exceptions;
create policy availability_exceptions_write on public.availability_exceptions
  for all
  using (user_id = auth.uid() or private.can_edit_calendar(group_id))
  with check (user_id = auth.uid() or private.can_edit_calendar(group_id));
