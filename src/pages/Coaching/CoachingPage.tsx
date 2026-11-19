import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Film, FileBarChart, GraduationCap, ListTree, Swords, Target } from 'lucide-react'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'
import { GroupTeamGate } from '@/components/team/GroupTeamGate'
import { NoGroupNotice, SectionTabs, TeamSectionHeader, useTabParam, useTeamSection, type SectionTab } from '@/components/team/TeamSection'
import { isLegacyStaff } from '@/lib/permissions'
import { TeamCodexCard } from '@/components/MicroReview/CoachMicroReviews'
import { PlayersSection } from './PlayersSection'
import { VodReviewSection } from './VodReviewSection'
import { WeeklyReportSection } from './WeeklyReportSection'
import { ChampPoolTab } from '@/pages/Team/ChampPoolTab'
import { DraftTab } from '@/pages/Team/DraftTab'
import { ScoutingTab } from '@/pages/Team/ScoutingTab'

type TabId = 'pool' | 'draft' | 'scouting' | 'players' | 'vod' | 'reports'

/**
 * Coaching: preparing and reviewing play with the group picked in the
 * section header — Champion Pool, Draft Sim and Scouting on the group's team
 * (GroupTeamGate), the players' follow-up, VOD reviews and the weekly report.
 * Running the group (overview, planning, wellbeing, tasks, trials, groups)
 * lives in Management, the roster in Espace d'équipe.
 *
 * The web app has its own Team page for the pool, draft and scouting (its
 * adapter cannot link a local team to a group), so those tabs only show
 * where the platform can (desktop).
 */
export function CoachingPage() {
  const { t } = useTranslation()
  const section = useTeamSection()
  const { available, loading, myUserId, group, nameOf } = section

  const hasGroup = !!group
  const isStaff = !!group && isLegacyStaff(group.myRole)
  const canLinkTeams = typeof window.api.linkTeamToGroup === 'function'
  const groupsHere = useMemo(() => (group ? [group] : []), [group])
  const staffHere = useMemo(() => (group && isStaff ? [group] : []), [group, isStaff])

  const tabs = useMemo(() => ([
    { id: 'pool' as const, label: t('team.tabs.pool'), icon: ListTree, show: hasGroup && canLinkTeams },
    { id: 'draft' as const, label: t('team.tabs.draft'), icon: Swords, show: hasGroup && canLinkTeams },
    { id: 'scouting' as const, label: t('team.tabs.scouting'), icon: Target, show: hasGroup && canLinkTeams },
    { id: 'players' as const, label: t('coaching.tabs.players'), icon: GraduationCap, show: isStaff },
    { id: 'vod' as const, label: t('coaching.tabs.vod'), icon: Film, show: hasGroup },
    { id: 'reports' as const, label: t('coaching.tabs.reports'), icon: FileBarChart, show: isStaff },
  ] satisfies Array<SectionTab<TabId> & { show: boolean }>).filter((x) => x.show), [t, hasGroup, isStaff, canLinkTeams])
  const [tab, setTab] = useTabParam(tabs.map((x) => x.id), tabs[0]?.id ?? 'vod')

  const k = group?.id ?? 'none'

  return (
    <div className="space-y-4 animate-fade-in">
      <TeamSectionHeader title={t('coaching.title')} subtitle={t('coaching.subtitle')} section={section} />
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
      ) : !available || !myUserId ? (
        <p className="text-sm text-hextech-text-dim">{t('coaching.unavailable')}</p>
      ) : !group ? (
        <NoGroupNotice />
      ) : (
        <>
          <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
          <div>
            {tab === 'pool' && (
              <PanelErrorBoundary key={`pool-${k}`} label="Champion pool">
                <GroupTeamGate group={group}>{(team, reloadTeam) => <ChampPoolTab team={team} onChange={reloadTeam} />}</GroupTeamGate>
              </PanelErrorBoundary>
            )}
            {tab === 'draft' && (
              <PanelErrorBoundary key={`draft-${k}`} label="Draft sim">
                <GroupTeamGate group={group}>{(team) => <DraftTab myTeam={team} opponentsGroupId={group.id} />}</GroupTeamGate>
              </PanelErrorBoundary>
            )}
            {tab === 'scouting' && (
              <PanelErrorBoundary key={`scouting-${k}`} label="Scouting">
                <ScoutingTab groupId={group.id} />
              </PanelErrorBoundary>
            )}
            {tab === 'players' && (
              <PanelErrorBoundary key={`players-${k}`} label="Players">
                <PlayersSection staffGroups={staffHere} myUserId={myUserId} nameOf={nameOf} />
              </PanelErrorBoundary>
            )}
            {tab === 'vod' && (
              <PanelErrorBoundary key={`vod-${k}`} label="VOD review">
                <div className="space-y-4">
                  <VodReviewSection groups={groupsHere} myUserId={myUserId} nameOf={nameOf} />
                  <TeamCodexCard staffGroups={staffHere} />
                </div>
              </PanelErrorBoundary>
            )}
            {tab === 'reports' && (
              <PanelErrorBoundary key={`reports-${k}`} label="Weekly report">
                <WeeklyReportSection staffGroups={staffHere} />
              </PanelErrorBoundary>
            )}
          </div>
        </>
      )}
    </div>
  )
}
