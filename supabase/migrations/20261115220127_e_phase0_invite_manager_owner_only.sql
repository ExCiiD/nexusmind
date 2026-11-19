-- Back-filled on 19 November 2026 from production
-- (supabase_migrations.schema_migrations, version 20261115220127): applied
-- there on 15 November 2026 but never committed. Kept verbatim.

-- "manager" is a peer-level staff role to "coach" (same privilege-escalation
-- risk), so inviting-as-manager is owner-only too, same rule as coach.
create or replace function public.create_group_invite(p_group uuid, p_role text default 'player', p_days integer default 7, p_max_uses integer default 10)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare c text;
begin
  if not private.is_group_staff(p_group) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role in ('coach', 'manager') and private.group_role(p_group) <> 'owner' then
    raise exception 'only the owner can invite coaches or managers' using errcode = '42501';
  end if;
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
    into c from generate_series(1, 10);
  insert into public.group_invites (code, group_id, role, expires_at, max_uses)
  values (c, p_group, p_role, now() + make_interval(days => least(greatest(p_days, 1), 30)), least(greatest(p_max_uses, 1), 100));
  return c;
end;
$$;
