-- Fix: `gm.user_id <> p_actor` is NULL (matches no row) when p_actor is NULL
-- (auth.uid() with no JWT context), so a scrim update made outside a normal
-- authenticated session would silently notify no one instead of everyone.
-- `IS DISTINCT FROM` treats NULL correctly: exclude no one, not everyone.

create or replace function public.notify_scrim_members(p_scrim public.scrims, p_type text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, type, data, link)
  select gm.user_id, p_type,
         jsonb_build_object('groupId', p_scrim.group_id, 'scrimId', p_scrim.id,
                             'title', p_scrim.title, 'scheduledAt', p_scrim.scheduled_at),
         '/scrims?scrimId=' || p_scrim.id
  from public.group_members gm
  where gm.group_id = p_scrim.group_id and gm.user_id is distinct from p_actor;
end;
$$;
revoke all on function public.notify_scrim_members(public.scrims, text, uuid) from public, authenticated, anon;
