-- Security 26/11/2026 (S19-17 residual, decision "drafts de groupe unique aux groupes liés"):
-- the team data a player syncs (Team, TeamMember, ChampionPoolEntry, CustomGame, DraftPrep) was readable by the staff
-- of ANY group they share with the owner once share_team was on for that group. The data does not belong to a group in
-- sync_records, so a coach working for teams A and B exposed team B's roster, pools, scrims and drafts to A's staff.
--
-- Now a row of those tables is readable by a viewer only through the group its Team is linked to (Team.groupId in the
-- row's data, one hop for TeamMember, CustomGame and DraftPrep, two for ChampionPoolEntry). A team linked to no group,
-- and a draft prepared against no linked team, are not shared at all. The owner's own rows are unaffected
-- (sync_records_select_own). The group-owned tables (team_drafts, team_rosters, team_custom_games) already carry a
-- group_id and are not touched.
-- Re-runnable: create or replace, drop ... if exists. No semicolon inside a comment.

create or replace function private.synced_team_group(p_owner uuid, p_table text, p_data jsonb)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with link as (
    select case p_table
      when 'Team' then null
      when 'TeamMember' then p_data ->> 'teamId'
      when 'CustomGame' then p_data ->> 'teamId'
      when 'DraftPrep' then p_data ->> 'vsTeamId'
      when 'ChampionPoolEntry' then (
        select m.data ->> 'teamId'
        from public.sync_records m
        where m.user_id = p_owner and m.table_name = 'TeamMember' and not m.deleted
          and m.record_id = p_data ->> 'memberId'
      )
    end as team_id
  )
  select case
    when p_table = 'Team' then
      case when p_data ->> 'groupId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (p_data ->> 'groupId')::uuid end
    else (
      select case when t.data ->> 'groupId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (t.data ->> 'groupId')::uuid end
      from link l
      join public.sync_records t
        on t.user_id = p_owner and t.table_name = 'Team' and not t.deleted and t.record_id = l.team_id
    )
  end
$$;
revoke all on function private.synced_team_group(uuid, text, jsonb) from public, anon;
grant execute on function private.synced_team_group(uuid, text, jsonb) to authenticated;

-- The row-level reading rule: the old per-table rule, plus, for the team tables, the group the row belongs to.
create or replace function private.can_read_synced_row(p_owner uuid, p_table text, p_data jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_read_player_table(p_owner, p_table)
    and (
      p_table not in ('Team', 'TeamMember', 'ChampionPoolEntry', 'DraftPrep', 'CustomGame')
      or exists (
        select 1
        from public.group_members viewer
        join public.group_sharing s on s.group_id = viewer.group_id and s.user_id = p_owner
        where viewer.user_id = (select auth.uid())
          and viewer.group_id = private.synced_team_group(p_owner, p_table, p_data)
          and (viewer.role = any(array['owner', 'coach', 'analyst', 'manager'])
               or viewer.staff_roles && array['coach', 'analyst', 'manager'])
          and s.share_team is true
      )
    )
$$;
revoke all on function private.can_read_synced_row(uuid, text, jsonb) from public, anon;
grant execute on function private.can_read_synced_row(uuid, text, jsonb) to authenticated;

drop policy if exists sync_records_read_shared on public.sync_records;
create policy sync_records_read_shared on public.sync_records
  for select to authenticated
  using (private.can_read_synced_row(user_id, table_name, data));
