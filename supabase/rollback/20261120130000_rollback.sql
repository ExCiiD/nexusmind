-- Rollback of 20261120130000_roster_member_link (#46 point 4). The links already made stay (team_rosters.user_id,
-- puuid and Riot ID are ordinary columns, written by the staff before this function existed too).
drop function if exists public.link_roster_member(uuid, uuid);
