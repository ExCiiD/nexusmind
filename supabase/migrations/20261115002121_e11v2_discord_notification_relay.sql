-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 15/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

alter table public.discord_notifications_sent drop constraint discord_notifications_sent_item_type_check;
alter table public.discord_notifications_sent add constraint discord_notifications_sent_item_type_check
  check (item_type = any (array['event', 'scrim', 'common_availability', 'notification']));
