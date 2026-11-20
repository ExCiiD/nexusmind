-- #46 point 4 ("ore wa ayura", 20 November 2026): a row of the group's published roster (team_rosters, own roster:
-- scouting_id null) that the desktop's publish could not match to a member (teamCore.publishTeam links by puuid,
-- then by Riot ID) is linked by the staff, by hand.
--
-- public.link_roster_member(p_roster, p_user):
--   - the group's staff only (private.is_group_staff, the same people who may write team_rosters)
--   - p_user must be a member of the roster row's group. null unlinks the row.
--   - the row takes the member's account. Their CURRENT Riot ID (the one they publish, #38) and their puuid are copied
--     only when the server verified them (puuid_status 'verified', verify-member-puuid): the staff never types a
--     puuid, and a member who declared someone else's Riot ID does not get the row's stats computed on that account
--     (CyberSecurity, 20/11/2026). Otherwise the row keeps its Riot ID and has no puuid.
--   - returns true when the Riot ID and puuid were taken from the member, false when the row kept its own (the screen
--     says the member's Riot ID is not verified yet).
--   - one row per member in the group's own roster: another row linked to that member is unlinked.
-- Errors: FORBIDDEN, NOT_FOUND (no such row, or a scouted opponent's row), NOT_A_MEMBER.
-- Re-runnable: drop and create. No semicolon inside a comment.

drop function if exists public.link_roster_member(uuid, uuid);
create function public.link_roster_member(p_roster uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.team_rosters;
  v_member public.group_members;
  v_ign text;
  v_tag text;
begin
  select * into v_row from public.team_rosters where id = p_roster for update;
  if v_row.id is null or v_row.scouting_id is not null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null or not private.is_group_staff(v_row.group_id, v_uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_user is null then
    update public.team_rosters set user_id = null where id = p_roster;
    return false;
  end if;

  select * into v_member from public.group_members where group_id = v_row.group_id and user_id = p_user;
  if v_member.user_id is null then
    raise exception 'NOT_A_MEMBER' using errcode = 'P0002';
  end if;

  -- Only a Riot ID the server verified replaces the row's one.
  if v_member.puuid_status = 'verified' and v_member.riot_id is not null and btrim(v_member.riot_id) <> '' then
    if position('#' in v_member.riot_id) > 0 then
      v_ign := nullif(btrim(left(v_member.riot_id, length(v_member.riot_id) - position('#' in reverse(v_member.riot_id)))), '');
      v_tag := nullif(btrim(right(v_member.riot_id, position('#' in reverse(v_member.riot_id)) - 1)), '');
    else
      v_ign := btrim(v_member.riot_id);
    end if;
  end if;

  update public.team_rosters set user_id = null
  where group_id = v_row.group_id and scouting_id is null and user_id = p_user and id <> p_roster;

  update public.team_rosters set
    user_id = p_user,
    puuid = case when v_member.puuid_status = 'verified' then v_member.puuid end,
    ign = coalesce(left(v_ign, 64), ign),
    tag_line = case when v_ign is not null then left(v_tag, 16) else tag_line end
  where id = p_roster;
  return coalesce(v_member.puuid_status = 'verified', false);
end;
$$;
revoke all on function public.link_roster_member(uuid, uuid) from public, anon;
grant execute on function public.link_roster_member(uuid, uuid) to authenticated;
