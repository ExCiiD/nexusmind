-- Planning redesign (17/11/2026): new "Warmup / Draft" event kind.
-- Additive only: widens the allowed list, existing rows are untouched.
alter table public.calendar_events drop constraint calendar_events_kind_check;
alter table public.calendar_events add constraint calendar_events_kind_check
  check (kind = any (array['tournament', 'team_review', 'one_on_one', 'soloq_block', 'rest', 'other', 'scrim', 'flex', 'meeting', 'warmup_draft']));
