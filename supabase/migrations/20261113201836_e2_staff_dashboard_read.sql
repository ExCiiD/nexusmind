-- E2 (staff dashboard): staff needs to read a player's CoachingExperiment
-- rows (current objective + its B1 verdict) through sync_records, same
-- consent gate as the rest of their stats.

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
          and coalesce(s.share_team, true))
      )
  )
$$;
