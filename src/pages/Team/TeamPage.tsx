import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/hooks/useToast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Users, Swords, Target, ListTree, Plus, BarChart3, LayoutDashboard, Sword, Trophy, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Team } from '@/lib/ipc'
import { RosterTab } from './RosterTab'
import { ChampPoolTab } from './ChampPoolTab'
import { DraftTab } from './DraftTab'
import { ScoutingTab } from './ScoutingTab'
import { StatsTab } from './StatsTab'
import { DashboardTab } from './DashboardTab'
import { CustomGamesStatsTab } from './CustomGamesStatsTab'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'

type TabId = 'roster' | 'pool' | 'draft' | 'scouting' | 'stats' | 'dashboard' | 'scrim' | 'tournament'

export function TeamPage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [tab, setTab] = useState<TabId>('dashboard')
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      // My teams = isOpponent: false
      const myTeams = await window.api.listTeams({ isOpponent: false })
      setTeams(myTeams)
      if (myTeams.length > 0 && !activeTeamId) {
        setActiveTeamId(myTeams[0].id)
      }
    } catch (err) {
      console.error('[TeamPage] Failed to load teams:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const handleCreateTeam = async () => {
    const name = newTeamName.trim()
    if (!name) return
    try {
      const team = await window.api.createTeam({ name, isOpponent: false })
      setNewTeamName('')
      setCreatingTeam(false)
      setActiveTeamId(team.id)
      await load()
      toast({ title: t('team.created', { defaultValue: 'Team created' }) })
    } catch (err) {
      toast({ title: 'Failed to create team', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const handleDeleteTeam = async (id: string, name: string) => {
    const confirmed = confirm(t('team.confirmDelete', {
      defaultValue: 'Delete team "{{name}}"? Roster, champion pools, draft preps, and imported custom games will be lost. This cannot be undone.',
      name,
    }))
    if (!confirmed) return
    try {
      await window.api.deleteTeam(id)
      if (activeTeamId === id) {
        const remaining = teams.filter((t) => t.id !== id)
        setActiveTeamId(remaining[0]?.id ?? null)
      }
      await load()
      toast({ title: t('team.deleted', { defaultValue: 'Team deleted' }), description: name })
    } catch (err) {
      toast({
        title: t('team.deleteFailed', { defaultValue: 'Failed to delete team' }),
        description: (err as Error).message,
        variant: 'destructive',
      })
    }
  }

  const activeTeam = teams.find((t) => t.id === activeTeamId) ?? null

  return (
    // Wide layout — Team Management has dense grids (champion list, drafts, scouting),
    // so we use the full window width up to a generous ceiling instead of `max-w-7xl`
    // which left half the screen empty on 1080p+ displays.
    <div className="p-6 space-y-4 w-full max-w-[1800px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-hextech-text-bright flex items-center gap-2">
            <Users className="h-6 w-6 text-hextech-gold" />
            {t('team.title', { defaultValue: 'Team Management' })}
          </h1>
          <p className="text-sm text-hextech-text-dim mt-1">
            {t('team.subtitle', { defaultValue: 'Manage your roster, prepare drafts, and scout opponents.' })}
          </p>
        </div>
      </div>

      {/* Team selector + create */}
      <Card className="p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-hextech-text-dim font-semibold">
          {t('team.activeTeam', { defaultValue: 'Active team' })}:
        </span>
        {teams.length === 0 && !loading && (
          <span className="text-sm text-hextech-text-dim italic">
            {t('team.noTeams', { defaultValue: 'No team yet — create your first one to start.' })}
          </span>
        )}
        {teams.map((team) => (
          <div
            key={team.id}
            className={cn(
              'group flex items-center rounded-md text-sm font-medium transition-colors',
              team.id === activeTeamId
                ? 'bg-hextech-gold text-black'
                : 'bg-white/5 text-hextech-text hover:bg-white/10',
            )}
          >
            <button
              onClick={() => setActiveTeamId(team.id)}
              className="px-3 py-1 flex items-center"
            >
              {team.name}
              {team.tag && <span className="ml-1 text-xs opacity-60">[{team.tag}]</span>}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteTeam(team.id, team.name) }}
              className={cn(
                'opacity-0 group-hover:opacity-100 transition-opacity pr-2 pl-1 py-1',
                team.id === activeTeamId
                  ? 'text-black/60 hover:text-red-700'
                  : 'text-hextech-text-dim hover:text-red-400',
              )}
              title={t('team.deleteTooltip', { defaultValue: 'Delete team' })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {creatingTeam ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateTeam()
                else if (e.key === 'Escape') { setCreatingTeam(false); setNewTeamName('') }
              }}
              placeholder={t('team.newTeamName', { defaultValue: 'Team name…' })}
              className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-sm text-hextech-text-bright focus:outline-none focus:border-hextech-gold"
            />
            <Button size="sm" onClick={handleCreateTeam}>
              {t('common.create', { defaultValue: 'Create' })}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setCreatingTeam(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('team.newTeam', { defaultValue: 'New team' })}
          </Button>
        )}
      </Card>

      {/* Tabs */}
      <div className="flex border-b border-hextech-border-dim">
        {([
          // Dashboard first — it's the highest-signal overview and acts as
          // the landing page for the Team section.
          { id: 'dashboard' as const, label: t('team.tabs.dashboard', { defaultValue: 'Dashboard' }), icon: LayoutDashboard },
          { id: 'roster' as const, label: t('team.tabs.roster', { defaultValue: 'Roster' }), icon: Users },
          { id: 'pool' as const, label: t('team.tabs.pool', { defaultValue: 'Champion Pool' }), icon: ListTree },
          { id: 'draft' as const, label: t('team.tabs.draft', { defaultValue: 'Draft Sim' }), icon: Swords },
          { id: 'scouting' as const, label: t('team.tabs.scouting', { defaultValue: 'Scouting' }), icon: Target },
          { id: 'stats' as const, label: t('team.tabs.statsFlex', { defaultValue: 'Stats Flex' }), icon: BarChart3 },
          { id: 'scrim' as const, label: t('team.tabs.statsScrim', { defaultValue: 'Stats Scrim' }), icon: Sword },
          { id: 'tournament' as const, label: t('team.tabs.statsTournament', { defaultValue: 'Stats Tournoi' }), icon: Trophy },
        ]).map(({ id, label, icon: Icon }) => (
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

      {/* Tab content — each tab wrapped in its own error boundary so a
          crash in one (e.g. a bad render in the synergy panel) never
          black-screens the entire app. Each boundary's `key` is the tab
          id so switching tabs always resets the boundary state. */}
      <div>
        {tab === 'roster' && (
          <PanelErrorBoundary key="roster" label="Roster">
            <RosterTab team={activeTeam} loading={loading} onChange={load} />
          </PanelErrorBoundary>
        )}
        {tab === 'pool' && (
          <PanelErrorBoundary key="pool" label="Champion pool">
            <ChampPoolTab team={activeTeam} onChange={load} />
          </PanelErrorBoundary>
        )}
        {tab === 'draft' && (
          <PanelErrorBoundary key="draft" label="Draft sim">
            <DraftTab myTeam={activeTeam} />
          </PanelErrorBoundary>
        )}
        {tab === 'scouting' && (
          <PanelErrorBoundary key="scouting" label="Scouting">
            <ScoutingTab />
          </PanelErrorBoundary>
        )}
        {tab === 'dashboard' && (
          <PanelErrorBoundary key="dashboard" label="Dashboard">
            <DashboardTab team={activeTeam} />
          </PanelErrorBoundary>
        )}
        {tab === 'stats' && (
          <PanelErrorBoundary key="stats" label="Stats Flex">
            <StatsTab team={activeTeam} />
          </PanelErrorBoundary>
        )}
        {tab === 'scrim' && (
          <PanelErrorBoundary key="scrim" label="Stats Scrim">
            <CustomGamesStatsTab team={activeTeam} gameType="scrim" />
          </PanelErrorBoundary>
        )}
        {tab === 'tournament' && (
          <PanelErrorBoundary key="tournament" label="Stats Tournament">
            <CustomGamesStatsTab team={activeTeam} gameType="tournament" />
          </PanelErrorBoundary>
        )}
      </div>
    </div>
  )
}
