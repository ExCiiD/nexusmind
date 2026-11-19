-- #34: the group's Discord managers can unlink the Discord server linked to
-- their group (before: a server linked by mistake could not be moved, and
-- /link-team refuses to take over a server linked to another group, S19-03).
--
-- Who manages the Discord link: owner, coach and manager. One list for the
-- server and the bot: private.is_discord_manager here, and the bot's
-- /set-channel check (DISCORD_MANAGER_ROLES in src/lib/discordBotCore.ts).
-- A dedicated function, so private.is_group_staff (owner, coach, analyst,
-- used by many policies) is left as it is.
--
-- An RPC rather than a DELETE policy: the discord_* tables were created on
-- the production project outside this folder (WSC-05), so their policies are
-- not visible here.
-- Not applied anywhere yet: production needs the user's go-ahead.

create or replace function private.is_discord_manager(p_group uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid() and role in ('owner', 'coach', 'manager')
  )
$$;
revoke all on function private.is_discord_manager(uuid) from public, anon;
grant execute on function private.is_discord_manager(uuid) to authenticated;

create or replace function public.unlink_discord_guild(p_group uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if auth.uid() is null then
    raise exception 'LOGIN_REQUIRED' using errcode = '42501';
  end if;
  if not private.is_discord_manager(p_group) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.discord_guild_links where group_id = p_group;
  get diagnostics n = row_count;
  return n > 0;
end
$$;
revoke execute on function public.unlink_discord_guild(uuid) from public, anon;
grant execute on function public.unlink_discord_guild(uuid) to authenticated;
