-- E7 follow-up: @mentions in announcements (docs/PLAN_GESTION_EQUIPE.md),
-- now buildable since E8's notification gate exists.
--
-- v1 scope: case-insensitive "@DisplayName" substring match against the
-- group's own members, announcements only (not every text field — VOD
-- comments / task text are a follow-up if this is useful). Goes through
-- the same private.notify gate as everything else, so mutes/quiet hours
-- apply to mentions too.

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'review_comment', 'objective_assigned',
  'scrim_created', 'scrim_updated',
  'scrim_reminder_24h', 'scrim_reminder_1h',
  'player_inactive', 'task_assigned', 'objective_overdue', 'wellbeing_alert', 'mention'
));

create or replace function public.notify_announcement_mentions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare gm record;
declare author_name text;
begin
  select display_name into author_name from public.group_members where group_id = new.group_id and user_id = new.created_by;
  for gm in
    select user_id, display_name from public.group_members
    where group_id = new.group_id and user_id <> new.created_by
      and display_name is not null and length(trim(display_name)) > 0
      and position('@' || lower(display_name) in lower(new.body)) > 0
  loop
    perform private.notify(gm.user_id, 'mention',
      jsonb_build_object('groupId', new.group_id, 'announcementId', new.id, 'title', new.title,
                          'mentionedByName', coalesce(author_name, '?')),
      '/coaching');
  end loop;
  return new;
end;
$$;
create trigger announcements_notify_mentions after insert on public.announcements
  for each row execute function public.notify_announcement_mentions();
revoke all on function public.notify_announcement_mentions() from public, authenticated, anon;
