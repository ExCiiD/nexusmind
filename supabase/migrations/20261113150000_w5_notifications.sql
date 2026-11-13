-- W5: in-app notifications. A row per recipient; the client renders the
-- text from `type` + `data` (i18n), never a server-rendered string, so it
-- stays bilingual. Inserted only by SECURITY DEFINER triggers / cron
-- functions below — `authenticated` can read and mark its own as read,
-- never insert (that would let a user spoof notifications to anyone).

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  type       text not null check (type in (
               'review_comment', 'objective_assigned',
               'scrim_created', 'scrim_updated',
               'scrim_reminder_24h', 'scrim_reminder_1h',
               'player_inactive'
             )),
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 8192),
  link       text check (link is null or length(link) <= 200),
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, read, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications_read_own" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
-- Only the read flag may change, and only by the recipient.
create policy "notifications_mark_read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- No insert/delete policy for `authenticated`: rows are only ever created by
-- the SECURITY DEFINER functions below, which bypass RLS.

-- ── Review comments: notify the player when staff comments on their review ──
create or replace function public.notify_review_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare author_name text;
begin
  if new.author_id = new.player_id then
    return new; -- the player commenting on their own review (e.g. a reply) notifies no one yet
  end if;
  select display_name into author_name from public.group_members
    where group_id = new.group_id and user_id = new.author_id;
  insert into public.notifications (user_id, type, data, link)
  values (
    new.player_id, 'review_comment',
    jsonb_build_object('groupId', new.group_id, 'reviewId', new.review_id, 'commentId', new.id,
                        'authorName', coalesce(author_name, '?')),
    '/review?reviewId=' || new.review_id
  );
  return new;
end;
$$;
create trigger review_comments_notify after insert on public.review_comments
  for each row execute function public.notify_review_comment();

-- ── Objective assigned: notify the player ──
create or replace function public.notify_objective_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
declare assigner_name text;
begin
  if new.assigned_by = new.player_id then return new; end if;
  select display_name into assigner_name from public.group_members
    where group_id = new.group_id and user_id = new.assigned_by;
  insert into public.notifications (user_id, type, data, link)
  values (
    new.player_id, 'objective_assigned',
    jsonb_build_object('groupId', new.group_id, 'objectiveIds', new.objective_ids,
                        'assignedByName', coalesce(assigner_name, '?')),
    '/session'
  );
  return new;
end;
$$;
create trigger assigned_objectives_notify after insert on public.assigned_objectives
  for each row execute function public.notify_objective_assigned();

-- ── Scrims: notify every other member of the group ──
create or replace function public.notify_scrim_members(p_scrim public.scrims, p_type text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, type, data, link)
  select gm.user_id, p_type,
         jsonb_build_object('groupId', p_scrim.group_id, 'scrimId', p_scrim.id,
                             'title', p_scrim.title, 'scheduledAt', p_scrim.scheduled_at),
         '/scrims?scrimId=' || p_scrim.id
  from public.group_members gm
  where gm.group_id = p_scrim.group_id and gm.user_id <> p_actor;
end;
$$;
-- Not a trigger function: callable via RPC unless explicitly revoked, which
-- would let any authenticated user spoof notifications to any group.
revoke all on function public.notify_scrim_members(public.scrims, text, uuid) from public, authenticated, anon;

create or replace function public.notify_scrim_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_scrim_members(new, 'scrim_created', new.created_by);
  return new;
end;
$$;
create trigger scrims_notify_created after insert on public.scrims
  for each row execute function public.notify_scrim_created();

create or replace function public.notify_scrim_updated()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.scheduled_at <> old.scheduled_at or (new.status = 'cancelled' and old.status <> 'cancelled') then
    perform public.notify_scrim_members(new, 'scrim_updated', auth.uid());
  end if;
  return new;
end;
$$;
create trigger scrims_notify_updated after update on public.scrims
  for each row execute function public.notify_scrim_updated();

-- ── Scrim reminders (J-1 / H-1), run every 15 min by pg_cron ──
alter table public.scrims add column reminder_24h_sent boolean not null default false;
alter table public.scrims add column reminder_1h_sent boolean not null default false;

create or replace function public.run_scrim_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare s public.scrims;
begin
  for s in
    select * from public.scrims
    where status = 'planned' and not reminder_24h_sent
      and scheduled_at between now() + interval '23 hours 45 minutes' and now() + interval '24 hours 15 minutes'
  loop
    perform public.notify_scrim_members(s, 'scrim_reminder_24h', '00000000-0000-0000-0000-000000000000'::uuid);
    update public.scrims set reminder_24h_sent = true where id = s.id;
  end loop;

  for s in
    select * from public.scrims
    where status = 'planned' and not reminder_1h_sent
      and scheduled_at between now() + interval '45 minutes' and now() + interval '75 minutes'
  loop
    perform public.notify_scrim_members(s, 'scrim_reminder_1h', '00000000-0000-0000-0000-000000000000'::uuid);
    update public.scrims set reminder_1h_sent = true where id = s.id;
  end loop;
end;
$$;
revoke all on function public.run_scrim_reminders() from public, authenticated, anon;

-- ── Inactive player (C1): no synced game in 5 days, once-daily check ──
create or replace function public.run_inactive_player_check()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
declare last_game timestamptz;
declare days_inactive int;
begin
  for r in
    select distinct gm.group_id, gm.user_id as player_id, gm.display_name
    from public.group_members gm
    where gm.role = 'player'
  loop
    select max(sr.updated_at) into last_game
      from public.sync_records sr
      where sr.user_id = r.player_id and sr.table_name = 'Game' and not sr.deleted;
    if last_game is null then continue; end if; -- never synced a game: nothing to compare to, not our call
    days_inactive := extract(day from now() - last_game)::int;
    if days_inactive < 5 then continue; end if;
    if not coalesce((select s.share_reviews from public.group_sharing s
                      where s.group_id = r.group_id and s.user_id = r.player_id), true) then
      continue; -- respects the player's own sharing choice (W3)
    end if;
    if exists (
      select 1 from public.notifications n
      where n.type = 'player_inactive' and n.created_at > now() - interval '7 days'
        and n.data->>'groupId' = r.group_id::text and n.data->>'playerId' = r.player_id::text
    ) then continue; end if; -- already alerted this week
    insert into public.notifications (user_id, type, data, link)
    select gm.user_id, 'player_inactive',
           jsonb_build_object('groupId', r.group_id, 'playerId', r.player_id,
                               'playerName', coalesce(r.display_name, '?'), 'days', days_inactive),
           '/coaching'
    from public.group_members gm
    where gm.group_id = r.group_id and gm.role in ('owner', 'coach', 'analyst');
  end loop;
end;
$$;
revoke all on function public.run_inactive_player_check() from public, authenticated, anon;

-- Schedule both jobs. `cron.schedule` is idempotent by job name (replaces).
create extension if not exists pg_cron;
select cron.schedule('scrim-reminders', '*/15 * * * *', 'select public.run_scrim_reminders()');
select cron.schedule('inactive-player-check', '17 6 * * *', 'select public.run_inactive_player_check()');
