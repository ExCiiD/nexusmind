import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { Plus, Trash2, RefreshCw, Loader2, UserPlus, Eye, Wand2, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import { compareByRole } from '@/lib/championRoles'
import type { Team, TeamMember, ChampionPoolEntry, TeamSynergyStats } from '@/lib/ipc'
import { BulkImportModal } from './BulkImportModal'
import { DashboardLayout } from './DashboardLayout'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'
import { ScopeDialog, scopeToMatchCount, type FetchScope } from '@/components/team/ScopeDialog'
import { useBackgroundJobsStore } from '@/store/useBackgroundJobsStore'

const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const

export function ScoutingTab() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [opponents, setOpponents] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  // Scope dialog state — discriminated by `kind` so a single dialog can
  // back both single-member scouting and team-wide scout-all flows.
  // `null` = closed. The `onConfirm` callback is built when the dialog
  // opens so it captures the right member / team in its closure.
  const [scopeRequest, setScopeRequest] = useState<
    | { kind: 'one'; member: TeamMember }
    | { kind: 'all'; team: Team }
    | null
  >(null)

  // Subscribe to global jobs so the row-level spinner reflects scouts in
  // progress even after the user navigates away and back. `currentName`
  // on a scoutAll job tells us which member is being processed RIGHT NOW.
  const scoutingMemberId = useBackgroundJobsStore(
    (s) => s.jobs.find((j) => j.kind === 'scoutAll' || j.kind === 'scoutOne')?.currentName ?? null,
  )
  // Lookup-by-displayName is fragile if names collide, but scoutingMemberId
  // is purely cosmetic (drives a spinner) and the team UI guarantees
  // unique display names per team. Worst case both rows spin briefly.
  const startScoutOneJob = useBackgroundJobsStore((s) => s.runScoutOne)
  const startScoutAllJob = useBackgroundJobsStore((s) => s.runScoutAll)

  const load = async () => {
    setLoading(true)
    try {
      const list = await window.api.listTeams({ isOpponent: true })
      setOpponents(list)
      if (!activeId && list.length > 0) setActiveId(list[0].id)
    } catch (err) {
      console.error('[ScoutingTab] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const team = await window.api.createTeam({ name: newName.trim(), isOpponent: true })
      setNewName('')
      setCreating(false)
      setActiveId(team.id)
      await load()
    } catch (err) {
      toast({ title: 'Failed to create opponent team', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this opponent team?')) return
    try {
      await window.api.deleteTeam(id)
      if (activeId === id) setActiveId(null)
      await load()
    } catch (err) {
      toast({ title: 'Failed to delete', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const activeTeam = opponents.find((o) => o.id === activeId) ?? null

  /** Opens the scope picker for a single member's scout. The actual API
   *  call runs in `runScoutOne` once the user picks Quick vs Complete. */
  const handleScout = (memberId: string) => {
    const team = opponents.find((o) => o.id === activeId)
    const member = team?.members?.find((m) => m.id === memberId)
    if (!member) return
    if (!member.ign || !member.tagLine || !member.region) {
      toast({
        title: t('team.scouting.noRiotId', { defaultValue: 'Missing Riot ID' }),
        description: t('team.scouting.noRiotIdDesc', { defaultValue: 'Add IGN, tag, and region before scouting.' }),
        variant: 'destructive',
      })
      return
    }
    setScopeRequest({ kind: 'one', member })
  }

  const runScoutOne = async (member: TeamMember, scope: FetchScope) => {
    await startScoutOneJob({
      label: t('team.scouting.scoutOneJobLabel', {
        defaultValue: 'Scout — {{name}}',
        name: member.displayName,
      }),
      member,
      scope,
      onDone: ({ upserted, cancelled }) => {
        if (cancelled) return
        toast({
          title: t('team.scouting.done', { defaultValue: 'Scouting complete' }),
          description: `${upserted} champion entries.`,
        })
        load()
      },
    })
  }

  /** Opens the scope picker for the whole team's scout. */
  const handleScoutAll = (team: Team) => {
    const eligible = (team.members ?? []).filter((m) => m.ign && m.tagLine && m.region)
    if (eligible.length === 0) {
      toast({
        title: t('team.scouting.noEligible', { defaultValue: 'No scoutable members' }),
        description: t('team.scouting.noEligibleDesc', {
          defaultValue: 'Each member needs IGN, tag line, and region before they can be scouted.',
        }),
        variant: 'destructive',
      })
      return
    }
    setScopeRequest({ kind: 'all', team })
  }

  const runScoutAll = async (team: Team, scope: FetchScope) => {
    const eligible = (team.members ?? []).filter((m) => m.ign && m.tagLine && m.region)
    const skipped = (team.members ?? []).length - eligible.length
    await startScoutAllJob({
      label: t('team.scouting.scoutAllJobLabel', {
        defaultValue: 'Scout — {{team}}',
        team: team.name,
      }),
      members: eligible,
      scope,
      onDone: ({ ok, upserted, cancelled, failed }) => {
        if (cancelled) {
          toast({
            title: t('team.scouting.scoutCancelled', { defaultValue: 'Scout cancelled' }),
            description: t('team.scouting.scoutCancelledDesc', {
              defaultValue: '{{ok}} member(s) scouted before stopping · {{upserted}} entries.',
              ok,
              upserted,
            }),
          })
          load()
          return
        }
        load()
        if (failed.length === 0) {
          toast({
            title: t('team.scouting.allDone', { defaultValue: 'Scouted all {{count}} members', count: ok }),
            description: t('team.scouting.allDoneDesc', {
              defaultValue: '{{champions}} champion entries · {{skipped}} skipped (missing Riot ID)',
              champions: upserted,
              skipped,
            }),
          })
        } else {
          toast({
            title: t('team.scouting.partial', { defaultValue: '{{ok}}/{{total}} scouted', ok, total: eligible.length }),
            description: t('team.scouting.partialDesc', {
              defaultValue: 'Failed: {{names}}',
              names: failed.join(', '),
            }),
            variant: 'destructive',
          })
        }
      },
    })
  }

  return (
    <div className="space-y-3">
      {/* Opponent team selector + create */}
      <Card className="p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-hextech-text-dim font-semibold">Opponents:</span>
        {opponents.length === 0 && !loading && (
          <span className="text-sm text-hextech-text-dim italic">
            {t('team.scouting.empty', { defaultValue: 'No opponent teams scouted yet.' })}
          </span>
        )}
        {opponents.map((team) => (
          <button
            key={team.id}
            onClick={() => setActiveId(team.id)}
            className={cn(
              'px-3 py-1 rounded-md text-sm font-medium transition-colors group flex items-center gap-1',
              team.id === activeId
                ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                : 'bg-white/5 text-hextech-text hover:bg-white/10',
            )}
          >
            <Eye className="h-3 w-3" />
            {team.name}
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(team.id) }}
              className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400 ml-1"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </button>
        ))}
        {creating ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                else if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              placeholder="Opponent team name…"
              className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-sm"
            />
            <Button size="sm" onClick={handleCreate}>Add</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-3 w-3 mr-1" />
            New opponent
          </Button>
        )}
      </Card>

      {activeTeam ? (
        <OpponentDetail
          team={activeTeam}
          onChange={load}
          scoutingMemberName={scoutingMemberId}
          onScout={handleScout}
          onScoutAll={() => handleScoutAll(activeTeam)}
        />
      ) : (
        <Card className="p-6 text-center text-hextech-text-dim">
          {t('team.scouting.selectPrompt', { defaultValue: 'Select or create an opponent team to start scouting.' })}
        </Card>
      )}

      {scopeRequest && (
        <ScopeDialog
          open
          playerCount={
            scopeRequest.kind === 'one'
              ? 1
              : (scopeRequest.team.members ?? []).filter((m) => m.ign && m.tagLine && m.region).length
          }
          actionLabel={
            scopeRequest.kind === 'one'
              ? t('team.scouting.scopeTitleOne', {
                  defaultValue: 'Scout {{name}} — how thorough?',
                  name: scopeRequest.member.displayName,
                })
              : t('team.scouting.scopeTitleAll', {
                  defaultValue: 'Scout all opponents — how thorough?',
                })
          }
          onCancel={() => setScopeRequest(null)}
          onConfirm={(scope) => {
            const req = scopeRequest
            setScopeRequest(null)
            if (req.kind === 'one') runScoutOne(req.member, scope)
            else runScoutAll(req.team, scope)
          }}
        />
      )}
    </div>
  )
}

function OpponentDetail({ team, onChange, scoutingMemberName, onScout, onScoutAll }: {
  team: Team
  onChange: () => void
  /** Display name of the member currently being scouted by ANY active
   *  background job. Used for row-level spinner. Null when nothing is
   *  running. */
  scoutingMemberName: string | null
  onScout: (memberId: string) => void
  onScoutAll: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [addingMember, setAddingMember] = useState(false)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [autoScoutAfterImport, setAutoScoutAfterImport] = useState(true)
  const [form, setForm] = useState({
    displayName: '', ign: '', tagLine: '', region: 'EUW1', role: 'TOP' as typeof ROLES[number],
  })

  const handleAdd = async () => {
    if (!form.displayName.trim()) return
    try {
      await window.api.addTeamMember(team.id, {
        displayName: form.displayName.trim(),
        ign: form.ign.trim() || undefined,
        tagLine: form.tagLine.trim() || undefined,
        region: form.region,
        role: form.role,
      })
      setAddingMember(false)
      setForm({ displayName: '', ign: '', tagLine: '', region: 'EUW1', role: 'TOP' })
      onChange()
    } catch (err) {
      toast({ title: 'Failed to add', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const handleRemove = async (memberId: string) => {
    if (!confirm('Remove this opponent member?')) return
    try {
      await window.api.removeTeamMember(memberId)
      onChange()
    } catch (err) {
      toast({ title: 'Failed to remove', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const members = team.members ?? []
  const byRole = ROLES.map((role) => ({
    role,
    member: members.find((m) => m.role === role),
  }))

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-hextech-text-bright">{team.name}</h3>
          {addingMember ? (
            <div className="flex items-center gap-1 flex-wrap">
              <input
                placeholder="Display"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs w-24"
              />
              <input
                placeholder="IGN"
                value={form.ign}
                onChange={(e) => setForm((f) => ({ ...f, ign: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs w-24"
              />
              <input
                placeholder="Tag"
                value={form.tagLine}
                onChange={(e) => setForm((f) => ({ ...f, tagLine: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs w-16"
              />
              <select
                value={form.region}
                onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-1 py-1 text-xs"
              >
                <option value="EUW1">EUW</option>
                <option value="EUN1">EUNE</option>
                <option value="NA1">NA</option>
                <option value="KR">KR</option>
                <option value="BR1">BR</option>
                <option value="LA1">LAN</option>
                <option value="LA2">LAS</option>
                <option value="OC1">OCE</option>
                <option value="TR1">TR</option>
                <option value="RU">RU</option>
                <option value="JP1">JP</option>
              </select>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as typeof ROLES[number] }))}
                className="bg-hextech-dark border border-hextech-border rounded px-1 py-1 text-xs"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <Button size="sm" onClick={handleAdd}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setAddingMember(false)}>Cancel</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[10px] text-hextech-text-dim cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScoutAfterImport}
                  onChange={(e) => setAutoScoutAfterImport(e.target.checked)}
                  className="accent-hextech-gold"
                />
                {t('team.scouting.autoScout', { defaultValue: 'Auto-scout on import' })}
              </label>
              <Button size="sm" variant="outline" onClick={() => setBulkImportOpen(true)}>
                <Wand2 className="h-3 w-3 mr-1" />
                {t('team.roster.bulkImport', { defaultValue: 'Import from multi-link' })}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAddingMember(true)}>
                <UserPlus className="h-3 w-3 mr-1" />Add member
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={onScoutAll}
                disabled={!!scoutingMemberName || members.length === 0}
                title={t('team.scouting.scoutAllHint', {
                  defaultValue: 'Re-fetch the full season match history (up to 500 games) for every opponent in parallel. ~15s on first scout, near-instant after.',
                })}
              >
                {scoutingMemberName
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <RefreshCw className="h-3 w-3 mr-1" />}
                {scoutingMemberName
                  ? t('team.scouting.scoutingMember', { defaultValue: 'Scouting…' })
                  : t('team.scouting.scoutAll', { defaultValue: 'Scout all ({{count}})', count: members.length })}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {byRole.map(({ role, member }) => (
            <div key={role} className="border border-hextech-border rounded p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-hextech-text-dim">{role}</span>
                {member && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => onScout(member.id)}
                      disabled={!!scoutingMemberName}
                      title="Scout: fetch the player's recent games"
                      className="text-hextech-gold hover:text-hextech-gold-bright disabled:opacity-30"
                    >
                      {scoutingMemberName === member.displayName ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={() => handleRemove(member.id)}
                      className="text-hextech-text-dim hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              {member ? (
                <>
                  <p className="text-xs font-semibold text-hextech-text-bright truncate">{member.displayName}</p>
                  {member.ign && (
                    <p className="text-[10px] text-hextech-text-dim truncate">
                      {member.ign}{member.tagLine ? `#${member.tagLine}` : ''}
                    </p>
                  )}
                  <MemberPoolPreview member={member} />
                </>
              ) : (
                <p className="text-[10px] text-hextech-text-dim italic text-center py-3">Empty</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <PanelErrorBoundary label="Opponent synergy">
        <OpponentSynergyPanel team={team} />
      </PanelErrorBoundary>

      <BulkImportModal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        defaultRegion="EUW1"
        title={t('team.scouting.importTitle', { defaultValue: 'Import opponents from multi-link' })}
        description={t('team.scouting.importDesc', {
          defaultValue: 'Paste an op.gg / blitz.gg multisearch URL — each player will be added to this opponent team and (optionally) auto-scouted.',
        })}
        onImport={async (p) => {
          const member = await window.api.addTeamMember(team.id, {
            displayName: p.gameName,
            ign: p.gameName,
            tagLine: p.tagLine || undefined,
            region: p.region,
            role: p.role,
          })
          // Auto-scout right after add (opponents are scouted by default —
          // that's the whole point of bulk-importing them).
          if (autoScoutAfterImport && p.tagLine) {
            try {
              await window.api.scoutMember(member.id, 100)
            } catch (err) {
              // Don't fail the import on a scout error — the member is added
              // and the user can retry the scout manually.
              console.warn('[ScoutingTab] Auto-scout failed for', p.gameName, err)
            }
          }
          onChange()
        }}
      />
    </div>
  )
}

function MemberPoolPreview({ member }: { member: TeamMember }) {
  const [pool, setPool] = useState<ChampionPoolEntry[]>([])

  useEffect(() => {
    let cancelled = false
    window.api.listChampionPool(member.id)
      .then((res) => { if (!cancelled) setPool(res) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [member.id])

  // IMPORTANT: this useMemo MUST run on every render, even when pool is
  // empty — otherwise we hit React error #310 ("Rendered more hooks than
  // during the previous render") because the early return below would
  // skip the hook on first render, then trigger it after pool loads.
  // Aggregate by championKey across ALL roles so the displayed game count
  // matches op.gg ("Aatrox 84 games") instead of just the assigned-role
  // subset ("Aatrox TOP 19 games").
  const aggregated = useMemo(() => {
    const byChamp = new Map<string, { championKey: string; games: number; wins: number; primaryRole: string; primaryGames: number }>()
    for (const e of pool) {
      const games = e.playRate ?? 0
      const wins = e.winRate != null ? Math.round((e.winRate / 100) * games) : 0
      const cur = byChamp.get(e.championKey)
      if (cur) {
        cur.games += games
        cur.wins += wins
        if (games > cur.primaryGames) {
          cur.primaryGames = games
          cur.primaryRole = e.role
        }
      } else {
        byChamp.set(e.championKey, {
          championKey: e.championKey,
          games,
          wins,
          primaryRole: e.role,
          primaryGames: games,
        })
      }
    }
    return Array.from(byChamp.values())
      .sort((a, b) => b.games - a.games)
      .slice(0, 5)
  }, [pool])

  if (pool.length === 0) {
    return <p className="text-[9px] text-hextech-text-dim italic mt-1">No data — click ⟳ to scout</p>
  }

  return (
    <div className="space-y-0.5 mt-1">
      <p className="text-[9px] uppercase tracking-wider text-hextech-text-dim">Top {aggregated.length}:</p>
      <div className="flex gap-0.5 flex-wrap">
        {aggregated.map((e) => (
          <TinyChampIcon
            key={e.championKey}
            championKey={e.championKey}
            count={e.games}
            wins={e.wins}
            role={e.primaryRole}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Synergy-stats panel for an opponent team — mirrors the StatsFlexTab from
 * the active-team view, but applied to opponents.
 *
 * Aggregates flex queue games where ≥minTogether opponent members played
 * on the same side (`team:compute-synergy-stats` works on any team ID, no
 * dedicated opponent handler needed). Real synergy data — no approximation
 * disclaimer required. The per-champion winrates the user actually scouts
 * still come from each member's individual season pool (`scoutMember` +
 * MemberPoolPreview above), which keeps the cheap-to-compute SoloQ-only
 * data for that.
 *
 * Cached per (team, minTogether) like StatsFlexTab so toggling the filter
 * doesn't re-hit Riot.
 */
function OpponentSynergyPanel({ team }: { team: Team }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [stats, setStats] = useState<TeamSynergyStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [minTogether, setMinTogether] = useState(3)

  const cacheKey = `nexusmind:opponentSynergy:${team.id}`
  const loadCachedFor = (n: number): TeamSynergyStats | null => {
    try {
      const raw = localStorage.getItem(cacheKey)
      if (!raw) return null
      const map = JSON.parse(raw) as Record<string, TeamSynergyStats>
      return map[String(n)] ?? null
    } catch { return null }
  }
  const saveCachedFor = (n: number, s: TeamSynergyStats) => {
    try {
      const raw = localStorage.getItem(cacheKey)
      const map = raw ? (JSON.parse(raw) as Record<string, TeamSynergyStats>) : {}
      map[String(n)] = s
      localStorage.setItem(cacheKey, JSON.stringify(map))
    } catch { /* quota */ }
  }

  // Hydrate from cache on team change OR when the user toggles minTogether.
  // Showing stale data immediately + a "refresh to update" hint is better
  // UX than a blank screen during the long Riot fetch.
  useEffect(() => {
    const cached = loadCachedFor(minTogether)
    setStats(cached)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id, minTogether])

  const handleRefresh = async () => {
    setLoading(true)
    try {
      const res = await window.api.computeTeamSynergyStats(team.id, { minTogether })
      setStats(res)
      saveCachedFor(minTogether, res)
      if (res.matchCount === 0) {
        toast({
          title: t('team.scouting.synergy.noGames', { defaultValue: 'No synergy games found' }),
          description: t('team.scouting.synergy.noGamesDesc', {
            defaultValue: 'No recent flex games where ≥{{n}} of these opponents played together.',
            n: minTogether,
          }),
        })
      } else {
        toast({
          title: t('team.scouting.synergy.done', { defaultValue: 'Opponent synergy ready' }),
          description: t('team.scouting.synergy.doneDesc', {
            defaultValue: '{{matches}} flex games · {{members}} players with data',
            matches: res.matchCount,
            members: res.membersWithGames,
          }),
        })
      }
    } catch (err) {
      toast({
        title: t('team.scouting.synergy.failed', { defaultValue: 'Opponent synergy failed' }),
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const sortedPlayers = useMemo(() => stats ? [...stats.players].sort(compareByRole) : [], [stats])
  const membersWithIds = (team.members ?? []).filter((m) => m.ign && m.tagLine && m.region).length

  return (
    <div className="space-y-3">
      <Card className="p-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-hextech-gold" />
          <span className="text-sm text-hextech-text">
            {t('team.scouting.synergy.title', {
              defaultValue: 'Opponent synergy — flex games where ≥{{n}} of them played together',
              n: minTogether,
            })}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-hextech-text-dim">
            {t('team.scouting.synergy.minTogether', { defaultValue: 'Min together:' })}
            <select
              value={minTogether}
              onChange={(e) => setMinTogether(Number(e.target.value))}
              disabled={loading}
              className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs"
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </label>

          {stats && (
            <span className="text-[10px] text-hextech-text-dim italic">
              {t('team.scouting.synergy.lastUpdate', { defaultValue: 'Updated' })}: {new Date(stats.fetchedAt).toLocaleTimeString()}
            </span>
          )}
          <Button
            size="sm"
            onClick={handleRefresh}
            disabled={loading || membersWithIds < minTogether}
            title={membersWithIds < minTogether
              ? `Need ${minTogether} members with Riot IDs (have ${membersWithIds})`
              : undefined}
          >
            {loading
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            {loading
              ? t('team.scouting.synergy.computing', { defaultValue: 'Computing…' })
              : stats
                ? t('team.scouting.synergy.refresh', { defaultValue: 'Refresh' })
                : t('team.scouting.synergy.compute', { defaultValue: 'Compute synergy' })}
          </Button>
        </div>
      </Card>

      {!stats && !loading && (
        <Card className="p-6 text-center text-hextech-text-dim">
          <BarChart3 className="h-8 w-8 mx-auto opacity-40" />
          <p className="mt-3 text-sm">
            {t('team.scouting.synergy.emptyHint', {
              defaultValue: 'Click "Compute synergy" to find flex games where these opponents have queued together.',
            })}
          </p>
          <p className="mt-1 text-[10px] text-hextech-text-dim/70">
            {t('team.scouting.synergy.cacheHint', {
              defaultValue: 'First run can be slow; results are cached locally for next time.',
            })}
          </p>
        </Card>
      )}

      {loading && !stats && (
        <Card className="p-6 text-center text-hextech-text-dim">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-hextech-gold" />
          <p className="mt-3 text-sm">
            {t('team.scouting.synergy.computingDesc', {
              defaultValue: 'Fetching flex games for every opponent — usually ~10s.',
            })}
          </p>
        </Card>
      )}

      {stats && stats.matchCount > 0 && (
        <DashboardLayout
          players={sortedPlayers}
          matchCount={stats.matchCount}
          basedOnLabel={t('team.scouting.synergy.basedOn', {
            defaultValue: 'Real flex stats from {{n}} games where ≥{{min}} opponents played together',
            n: stats.matchCount,
            min: minTogether,
          })}
        />
      )}

      {stats && stats.matchCount === 0 && (
        <Card className="p-6 text-center text-hextech-text-dim">
          {t('team.scouting.synergy.noGamesDesc', {
            defaultValue: 'No recent flex games where ≥{{n}} of these opponents played together.',
            n: minTogether,
          })}
        </Card>
      )}
    </div>
  )
}

function TinyChampIcon({ championKey, count, wins, role }: {
  championKey: string
  count: number
  wins?: number
  role?: string
}) {
  const iconUrl = useChampionIconUrl(championKey)
  const wr = wins != null && count > 0 ? Math.round((wins / count) * 100) : null
  const wrColor = wr == null ? '' : wr >= 60 ? 'text-emerald-300' : wr >= 50 ? 'text-yellow-200' : 'text-red-300'
  return (
    <div
      className="relative"
      title={`${championKey} — ${count} games${wr != null ? ` (${wr}% WR)` : ''}${role ? ` · ${role}` : ''}`}
    >
      {iconUrl && <img src={iconUrl} alt={championKey} className="h-7 w-7 rounded" />}
      {/* Game count pinned bottom-right, slightly larger so it actually
          reads at scouting distance. */}
      <span className="absolute -bottom-0.5 -right-0.5 text-[9px] bg-black/85 text-hextech-gold px-0.5 rounded font-mono leading-tight">
        {count}
      </span>
      {/* WR pinned top-right, colored by performance. Only shown when we
          have win data — saves visual noise for manually-added entries. */}
      {wr != null && (
        <span className={cn('absolute -top-0.5 -right-0.5 text-[8px] bg-black/85 px-0.5 rounded font-mono leading-tight font-bold', wrColor)}>
          {wr}
        </span>
      )}
    </div>
  )
}
