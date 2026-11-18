import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, LayoutDashboard, Loader2, Sword, Trophy } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { Team } from '@/lib/ipc'
import { useCollab } from '@/hooks/useCollab'
import { GroupSwitcher } from '@/components/Coaching/GroupSwitcher'
import { GroupTeamGate } from '@/components/team/GroupTeamGate'
import { resolveActiveGroup, useActiveGroupStore } from '@/store/useActiveGroupStore'
import { StatsTab } from './StatsTab'
import { DashboardTab } from './DashboardTab'
import { CustomGamesStatsTab } from './CustomGamesStatsTab'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'

type TabId = 'dashboard' | 'stats' | 'scrim' | 'tournament'

/**
 * Stats collectives (the Team page until 18 November 2026): the stats of the
 * team of the group picked in the header — the same pick as Coaching &
 * Management, whose Espace d'équipe, Champion Pool, Draft Sim and Scouting
 * tabs took over the roster and the preparation. Dashboard = flex + scrim +
 * tournament together; the three other tabs one source each.
 * Without any group (signed out, or none yet) the teams of this computer
 * are picked here instead.
 */
export function TeamPage() {
  const { t } = useTranslation()
  const { available, loading, groups } = useCollab()
  const storedGroupId = useActiveGroupStore((s) => s.groupId)
  const group = resolveActiveGroup(groups, storedGroupId)
  const [tab, setTab] = useState<TabId>('dashboard')
  const groupMode = available && !!group

  const tabs = [
    { id: 'dashboard' as const, label: t('team.tabs.dashboard', { defaultValue: 'Dashboard' }), icon: LayoutDashboard },
    { id: 'stats' as const, label: t('team.tabs.statsFlex', { defaultValue: 'Stats Flex' }), icon: BarChart3 },
    { id: 'scrim' as const, label: t('team.tabs.statsScrim', { defaultValue: 'Stats Scrim' }), icon: Sword },
    { id: 'tournament' as const, label: t('team.tabs.statsTournament', { defaultValue: 'Stats Tournoi' }), icon: Trophy },
  ]

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('team.statsTitle')}</h1>
          <p className="mt-1 text-sm text-hextech-text">{t('team.statsSubtitle')}</p>
        </div>
        {groupMode && <GroupSwitcher groups={groups} active={group} />}
      </div>

      <div className="flex border-b border-hextech-border-dim">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              tab === id
                ? 'border-hextech-gold text-hextech-gold-bright'
                : 'border-transparent text-hextech-text-dim hover:text-hextech-text',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
      ) : groupMode && group ? (
        <GroupTeamGate key={group.id} group={group}>{(team) => content(team)}</GroupTeamGate>
      ) : (
        <LocalTeams>{(team) => content(team)}</LocalTeams>
      )}
    </div>
  )
}

/** No group: one of this computer's teams, and where the roster is managed now. */
function LocalTeams({ children }: { children: (team: Team) => ReactNode }) {
  const { t } = useTranslation()
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  useEffect(() => {
    window.api.listTeams({ isOpponent: false }).then((list) => { setTeams(list); setActiveId((id) => id ?? list[0]?.id ?? null) }).catch(() => setTeams([]))
  }, [])
  if (!teams) return <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
  const active = teams.find((x) => x.id === activeId) ?? null
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-hextech-text-dim">{t('team.activeTeam', { defaultValue: 'Active team' })}:</span>
        {teams.map((team) => (
          <button
            key={team.id}
            onClick={() => setActiveId(team.id)}
            className={cn('rounded-md px-3 py-1 text-sm font-medium transition-colors', team.id === activeId ? 'bg-hextech-gold text-black' : 'bg-white/5 text-hextech-text hover:bg-white/10')}
          >
            {team.name}
          </button>
        ))}
        <span className="ml-auto text-xs text-hextech-text-dim">{t('team.localHint')}</span>
      </Card>
      {active ? children(active) : <Card className="p-6 text-center text-sm text-hextech-text-dim">{t('team.localHint')}</Card>}
    </div>
  )
}
