-- Meeting attendance (19 November 2026): a meeting-kind team session asks
-- the reason (the event title), the people concerned (the event attendees)
-- and who was actually there. That last part is new data: RSVPs
-- (calendar_event_responses) are answers before the event, set by each
-- player for themselves; attendance is what the responsible notes during
-- the meeting, for everyone. Same access rules as the other team-session
-- tables: the group reads, whoever can manage the session writes.

create table public.team_session_attendance (
  session_id uuid not null references public.team_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  present    boolean not null,
  marked_by  uuid references auth.users(id) on delete set null default auth.uid(),
  marked_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);

alter table public.team_session_attendance enable row level security;

create policy "team_session_attendance_read" on public.team_session_attendance
  for select to authenticated
  using (private.group_role(private.team_session_group(session_id)) is not null);

create policy "team_session_attendance_write" on public.team_session_attendance
  for all to authenticated
  using (private.can_manage_session(private.team_session_group(session_id)))
  with check (private.can_manage_session(private.team_session_group(session_id)));

grant select, insert, update, delete on public.team_session_attendance to authenticated;
