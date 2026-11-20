-- "Relancer" (DESIGN_STATE.md § 18.1, the manager's Organisation dashboard, validated 20/11/2026): remind the members who
-- have not answered a Planning event yet. Each gets an in-app notification (type event_response_reminder) and, when they
-- linked Discord (/link-me), a direct message from the bot (DIRECT_MESSAGE_TYPES, src/lib/discordBotCore.ts).
--
--   - who: the group's calendar managers (private.can_edit_calendar: owner, coach, manager, captain).
--   - whom: the people the event concerns (its scope or its invitees) who have no answer yet, the caller excluded,
--     optionally narrowed to p_user_ids. Only for an event still to come.
--   - at most 50 people per call, the never reminded first (then the longest ago), so a large group is reached over
--     a few calls.
--   - anti-spam: one reminder per event and person every 6 hours (event_response_reminders keeps the last one). A person
--     reminded too recently is returned in "skipped" with the time they can be reminded again.
--   - returns { "reminded": [user ids], "skipped": [{ "userId", "nextAt" }] }.
-- Errors: FORBIDDEN, NOT_FOUND, EVENT_PAST.
-- Re-runnable: if not exists, create or replace, drop ... if exists. No semicolon inside a comment.

-- 1. The notification type --------------------------------------------------------------------------------
-- The full list (20261119223819_analyst_draft_log_dossiers) plus event_response_reminder.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'review_comment', 'objective_assigned', 'scrim_created', 'scrim_updated', 'scrim_reminder_24h', 'scrim_reminder_1h',
  'player_inactive', 'task_assigned', 'objective_overdue', 'wellbeing_alert', 'mention',
  'review_pending', 'scrim_low_availability', 'scrim_availability_missing', 'dev_plan_period_ending',
  'weekly_load_alert', 'calendar_event_request',
  'event_declined', 'event_confirmed',
  'staff_roles_changed', 'member_staff_roles_changed',
  'dossier_published',
  'event_response_reminder'
]));

-- 2. The last reminder per event and person ------------------------------------------------------------------

create table if not exists public.event_response_reminders (
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
-- Written by the RPC only (security definer). The calendar managers read it to show "relancé il y a 2 h".
alter table public.event_response_reminders enable row level security;
drop policy if exists event_response_reminders_read on public.event_response_reminders;
create policy event_response_reminders_read on public.event_response_reminders for select to authenticated
  using (exists (select 1 from public.calendar_events e where e.id = event_id and private.can_edit_calendar(e.group_id)));
revoke all on public.event_response_reminders from anon, authenticated;
grant select on public.event_response_reminders to authenticated;

-- 3. The reminder ----------------------------------------------------------------------------------------------

create or replace function public.remind_event_responses(p_event uuid, p_user_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.calendar_events;
  v_cooldown interval := interval '6 hours';
  v_reminded uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  r record;
begin
  select * into v_event from public.calendar_events where id = p_event;
  if v_event.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null or not private.can_edit_calendar(v_event.group_id, v_uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'EVENT_PAST' using errcode = '22023';
  end if;

  for r in
    select m.user_id, rem.sent_at
    from public.group_members m
    left join public.event_response_reminders rem on rem.event_id = p_event and rem.user_id = m.user_id
    where m.group_id = v_event.group_id
      and m.user_id <> v_uid
      and (p_user_ids is null or m.user_id = any (p_user_ids))
      and case v_event.attendee_scope
            when 'whole_team' then true
            when 'all_players' then m.role = 'player' or m.also_plays
            when 'all_staff' then m.role in ('owner', 'coach', 'analyst', 'manager') or cardinality(m.staff_roles) > 0
            else exists (select 1 from public.calendar_event_attendees a where a.event_id = p_event and a.user_id = m.user_id)
          end
      and not exists (select 1 from public.calendar_event_responses resp where resp.event_id = p_event and resp.user_id = m.user_id)
    -- Never reminded first, then the longest ago (CyberSecurity, beta.14): past the first 50, the others are reached on the
    -- next calls instead of the same 50 coming back every time.
    order by rem.sent_at nulls first, m.user_id
    limit 50
  loop
    if r.sent_at is not null and r.sent_at > now() - v_cooldown then
      v_skipped := v_skipped || jsonb_build_object('userId', r.user_id, 'nextAt', r.sent_at + v_cooldown);
      continue;
    end if;
    perform private.notify(r.user_id, 'event_response_reminder',
      jsonb_build_object('groupId', v_event.group_id, 'eventId', v_event.id, 'eventTitle', v_event.title,
                         'scheduledAt', v_event.starts_at, 'eventKind', v_event.kind),
      '/planning');
    insert into public.event_response_reminders (event_id, user_id, sent_by, sent_at)
    values (p_event, r.user_id, v_uid, now())
    on conflict (event_id, user_id) do update set sent_by = excluded.sent_by, sent_at = excluded.sent_at;
    v_reminded := v_reminded || r.user_id;
  end loop;

  return jsonb_build_object('reminded', to_jsonb(v_reminded), 'skipped', v_skipped);
end;
$$;
revoke all on function public.remind_event_responses(uuid, uuid[]) from public, anon;
grant execute on function public.remind_event_responses(uuid, uuid[]) to authenticated;
