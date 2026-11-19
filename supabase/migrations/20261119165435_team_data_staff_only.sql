-- #43 / S19-17 (docs/AUDIT_SECURITE.md, 19/11/2026): a member's team data
-- (Team, TeamMember, ChampionPoolEntry, DraftPrep, CustomGame in their
-- sync_records) was readable by ANY member of ANY group they share, players
-- included, as long as share_team was true OR NOT SET. A coach of two teams
-- exposed one team's rosters, scouting, drafts and scrim results to the
-- other's players.
--
-- Now, like the two other branches of this function: staff only (owner,
-- coach, analyst, manager), and only when the member explicitly shared
-- (share_team = true, no default). The two other branches are unchanged.
--
-- The one app feature that read teammates' team rows (the drafts linked to
-- a scrim, web/src/scrims.ts listTeamDrafts) now reads the group's own
-- team_drafts (WSC-19, same wave). Group data lives in group tables
-- (team_drafts, team_custom_games from #41a), not personal sync_records.
-- Not applied anywhere yet: production needs the user's go-ahead.

create or replace function private.can_read_player_table(p_owner uuid, p_table text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_members viewer
    join public.group_members owner_m on owner_m.group_id = viewer.group_id and owner_m.user_id = p_owner
    left join public.group_sharing s on s.group_id = viewer.group_id and s.user_id = p_owner
    where viewer.user_id = auth.uid()
      and viewer.user_id <> p_owner
      and (
        (p_table in ('Session', 'Game', 'Review', 'Mistake', 'MistakeTag', 'Recording', 'Bookmark', 'ExternalReview')
          and viewer.role in ('owner', 'coach', 'analyst') and coalesce(s.share_reviews, true))
        or (p_table in ('Assessment', 'AssessmentScore', 'StatsSnapshot', 'Badge', 'Account', 'CoachingExperiment')
          and viewer.role in ('owner', 'coach', 'analyst') and coalesce(s.share_stats, true))
        or (p_table in ('Team', 'TeamMember', 'ChampionPoolEntry', 'DraftPrep', 'CustomGame')
          and viewer.role in ('owner', 'coach', 'analyst', 'manager') and s.share_team is true)
      )
  )
$$;
