import { useTranslation } from 'react-i18next'
import { BarChart3, LayoutDashboard, Loader2, Sword, Target, Trophy } from 'lucide-react'
import type { Team } from '@/lib/ipc'
import { GroupTeamGate } from '@/components/team/GroupTeamGate'
import { NoGroupNotice, SectionTabs, TeamSectionHeader, useTabParam, useTeamSection } from '@/components/team/TeamSection'
import { StatsTab } from './StatsTab'
import { DashboardTab } from './DashboardTab'
import { CustomGamesStatsTab } from './CustomGamesStatsTab'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'
import { TeamObjectivesTab } from '@/components/analyst/TeamObjectivesTab'

/**
 * Stats collectives (the Team page until 18 November 2026): the stats of the
 * team of the group picked in the header — the same pick as Coaching &
 * Management, whose Espace d'équipe, Champion Pool, Draft Sim and Scouting
 * tabs took over the roster and the preparation. Dashboard = flex + scrim +
 * tournament together; the three other tabs one source each.
 * The team is the group's players (GroupTeamGate builds it from the members
 * who joined with their Riot account); without a group there is nothing to
 * show but how to get one.
 */
export function TeamPage() {
  const { t } = useTranslation()
  const section = useTeamSection()
  const { available, loading, group } = section
  const groupMode = available && !!group

  const tabs = [
    { id: 'dashboard' as const, label: t('team.tabs.dashboard', { defaultValue: 'Dashboard' }), icon: LayoutDashboard },
    { id: 'stats' as const, label: t('team.tabs.statsFlex', { defaultValue: 'Stats Flex' }), icon: BarChart3 },
    { id: 'scrim' as const, label: t('team.tabs.statsScrim', { defaultValue: 'Stats Scrim' }), icon: Sword },
    { id: 'tournament' as const, label: t('team.tabs.statsTournament', { defaultValue: 'Stats Tournoi' }), icon: Trophy },
    // #40 · 1/3: the group's games, not the local team (no GroupTeamGate needed).
    { id: 'objectives' as const, label: t('team.tabs.objectives'), icon: Target },
  ]
  const [tab, setTab] = useTabParam(tabs.map((x) => x.id), 'dashboard')

  const content = (team: Team) => (
    <PanelErrorBoundary key={`${tab}-${team.id}`} label={tab}>
      {tab === 'dashboard' && <DashboardTab team={team} />}
      {tab === 'stats' && <StatsTab team={team} />}
      {tab === 'scrim' && <CustomGamesStatsTab team={team} gameType="scrim" />}
      {tab === 'tournament' && <CustomGamesStatsTab team={team} gameType="tournament" />}
    </PanelErrorBoundary>
  )

  return (
    <div className="w-full space-y-4 py-4">
      <TeamSectionHeader title={t('team.statsTitle')} subtitle={t('team.statsSubtitle')} section={section} />
      <SectionTabs tabs={tabs} active={tab} onChange={setTab} />

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
      ) : groupMode && group && tab === 'objectives' ? (
        <PanelErrorBoundary key={`objectives-${group.id}`} label="objectives"><TeamObjectivesTab groupId={group.id} /></PanelErrorBoundary>
      ) : groupMode && group ? (
        <GroupTeamGate key={group.id} group={group}>{(team) => content(team)}</GroupTeamGate>
      ) : available ? (
        <NoGroupNotice>{t('team.noGroup')}</NoGroupNotice>
      ) : (
        <p className="text-sm text-hextech-text-dim">{t('team.signedOut')}</p>
      )}
    </div>
  )
}
