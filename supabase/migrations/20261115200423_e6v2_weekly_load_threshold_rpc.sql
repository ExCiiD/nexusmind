-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 15/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

-- Staff-wide (owner/coach/analyst), not owner-only like the general groups
-- UPDATE policy — this is an operational tuning knob, not group identity,
-- so a narrow RPC updates just this one column rather than widening the
-- general policy to every column (name, kind, etc.) for coach/analyst.
create or replace function public.set_weekly_load_threshold(p_group uuid, p_hours int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_group_staff(p_group) then
    raise exception 'FORBIDDEN';
  end if;
  if p_hours < 1 or p_hours > 100 then
    raise exception 'INVALID_THRESHOLD';
  end if;
  update public.groups set weekly_load_threshold_hours = p_hours where id = p_group;
end;
$$;
