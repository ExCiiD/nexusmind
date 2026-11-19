-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 15/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

-- E3 v2: remind the player and staff once when a dev plan's period is about to end.
alter table public.dev_plans add column period_end_notified boolean not null default false;

create or replace function public.run_dev_plan_period_check()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare p record;
declare staffer record;
begin
  for p in
    select * from public.dev_plans
    where period_end is not null and period_end_notified = false
      and period_end <= current_date + interval '3 days'
      and period_end >= current_date
  loop
    perform private.notify(p.player_id, 'dev_plan_period_ending',
      jsonb_build_object('groupId', p.group_id, 'planId', p.id, 'title', p.title, 'periodEnd', p.period_end),
      '/coaching');
    for staffer in select user_id from public.group_members where group_id = p.group_id and role in ('owner', 'coach', 'analyst') loop
      perform private.notify(staffer.user_id, 'dev_plan_period_ending',
        jsonb_build_object('groupId', p.group_id, 'planId', p.id, 'title', p.title, 'periodEnd', p.period_end, 'playerId', p.player_id),
        '/coaching');
    end loop;
    update public.dev_plans set period_end_notified = true where id = p.id;
  end loop;
end;
$$;

select cron.schedule('dev-plan-period-check', '15 7 * * *', $$select public.run_dev_plan_period_check()$$);
