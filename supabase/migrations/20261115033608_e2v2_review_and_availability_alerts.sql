-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 15/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

-- C3: a coach comment left unresolved for 3+ days gets one reminder to the player.
alter table public.review_comments add column reminder_sent boolean not null default false;

create or replace function public.run_review_pending_check()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in
    select * from public.review_comments
    where resolved = false and reminder_sent = false
      and created_at < now() - interval '3 days'
      and player_id is not null
      and author_id is distinct from player_id
  loop
    perform private.notify(r.player_id, 'review_pending',
      jsonb_build_object('groupId', r.group_id, 'reviewId', r.review_id, 'commentId', r.id),
      '/session');
    update public.review_comments set reminder_sent = true where id = r.id;
  end loop;
end;
$$;

select cron.schedule('review-pending-check', '0 7 * * *', $$select public.run_review_pending_check()$$);

-- C4: scrim within 48h with too few confirmed starters alerts staff (once);
-- a starter who never answered gets a personal reminder (once per scrim).
alter table public.scrims add column low_availability_notified boolean not null default false;

create table public.scrim_availability_reminders (
  scrim_id uuid not null references public.scrims(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (scrim_id, user_id)
);
alter table public.scrim_availability_reminders enable row level security;

create or replace function public.run_scrim_availability_check()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s record;
declare starter record;
declare yes_count int;
declare starter_count int;
declare staffer record;
begin
  for s in
    select * from public.scrims
    where status = 'planned' and scheduled_at between now() and now() + interval '48 hours'
  loop
    select count(*) into starter_count from public.team_rosters
      where group_id = s.group_id and status = 'starter' and scouting_id is null and user_id is not null;
    if starter_count = 0 then continue; end if;

    select count(*) into yes_count from public.scrim_availability sa
      join public.team_rosters tr on tr.user_id = sa.user_id
      where tr.group_id = s.group_id and tr.status = 'starter' and tr.scouting_id is null
        and sa.scrim_id = s.id and sa.status = 'yes';

    if yes_count < 5 and not s.low_availability_notified then
      for staffer in select user_id from public.group_members where group_id = s.group_id and role in ('owner', 'coach', 'analyst') loop
        perform private.notify(staffer.user_id, 'scrim_low_availability',
          jsonb_build_object('groupId', s.group_id, 'scrimId', s.id, 'title', s.title, 'yesCount', yes_count),
          '/coaching');
      end loop;
      update public.scrims set low_availability_notified = true where id = s.id;
    end if;

    for starter in
      select tr.user_id from public.team_rosters tr
      where tr.group_id = s.group_id and tr.status = 'starter' and tr.scouting_id is null and tr.user_id is not null
        and not exists (select 1 from public.scrim_availability sa where sa.scrim_id = s.id and sa.user_id = tr.user_id)
        and not exists (select 1 from public.scrim_availability_reminders rem where rem.scrim_id = s.id and rem.user_id = tr.user_id)
    loop
      perform private.notify(starter.user_id, 'scrim_availability_missing',
        jsonb_build_object('groupId', s.group_id, 'scrimId', s.id, 'title', s.title),
        '/coaching');
      insert into public.scrim_availability_reminders (scrim_id, user_id) values (s.id, starter.user_id);
    end loop;
  end loop;
end;
$$;

select cron.schedule('scrim-availability-check', '0 * * * *', $$select public.run_scrim_availability_check()$$);
