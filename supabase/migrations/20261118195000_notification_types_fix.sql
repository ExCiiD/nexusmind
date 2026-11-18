-- Hotfix (18 November 2026): the notification type check only knew the first
-- 11 types (w5_notifications). Every later trigger or scheduled check that
-- notifies with a newer type failed inside its transaction:
--   - a player's event request (calendar_event_request): the request itself
--     was rolled back, and the app showed a connection error;
--   - the review_pending, scrim_low_availability, scrim_availability_missing,
--     dev_plan_period_ending and weekly_load_alert checks.
-- Also allows the two types of 20261118200000_captain_roles_presence
-- (event_declined, event_confirmed), so that migration needn't touch it again.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'review_comment', 'objective_assigned', 'scrim_created', 'scrim_updated', 'scrim_reminder_24h', 'scrim_reminder_1h',
  'player_inactive', 'task_assigned', 'objective_overdue', 'wellbeing_alert', 'mention',
  'review_pending', 'scrim_low_availability', 'scrim_availability_missing', 'dev_plan_period_ending',
  'weekly_load_alert', 'calendar_event_request',
  'event_declined', 'event_confirmed'
]));
