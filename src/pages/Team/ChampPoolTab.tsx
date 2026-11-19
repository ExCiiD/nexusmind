/**
 * Champion Pool (Coaching & Management → Champion Pool, and the web Team
 * page): one player's pool as a board of tiers, from the Penpot design
 * "Équipe — Champion Pool v2". A player selector, the pool header with its
 * actions, the share of games per champion, one lane per tier (Learning
 * folded) and a dialog to add champions by hand. A tile is dragged to
 * another lane, or clicked, to pick its tier by hand: auto-fill keeps it.
 * Tiers come from src/lib/threatCore.ts, the board's numbers from
 * src/lib/poolView.ts, the pieces from ./ChampionPoolBoard.tsx.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/useToast'
import { useAllChampions } from '@/hooks/useAllChampions'
import { useProfilePrefs } from '@/components/Profile/ProfileCard'
import { useUserStore } from '@/store/useUserStore'
import { useBackgroundJobsStore } from '@/store/useBackgroundJobsStore'
import { ScopeDialog, type FetchScope } from '@/components/team/ScopeDialog'
import type { Team, TeamMember, ChampionPoolEntry } from '@/lib/ipc'
import { compareByRole, type Role } from '@/lib/championRoles'
import { lookForMember, type LookSources } from '@/lib/playerCard'
import { groupByTier, summarizePool, tierCounts } from '@/lib/poolView'
import type { Tier } from '@/lib/threatCore'
import { RenamedNote } from '@/components/team/RenamedNote'
import { riotErrorText } from '@/lib/riotErrors'
import {
  AddChampionDialog,
  LearningLane,
  PlayerSelector,
  PoolHeader,
  GamesDistribution,
  TierLane,
  countsLabel,
  isPoolRole,
  useMemberLooks,
} from './ChampionPoolBoard'


/** Lanes shown open, in display order; "learning" is folded below them. */
const OPEN_LANES: Tier[] = ['main', 'comfort', 'flex', 'new']

interface Props {
  team: Team | null
  /** Called when team membership or pools change — parent should re-fetch */
  onChange?: () => void
}

const hasRiotId = (m: TeamMember) => !!(m.ign && m.tagLine && m.region)
const roleOf = (m: TeamMember | undefined): Role => {
  const r = (m?.role || '').toUpperCase()
  return isPoolRole(r) ? r : 'MID'
}

export function ChampPoolTab({ team, onChange }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { champions, loading: champsLoading } = useAllChampions()
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [pool, setPool] = useState<ChampionPoolEntry[]>([])
  const [poolLoading, setPoolLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  // Refresh from Riot: the scope dialog opens first, for the selected
  // player or for the whole team.
  const [scopeFor, setScopeFor] = useState<'member' | 'team' | null>(null)
  // The fetch loop lives in the global store so it survives navigation;
  // a job whose label names this team is "ours".
  const runningAutoFill = useBackgroundJobsStore(
    (s) => s.jobs.find((j) => j.kind === 'autoFill' && team && j.label.includes(team.name)) ?? null,
  )
  const startAutoFillJob = useBackgroundJobsStore((s) => s.runAutoFill)

  // Natural lane order (TOP → JGL → MID → ADC → SUP).
  const members = useMemo(() => [...(team?.members ?? [])].sort(compareByRole), [team?.members])
  const selectedMember = members.find((m) => m.id === selectedMemberId) ?? members[0]
  const effectiveMemberId = selectedMember?.id ?? null
  const role = roleOf(selectedMember)
  const eligibleMembers = useMemo(() => members.filter(hasRiotId), [members])

  // Profile looks for the selector (same sources as the roster cards).
  const user = useUserStore((s) => s.user)
  const prefs = useProfilePrefs(user?.id)
  const looks = useMemberLooks()
  const lookSources = useMemo<LookSources>(() => ({
    me: user
      ? {
          puuid: user.puuid,
          riotId: user.tagLine ? `${user.summonerName}#${user.tagLine}` : user.summonerName,
          look: prefs ? { iconId: prefs.iconId, bannerId: prefs.bannerId } : null,
        }
      : null,
    looks,
  }), [user, prefs, looks])

  const nameOf = useMemo(() => {
    const names = new Map(champions.map((c) => [c.key, c.name]))
    return (key: string) => names.get(key) ?? key
  }, [champions])

  // Duplicate detection — progressively looser keys (puuid, Riot ID, IGN,
  // display name); a member sharing any key with an earlier one is a dupe.
  const duplicateCount = useMemo(() => {
    const norm = (s?: string | null) => (s ?? '').toLowerCase().trim()
    const keyToCanonical = new Map<string, string>()
    let dupes = 0
    for (const m of members) {
      const candidates: string[] = []
      if (m.puuid) candidates.push(`puuid:${m.puuid}`)
      if (m.ign && m.tagLine) candidates.push(`riot:${norm(m.ign)}#${norm(m.tagLine)}`)
      if (m.ign) candidates.push(`ign:${norm(m.ign)}`)
      if (m.displayName) candidates.push(`name:${norm(m.displayName)}`)
      if (candidates.length === 0) continue
      const existingCanonical = candidates.map((c) => keyToCanonical.get(c)).find(Boolean)
      if (existingCanonical) dupes++
      for (const c of candidates) keyToCanonical.set(c, existingCanonical ?? candidates[0])
    }
    return dupes
  }, [members])
  const [dedupeRunning, setDedupeRunning] = useState(false)

  useEffect(() => {
    if (members.length > 0 && !selectedMemberId) setSelectedMemberId(members[0].id)
  }, [members, selectedMemberId])

  const reloadPool = useCallback((memberId: string) => {
    setPoolLoading(true)
    return window.api.listChampionPool(memberId)
      .then(setPool)
      .finally(() => setPoolLoading(false))
  }, [])

  useEffect(() => {
    if (!effectiveMemberId) {
      setPool([])
      return
    }
    let cancelled = false
    setPoolLoading(true)
    window.api.listChampionPool(effectiveMemberId)
      .then((res) => { if (!cancelled) setPool(res) })
      .finally(() => { if (!cancelled) setPoolLoading(false) })
    return () => { cancelled = true }
  }, [effectiveMemberId])

  // The selected player's pool in their role (off-role entries from a
  // multi-role scout stay in the database for the Draft Sim).
  const roleEntries = useMemo(() => pool.filter((p) => p.role === role), [pool, role])
  const groups = useMemo(() => groupByTier(roleEntries), [roleEntries])
  const summary = useMemo(() => summarizePool(roleEntries), [roleEntries])
  const entryOf = useCallback((championKey: string) => roleEntries.find((e) => e.championKey === championKey), [roleEntries])

  if (!team) {
    return <Card className="p-6 text-center text-hextech-text-dim">
      {t('team.pool.noTeam', { defaultValue: 'Create a team and add members first.' })}
    </Card>
  }
  if (members.length === 0) {
    return <Card className="p-6 text-center text-hextech-text-dim">
      {t('team.pool.noMembers', { defaultValue: 'Add at least one member to manage their pool.' })}
    </Card>
  }

  const countsOf = (m: TeamMember): string | null => {
    const r = roleOf(m)
    const entries = (m.id === effectiveMemberId ? pool : m.champPool ?? []).filter((e) => e.role === r)
    if (entries.length === 0) return null
    return countsLabel(tierCounts(entries)) || t('team.pool.board.champions', { count: entries.length })
  }

  const upsert = async (championKey: string, entryRole: string, tier: Tier) => {
    if (!effectiveMemberId) return
    try {
      const updated = await window.api.upsertChampionPool(effectiveMemberId, championKey, entryRole, { tier })
      setPool((prev) => {
        const key = `${championKey}|${entryRole}`
        const idx = prev.findIndex((p) => `${p.championKey}|${p.role}` === key)
        if (idx >= 0) return prev.map((p, i) => (i === idx ? updated : p))
        return [...prev, updated]
      })
      onChange?.()
    } catch (err) {
      toast({ title: t('team.pool.board.updateFailed'), description: (err as Error).message, variant: 'destructive' })
    }
  }

  const remove = async (entry: ChampionPoolEntry) => {
    try {
      await window.api.removeChampionPoolEntry(entry.id)
      setPool((prev) => prev.filter((p) => p.id !== entry.id))
      onChange?.()
    } catch (err) {
      toast({ title: t('team.pool.board.removeFailed'), description: (err as Error).message, variant: 'destructive' })
    }
  }

  const moveEntry = (entry: ChampionPoolEntry, tier: Tier) => {
    if (entry.tier !== tier) void upsert(entry.championKey, entry.role, tier)
  }
  const dropEntry = (entryId: string, tier: Tier) => {
    setDragId(null)
    const entry = pool.find((p) => p.id === entryId)
    if (entry) moveEntry(entry, tier)
  }

  const handleDedupe = async () => {
    if (dedupeRunning) return
    setDedupeRunning(true)
    try {
      const res = await window.api.dedupeTeamMembers(team.id)
      toast({ title: t('team.pool.dedupeDone', { defaultValue: 'Removed {{count}} duplicate(s)', count: res.removed }) })
      onChange?.()
    } catch (err) {
      console.error('[ChampPoolTab] dedupe failed', err)
      toast({
        title: t('team.pool.dedupeFailed', { defaultValue: 'Could not remove duplicates' }),
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setDedupeRunning(false)
    }
  }

  const refreshTargets = (mode: 'member' | 'team'): TeamMember[] =>
    mode === 'team' ? eligibleMembers : selectedMember && hasRiotId(selectedMember) ? [selectedMember] : []

  /** Opens the Quick/Complete scope picker; the fetch starts in runRefresh. */
  const openRefresh = (mode: 'member' | 'team') => {
    if (refreshTargets(mode).length === 0) {
      toast({
        title: t('team.pool.autoFillMissingInfo', { defaultValue: 'IGN, tag and region required' }),
        description: t('team.pool.autoFillMissingInfoDesc', { defaultValue: 'Edit the member in the Roster tab to add their Riot ID first.' }),
        variant: 'destructive',
      })
      return
    }
    setScopeFor(mode)
  }

  const runRefresh = async (scope: FetchScope) => {
    const mode = scopeFor ?? 'member'
    setScopeFor(null)
    const targets = refreshTargets(mode)
    if (targets.length === 0) return
    const skipped = mode === 'team' ? members.filter((m) => !hasRiotId(m)) : []
    await startAutoFillJob({
      label: t('team.pool.autoFillJobLabel', { defaultValue: 'Auto-fill — {{team}}', team: team.name }),
      members: targets,
      scope,
      onDone: ({ upserted, matches, cancelled, failed, rateLimited }) => {
        if (effectiveMemberId) void reloadPool(effectiveMemberId)
        onChange?.()
        if (cancelled) {
          toast({
            title: t('team.pool.autoFillCancelled', { defaultValue: 'Auto-fill cancelled' }),
            description: t('team.pool.autoFillCancelledDesc', { defaultValue: '{{upserted}} champions added before stopping.', upserted }),
          })
          return
        }
        if (mode === 'member' && failed.length === 0) {
          toast({
            title: t('team.pool.board.refreshDone', { name: targets[0].displayName }),
            description: t('team.pool.autoFillAllSummaryShort', { defaultValue: '{{upserted}} champions · {{matches}} games scanned', upserted, matches }),
          })
          return
        }
        if (failed.length === 0 && skipped.length === 0) {
          toast({
            title: t('team.pool.autoFillAllDone', { defaultValue: 'All {{count}} pools auto-filled', count: targets.length }),
            description: t('team.pool.autoFillAllSummaryShort', { defaultValue: '{{upserted}} champions · {{matches}} games scanned', upserted, matches }),
          })
        } else {
          toast({
            title: t('team.pool.autoFillPartial', {
              defaultValue: '{{ok}}/{{total}} pools auto-filled',
              ok: targets.length - failed.length,
              total: mode === 'team' ? members.length : 1,
            }),
            description: [
              rateLimited && riotErrorText(rateLimited, t),
              upserted > 0 && `${upserted} champions`,
              failed.length > 0 && `${failed.length} ✗ ${failed.slice(0, 2).join(', ')}${failed.length > 2 ? '…' : ''}`,
              skipped.length > 0 && t('team.pool.board.skippedNoRiotId', { count: skipped.length }),
            ].filter(Boolean).join(' · '),
            variant: failed.length > 0 ? 'destructive' : 'default',
          })
        }
      },
    })
  }

  const memberName = selectedMember?.displayName ?? ''
  const fetching = !!runningAutoFill
  const laneProps = {
    nameOf,
    latestPlay: summary.latestPlay,
    dragging: dragId != null,
    onDropEntry: dropEntry,
    onMove: moveEntry,
    onRemove: (e: ChampionPoolEntry) => { void remove(e) },
    onDragStart: (id: string) => setDragId(id),
    onDragEnd: () => setDragId(null),
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-5">
        <PlayerSelector
          members={members}
          selectedId={effectiveMemberId}
          onSelect={setSelectedMemberId}
          lookOf={(m) => lookForMember(m, lookSources)}
          countsOf={countsOf}
        />
        {selectedMember && <RenamedNote member={selectedMember} onCleared={() => onChange?.()} />}

        <PoolHeader
          title={t('team.pool.board.title', { role: t(`team.pool.board.role.${role}`), name: memberName })}
          summary={summary}
        >
          {duplicateCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDedupe}
              disabled={dedupeRunning}
              className="border-amber-500/50 text-amber-300 hover:bg-amber-500/10"
              title={t('team.pool.dedupeHint', { defaultValue: 'Merge members that share the same Riot ID. The oldest entry is kept, champion pools are merged.' })}
            >
              {dedupeRunning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
              {t('team.pool.removeDuplicates', { defaultValue: 'Remove {{count}} duplicate(s)', count: duplicateCount })}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('team.pool.board.addChampion')}
          </Button>
          {eligibleMembers.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              className="text-hextech-text hover:text-hextech-text-bright"
              onClick={() => openRefresh('team')}
              disabled={fetching}
              title={t('team.pool.autoFillAllHint', { defaultValue: 'Pulls mastery + full season match history from Riot.' })}
            >
              {t('team.pool.board.refreshTeam', { count: eligibleMembers.length })}
            </Button>
          )}
          <Button size="sm" onClick={() => openRefresh('member')} disabled={fetching}>
            {fetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            {runningAutoFill
              ? t('team.pool.autoFillProgress', {
                  defaultValue: 'Filling {{name}} ({{done}}/{{total}})…',
                  name: runningAutoFill.currentName ?? '…',
                  done: Math.min(runningAutoFill.done + 1, runningAutoFill.total),
                  total: runningAutoFill.total,
                })
              : t('team.pool.board.refresh')}
          </Button>
        </PoolHeader>

        <GamesDistribution summary={summary} nameOf={nameOf} />

        {poolLoading && roleEntries.length === 0 ? (
          <Card className="flex items-center justify-center gap-2 p-6 text-sm text-hextech-text-dim">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </Card>
        ) : (
          <>
            {OPEN_LANES.map((tier) => <TierLane key={tier} tier={tier} entries={groups[tier]} {...laneProps} />)}
            <LearningLane entries={groups.learning} {...laneProps} />
          </>
        )}

        <p className="text-[11px] text-hextech-text-dim">{t('team.pool.board.footnote')}</p>

        <ScopeDialog
          open={scopeFor != null}
          playerCount={scopeFor ? refreshTargets(scopeFor).length : 1}
          actionLabel={t('team.pool.autoFillScopeTitle', { defaultValue: 'How thorough should the auto-fill be?' })}
          onCancel={() => setScopeFor(null)}
          onConfirm={runRefresh}
        />
        <AddChampionDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          memberName={memberName}
          champions={champions}
          loading={champsLoading}
          entryOf={entryOf}
          onPick={(championKey, tier) => { void upsert(championKey, role, tier) }}
          onRemove={(entry) => { void remove(entry) }}
        />
      </div>
    </TooltipProvider>
  )
}
