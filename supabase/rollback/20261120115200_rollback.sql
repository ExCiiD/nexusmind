-- Rollback of 20261120115200_event_response_reminders ("Relancer"). Run it as one transaction.
-- Lost: the reminder notifications already sent (the type leaves the list) and the anti-spam record.

drop function if exists public.remind_event_responses(uuid, uuid[]);
drop table if exists public.event_response_reminders;

delete from public.notifications where type = 'event_response_reminder';
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'review_comment', 'objective_assigned', 'scrim_created', 'scrim_updated', 'scrim_reminder_24h', 'scrim_reminder_1h',
  'player_inactive', 'task_assigned', 'objective_overdue', 'wellbeing_alert', 'mention',
  'review_pending', 'scrim_low_availability', 'scrim_availability_missing', 'dev_plan_period_ending',
  'weekly_load_alert', 'calendar_event_request',
  'event_declined', 'event_confirmed',
  'staff_roles_changed', 'member_staff_roles_changed',
  'dossier_published'
]));
