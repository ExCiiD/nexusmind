import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, LayoutDashboard, Loader2, Sword, Trophy } from 'lucide-react'
import { NoGroupNotice, SectionTabs, TeamSectionHeader, useTabParam, useTeamSection } from '@/components/team/TeamSection'
import { ErrorState } from '@/components/ui/data-state'
import { DashboardTab } from '@/pages/Team/DashboardTab'
import { StatsTab } from '@/pages/Team/StatsTab'
import { CustomGamesStatsTab } from '@/pages/Team/CustomGamesStatsTab'
import type { Team } from '@/lib/ipc'

/**
 * Stats collectives on the web (#41b): the desktop's four tabs (src/pages/Team/TeamPage.tsx), fed by the web
 * adapters (computeCombinedStats, computeTeamSynergyStats, computeCustomStats, listCustomGames in web/src/api.ts,
 * same Core as the desktop). The web team is the group's published roster (listTeams), so no local team to build
 * (no GroupTeamGate). Scrim and Tournament are read only: the staff imports the games from the desktop.
 */
export function TeamStatsPage() {
  const { t } = useTranslation()
  const section = useTeamSection()
  const { available, loading, group } = section
  const [team, setTeam] = useState<Team | null>(null)
  const [teamState, setTeamState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  const tabs = [
    { id: 'dashboard' as const, label: t('team.tabs.dashboard', { defaultValue: 'Dashboard' }), icon: LayoutDashboard },
    { id: 'stats' as const, label: t('team.tabs.statsFlex', { defaultValue: 'Stats Flex' }), icon: BarChart3 },
    { id: 'scrim' as const, label: t('team.tabs.statsScrim', { defaultValue: 'Stats Scrim' }), icon: Sword },
    { id: 'tournament' as const, label: t('team.tabs.statsTournament', { defaultValue: 'Stats Tournoi' }), icon: Trophy },
  ]
  const [tab, setTab] = useTabParam(tabs.map((x) => x.id), 'dashboard')

  // The web adapter scopes team calls to the active group.
  const groupId = group?.id ?? null
  useEffect(() => {
    if (!groupId) { setTeam(null); return }
    let alive = true
    setTeamState('loading')
    window.api.teamSetActiveGroup?.(groupId)
    window.api.listTeams({ isOpponent: false })
      .then((teams) => { if (alive) { setTeam(teams[0] ?? null); setTeamState('ready') } })
      .catch(() => { if (alive) setTeamState('error') })
    return () => { alive = false }
  }, [groupId, attempt])

  return (
    <div className="w-full space-y-4">
      <TeamSectionHeader title={t('team.statsTitle')} subtitle={t('team.statsSubtitle')} section={section} />
      <SectionTabs tabs={tabs} active={tab} onChange={setTab} />

      {loading || (group && teamState === 'loading') ? (
        <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" aria-label={t('common.loading')} />
      ) : !available ? (
        <p className="text-sm text-hextech-text-dim">{t('team.signedOut')}</p>
      ) : !group ? (
        <NoGroupNotice>{t('team.noGroup')}</NoGroupNotice>
      ) : teamState === 'error' || !team ? (
        <ErrorState title={t('web.teamStats.loadFailed')} cause={t('web.teamStats.loadFailedCause')} onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <>
          {tab === 'dashboard' && <DashboardTab key={team.id} team={team} />}
          {tab === 'stats' && <StatsTab key={team.id} team={team} />}
          {tab === 'scrim' && <CustomGamesStatsTab key={team.id} team={team} gameType="scrim" readOnly />}
          {tab === 'tournament' && <CustomGamesStatsTab key={team.id} team={team} gameType="tournament" readOnly />}
        </>
      )}
    </div>
  )
}
