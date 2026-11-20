import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, ListTree, Swords, Target, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useCollab } from '@/hooks/useCollab'
import { isLegacyStaff } from '@/lib/permissions'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'
import type { Team } from '@/lib/ipc'
import { RosterTab } from '@/pages/Team/RosterTab'
import { RosterLinkButton } from '@/components/team/RosterLinkButton'
import { ChampPoolTab } from '@/pages/Team/ChampPoolTab'
import { DraftTab } from '@/pages/Team/DraftTab'
import { ScoutingTab } from '@/pages/Team/ScoutingTab'
import { DraftSimSection } from '@/components/analyst/DraftJournalSection'
import { useTabParam } from '@/components/team/TeamSection'
import { NoTeamPage } from '@/components/team/NoTeamPage'

type TabId = 'roster' | 'pool' | 'draft' | 'scouting'
const TAB_IDS: readonly TabId[] = ['roster', 'pool', 'draft', 'scouting']

/**
 * Web Team page (E14, docs/PLAN_GESTION_EQUIPE.md): the SAME roster/
 * champion-pool/draft-sim/scouting tabs the desktop app uses, reused
 * unchanged (src/pages/Team/*.tsx) — only the data source differs: the
 * desktop talks to a local SQLite team, this page talks to the signed-in
 * group's shared `team_rosters`/`team_pool_entries`/`team_drafts`/
 * `team_scouting` tables (web/src/api.ts, src/lib/teamCore.ts), live and
 * editable, not the one-shot read-only "Team workspace" snapshot on the
 * Coaching page.
 *
 * One roster per group — a group IS the team here, there's no separate
 * "create a team" step like on desktop. Only groups of kind "team" are
 * offered; "coaching"-kind groups (1:1 relationships) have no roster.
 *
 * Stats/Dashboard/Custom games (desktop-only CSV import, local match
 * history analytics) aren't ported — out of scope for this pass, see
 * docs/PLAN_GESTION_EQUIPE.md §8 E14.
 */
export function TeamPage() {
  const { t } = useTranslation()
  const { loading: collabLoading, groups, myUserId, nameOf } = useCollab()
  const teamGroups = useMemo(() => groups.filter((g) => g.kind === 'team'), [groups])
  const [groupId, setGroupId] = useState<string | null>(null)
  const activeGroup = teamGroups.find((g) => g.id === groupId)
  const [myTeam, setMyTeam] = useState<Team | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useTabParam(TAB_IDS, 'roster')

  useEffect(() => {
    if (!groupId && teamGroups.length > 0) setGroupId(teamGroups[0].id)
  }, [teamGroups, groupId])

  const load = useCallback(async () => {
    if (!groupId) return
    window.api.teamSetActiveGroup?.(groupId)
    setLoading(true)
    try {
      const teams = await window.api.listTeams({ isOpponent: false })
      setMyTeam(teams[0] ?? null)
    } catch (err) {
      console.error('[web TeamPage] Failed to load team:', err)
      setMyTeam(null)
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { load() }, [load])

  if (collabLoading) {
    return <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
  }

  // § 18.2: without any group, « Rejoins une équipe ».
  if (groups.length === 0) return <NoTeamPage />

  if (teamGroups.length === 0) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('web.team.title', { defaultValue: 'Team' })}</h1>
        <Card className="p-6 text-center text-hextech-text-dim">
          {t('web.team.noGroup', { defaultValue: 'No team group yet — create or join one from the Coaching page\'s Groups tab.' })}
        </Card>
      </div>
    )
  }

  const TABS: Array<{ id: TabId; label: string; icon: typeof Users }> = [
    { id: 'roster', label: t('team.tabs.roster', { defaultValue: 'Roster' }), icon: Users },
    { id: 'pool', label: t('team.tabs.pool', { defaultValue: 'Champion Pool' }), icon: ListTree },
    { id: 'draft', label: t('team.tabs.draft', { defaultValue: 'Draft Sim' }), icon: Swords },
    { id: 'scouting', label: t('team.tabs.scouting', { defaultValue: 'Scouting' }), icon: Target },
  ]

  return (
    <div className={cn('animate-fade-in', tab === 'roster' ? 'flex min-h-[calc(100dvh-4rem)] flex-col gap-4' : 'space-y-4')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('web.team.title', { defaultValue: 'Team' })}</h1>
        {teamGroups.length > 1 && (
          <select
            value={groupId ?? ''}
            onChange={(e) => setGroupId(e.target.value)}
            className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1 text-sm text-hextech-text"
          >
            {teamGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex border-b border-hextech-border-dim overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              tab === id ? 'border-hextech-gold text-hextech-gold-bright' : 'border-transparent text-hextech-text-dim hover:text-hextech-text',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className={cn(tab === 'roster' && 'flex flex-1 flex-col')}>
        {tab === 'roster' && (
          <PanelErrorBoundary key="roster" label="Roster">
            <RosterTab team={myTeam} loading={loading} onChange={load} fill actions={activeGroup ? <RosterLinkButton group={activeGroup} /> : undefined} />
          </PanelErrorBoundary>
        )}
        {tab === 'pool' && (
          <PanelErrorBoundary key="pool" label="Champion pool">
            <ChampPoolTab team={myTeam} onChange={load} />
          </PanelErrorBoundary>
        )}
        {tab === 'draft' && (
          <PanelErrorBoundary key="draft" label="Draft sim">
            {groupId ? (
              <DraftSimSection groupId={groupId} preparation={(openDraftId) => (
                <DraftTab myTeam={myTeam} groupId={groupId} myUserId={myUserId ?? undefined} nameOf={nameOf} isStaff={!!activeGroup && isLegacyStaff(activeGroup.myRole, activeGroup.myStaffRoles)} openDraftId={openDraftId} />
              )} />
            ) : (
              <DraftTab myTeam={myTeam} groupId={undefined} myUserId={myUserId ?? undefined} nameOf={nameOf} isStaff={false} />
            )}
          </PanelErrorBoundary>
        )}
        {tab === 'scouting' && (
          <PanelErrorBoundary key={`scouting-${groupId ?? 'none'}`} label="Scouting">
            <ScoutingTab groupId={groupId ?? undefined} />
          </PanelErrorBoundary>
        )}
      </div>
    </div>
  )
}
