import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { Search, X, Trash2, Wand2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAllChampions } from '@/hooks/useAllChampions'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import type { Team, ChampionPoolEntry } from '@/lib/ipc'
import { compareByRole } from '@/lib/championRoles'

const TIERS = ['main', 'comfort', 'flex', 'learning'] as const
type Tier = (typeof TIERS)[number]

// Tier visual identity — used for both compact pills and the hover picker.
const TIER_COLORS: Record<Tier, { bg: string; border: string; text: string; ring: string; glow: string }> = {
  main:     { bg: 'bg-emerald-500/20', border: 'border-emerald-500', text: 'text-emerald-300', ring: 'ring-emerald-500/50', glow: 'shadow-emerald-500/40' },
  comfort:  { bg: 'bg-blue-500/20',    border: 'border-blue-500',    text: 'text-blue-300',    ring: 'ring-blue-500/50',    glow: 'shadow-blue-500/40' },
  flex:     { bg: 'bg-yellow-500/20',  border: 'border-yellow-500',  text: 'text-yellow-300',  ring: 'ring-yellow-500/50',  glow: 'shadow-yellow-500/40' },
  learning: { bg: 'bg-zinc-500/20',    border: 'border-zinc-500',    text: 'text-zinc-300',    ring: 'ring-zinc-500/50',    glow: 'shadow-zinc-500/40' },
}

interface Props {
  team: Team | null
  /** Called when team membership changes (dedup) — parent should re-fetch */
  onChange?: () => void
}

export function ChampPoolTab({ team, onChange }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { champions, loading: champsLoading } = useAllChampions()
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [pool, setPool] = useState<ChampionPoolEntry[]>([])
  const [poolLoading, setPoolLoading] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)
  // Progress label shown on the button while auto-filling the whole team
  // (sequential to respect Riot rate limits).
  const [autoFillProgress, setAutoFillProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [showPickedOnly, setShowPickedOnly] = useState(false)
  // Currently-open tier picker (click a champion to open, click again or
  // click outside / press Escape to close).
  const [openChampKey, setOpenChampKey] = useState<string | null>(null)

  // Display members in natural lane order (TOP → JGL → MID → ADC → SUP).
  // Sorted with `useMemo` so React doesn't re-create the array each render,
  // which would churn `selectedMember` lookups and effect deps below.
  const members = useMemo(
    () => [...(team?.members ?? [])].sort(compareByRole),
    [team?.members],
  )
  const selectedMember = members.find((m) => m.id === selectedMemberId) ?? members[0]
  const effectiveMemberId = selectedMember?.id ?? null

  // Duplicate detection — group members using progressively looser rules so we
  // catch the common cases:
  //   1. Exact same puuid (Riot canonical ID)
  //   2. Same ign+tagLine (case-insensitive)
  //   3. Same ign alone (one side might be missing the tag)
  //   4. Same displayName (last resort — covers manually-typed dupes)
  // We pick the FIRST matching key so a member that has both puuid AND ign
  // can still group with an older entry that only had ign.
  const duplicateCount = useMemo(() => {
    // Build all candidate keys for each member, then union-find by hashing
    // through a chain of maps. Simpler: iterate twice — first pass assigns
    // each member to a canonical key it shares with any earlier member.
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
      const canonical = existingCanonical ?? candidates[0]
      if (existingCanonical) dupes++ // this member is a dupe of an earlier one
      for (const c of candidates) keyToCanonical.set(c, canonical)
    }
    return dupes
  }, [members])
  const [dedupeRunning, setDedupeRunning] = useState(false)
  const handleDedupe = async () => {
    if (!team || dedupeRunning) return
    setDedupeRunning(true)
    try {
      const res = await window.api.dedupeTeamMembers(team.id)
      toast({
        title: t('team.pool.dedupeDone', { defaultValue: 'Removed {{count}} duplicate(s)', count: res.removed }),
      })
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

  useEffect(() => {
    if (members.length > 0 && !selectedMemberId) {
      setSelectedMemberId(members[0].id)
    }
  }, [members, selectedMemberId])

  // Close the tier picker on Escape — feels natural and avoids trapping the
  // user when they want to bail without clicking outside the popup.
  useEffect(() => {
    if (!openChampKey) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenChampKey(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openChampKey])

  const reloadPool = (memberId: string) => {
    setPoolLoading(true)
    return window.api.listChampionPool(memberId)
      .then(setPool)
      .finally(() => setPoolLoading(false))
  }

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

  const filteredChampions = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = champions
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q))
    if (showPickedOnly) {
      const inPool = new Set(pool.map((p) => p.championKey))
      list = list.filter((c) => inPool.has(c.key))
    }
    return list
  }, [champions, search, showPickedOnly, pool])

  const poolByChampRole = useMemo(() => {
    const m = new Map<string, ChampionPoolEntry>()
    for (const e of pool) m.set(`${e.championKey}|${e.role}`, e)
    return m
  }, [pool])

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

  const upsert = async (championKey: string, role: string, tier: Tier) => {
    if (!effectiveMemberId) return
    try {
      const updated = await window.api.upsertChampionPool(effectiveMemberId, championKey, role, { tier })
      setPool((prev) => {
        const key = `${championKey}|${role}`
        const idx = prev.findIndex((p) => `${p.championKey}|${p.role}` === key)
        if (idx >= 0) return prev.map((p, i) => i === idx ? updated : p)
        return [...prev, updated]
      })
    } catch (err) {
      toast({ title: 'Failed to update pool', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const remove = async (entry: ChampionPoolEntry) => {
    try {
      await window.api.removeChampionPoolEntry(entry.id)
      setPool((prev) => prev.filter((p) => p.id !== entry.id))
    } catch (err) {
      toast({ title: 'Failed to remove', description: (err as Error).message, variant: 'destructive' })
    }
  }

  /**
   * Auto-fills the pool for EVERY member of the team in sequence. Sequential
   * because:
   *   - Riot API rate limits don't appreciate 5 parallel mastery+match-list
   *     calls
   *   - Progress UI is more useful when we know exactly who's being processed
   *
   * Per-member failures (missing IGN, expired key, etc.) don't abort the
   * whole run — they're collected and reported in the final toast so you can
   * fix and retry just those.
   */
  const handleAutoFill = async () => {
    if (members.length === 0) return

    // Pre-filter to members with the data we need. Members without Riot ID
    // can't be auto-filled — they're reported as skipped but don't break the
    // run.
    const eligible = members.filter((m) => m.ign && m.tagLine && m.region)
    const skipped = members.filter((m) => !m.ign || !m.tagLine || !m.region)

    if (eligible.length === 0) {
      toast({
        title: t('team.pool.autoFillMissingInfo', { defaultValue: 'IGN, tag and region required' }),
        description: t('team.pool.autoFillMissingInfoDesc', { defaultValue: 'Edit the member in the Roster tab to add their Riot ID first.' }),
        variant: 'destructive',
      })
      return
    }

    setAutoFilling(true)
    setAutoFillProgress({ done: 0, total: eligible.length, current: eligible[0].displayName })

    let totalUpserted = 0
    let totalMatches = 0
    let totalMasteries = 0
    const failures: { name: string; reason: string }[] = []

    for (let i = 0; i < eligible.length; i++) {
      const m = eligible[i]
      setAutoFillProgress({ done: i, total: eligible.length, current: m.displayName })
      try {
        const res = await window.api.autoFillPool(m.id, {
          matchCount: 30,
          masteryCount: 20,
          roleOnly: true,
        })
        totalUpserted += res.upserted
        totalMatches += res.matchesUsed
        totalMasteries += res.masteriesUsed
      } catch (err) {
        failures.push({ name: m.displayName, reason: (err as Error).message })
      }
    }

    setAutoFillProgress(null)
    setAutoFilling(false)

    // Refresh the currently-displayed member's pool view
    if (effectiveMemberId) await reloadPool(effectiveMemberId)

    // Build a summary toast — counts are aggregated across all members.
    if (failures.length === 0 && skipped.length === 0) {
      toast({
        title: t('team.pool.autoFillAllDone', { defaultValue: 'All {{count}} pools auto-filled', count: eligible.length }),
        description: t('team.pool.autoFillAllSummary', {
          defaultValue: '{{upserted}} champions total · {{matches}} games · {{mastery}} masteries scanned',
          upserted: totalUpserted,
          matches: totalMatches,
          mastery: totalMasteries,
        }),
      })
    } else {
      const okCount = eligible.length - failures.length
      toast({
        title: t('team.pool.autoFillPartial', {
          defaultValue: '{{ok}}/{{total}} pools auto-filled',
          ok: okCount,
          total: members.length,
        }),
        description: [
          totalUpserted > 0 && `${totalUpserted} champions added`,
          failures.length > 0 && `${failures.length} failed: ${failures.slice(0, 2).map((f) => f.name).join(', ')}${failures.length > 2 ? '…' : ''}`,
          skipped.length > 0 && `${skipped.length} skipped (no Riot ID): ${skipped.slice(0, 2).map((m) => m.displayName).join(', ')}${skipped.length > 2 ? '…' : ''}`,
        ].filter(Boolean).join(' · '),
        variant: failures.length > 0 ? 'destructive' : 'default',
      })
    }
  }

  const targetRole = roleFilter === 'ALL' ? (selectedMember?.role ?? 'MID') : roleFilter

  return (
    <div className="space-y-3">
      {/* Member + role selector + auto-fill */}
      <Card className="p-3 flex items-center gap-3 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-hextech-text-dim font-semibold">
          {t('team.pool.player', { defaultValue: 'Player' })}:
        </span>
        <select
          value={effectiveMemberId ?? ''}
          onChange={(e) => setSelectedMemberId(e.target.value)}
          className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-sm"
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName} ({m.role})</option>
          ))}
        </select>

        <span className="text-xs uppercase tracking-wider text-hextech-text-dim font-semibold ml-2">
          {t('team.pool.assignTo', { defaultValue: 'Assign to role' })}:
        </span>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-sm"
          title={t('team.pool.assignToHint', { defaultValue: "Which role to assign when clicking a champion. Defaults to the member's primary role." })}
        >
          <option value="ALL">{selectedMember?.role ?? 'MID'} (default)</option>
          <option value="TOP">Top</option>
          <option value="JUNGLE">Jungle</option>
          <option value="MID">Mid</option>
          <option value="ADC">ADC</option>
          <option value="SUPPORT">Support</option>
        </select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-hextech-text-dim" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('team.pool.searchPlaceholder', { defaultValue: 'Search champion to add manually…' })}
            className="w-full bg-hextech-dark border border-hextech-border rounded pl-7 pr-2 py-1 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-hextech-text-dim hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-hextech-text-dim cursor-pointer">
          <input
            type="checkbox"
            checked={showPickedOnly}
            onChange={(e) => setShowPickedOnly(e.target.checked)}
            className="accent-hextech-gold"
          />
          {t('team.pool.showPicked', { defaultValue: 'Pool only' })}
        </label>

        {duplicateCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleDedupe}
            disabled={dedupeRunning}
            className="border-amber-500/50 text-amber-300 hover:bg-amber-500/10"
            title={t('team.pool.dedupeHint', {
              defaultValue: 'Merge members that share the same Riot ID. The oldest entry is kept, champion pools are merged.',
            })}
          >
            {dedupeRunning
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            {t('team.pool.removeDuplicates', { defaultValue: 'Remove {{count}} duplicate(s)', count: duplicateCount })}
          </Button>
        )}

        <Button
          size="sm"
          variant="default"
          onClick={handleAutoFill}
          disabled={autoFilling || members.length === 0}
          title={t('team.pool.autoFillAllHint', {
            defaultValue: 'Pulls mastery + last 30 games from Riot for EVERY member of the team, filtered to their assigned role',
          })}
        >
          {autoFilling
            ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
          {autoFillProgress
            ? t('team.pool.autoFillProgress', {
                defaultValue: 'Filling {{name}} ({{done}}/{{total}})…',
                name: autoFillProgress.current,
                done: autoFillProgress.done + 1,
                total: autoFillProgress.total,
              })
            : t('team.pool.autoFillAll', { defaultValue: 'Auto-fill all members ({{count}})', count: members.length })}
        </Button>
      </Card>

      {/* Tier legend — gives at-a-glance meaning to the colored borders */}
      <div className="flex items-center gap-2 text-[10px] text-hextech-text-dim px-1">
        <span className="uppercase tracking-wider font-semibold">{t('team.pool.legend', { defaultValue: 'Tiers' })}:</span>
        {TIERS.map((tier) => (
          <span key={tier} className={cn('px-2 py-0.5 rounded border', TIER_COLORS[tier].bg, TIER_COLORS[tier].border, TIER_COLORS[tier].text, 'font-semibold uppercase')}>
            {tier}
          </span>
        ))}
        <span className="ml-auto italic">
          {t('team.pool.clickHint', { defaultValue: 'Click a champion to assign a tier · Esc to close' })}
        </span>
      </div>

      {/* Main layout: champion grid takes most space, pool sidebar is sticky */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-3">
        {/* Champion grid */}
        <Card className="p-3 max-h-[78vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-hextech-text-dim">
              {t('team.pool.allChampions', { defaultValue: 'All champions' })}
              <span className="ml-2 text-hextech-text-dim/60">({filteredChampions.length})</span>
            </h3>
          </div>
          {champsLoading && <p className="text-sm text-hextech-text-dim italic">Loading champions…</p>}
          {/* Wider min track + larger gap so individual cards have breathing room */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(86px,1fr))] gap-2.5">
            {filteredChampions.map((c) => {
              const existing = poolByChampRole.get(`${c.key}|${targetRole}`)
              return (
                <ChampionCard
                  key={c.key}
                  champion={c}
                  existing={existing}
                  isOpen={openChampKey === c.key}
                  onToggle={() => setOpenChampKey((prev) => prev === c.key ? null : c.key)}
                  onSetTier={(tier) => { upsert(c.key, targetRole, tier); setOpenChampKey(null) }}
                  onRemove={() => { if (existing) remove(existing); setOpenChampKey(null) }}
                />
              )
            })}
          </div>
        </Card>

        {/* Selected pool by tier */}
        <Card className="p-3 max-h-[78vh] overflow-y-auto space-y-3 xl:sticky xl:top-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-hextech-text-dim">
              {t('team.pool.poolTitle', { defaultValue: 'Pool' })} ({pool.length})
            </h3>
            {poolLoading && <Loader2 className="h-3 w-3 animate-spin text-hextech-text-dim" />}
          </div>

          {pool.length === 0 && !poolLoading && (
            <div className="text-xs text-hextech-text-dim italic text-center py-4 space-y-2">
              <p>{t('team.pool.emptyHint', { defaultValue: 'No champions yet. Use Auto-fill or click any champion on the left.' })}</p>
            </div>
          )}

          {TIERS.map((tier) => {
            const tierEntries = pool.filter((p) => p.tier === tier)
            return (
              <div key={tier}>
                <div className={cn(
                  'px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between',
                  TIER_COLORS[tier].bg, TIER_COLORS[tier].border, TIER_COLORS[tier].text,
                )}>
                  <span>{tier}</span>
                  <span className="opacity-70">({tierEntries.length})</span>
                </div>
                {tierEntries.length === 0 ? (
                  <p className="text-[10px] text-hextech-text-dim italic px-2">{t('team.pool.empty', { defaultValue: 'Empty' })}</p>
                ) : (
                  <div className="space-y-1">
                    {tierEntries.map((e) => (
                      <PoolRow key={e.id} entry={e} onRemove={() => remove(e)} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      </div>
    </div>
  )
}

function ChampionCard({
  champion, existing, isOpen, onToggle, onSetTier, onRemove,
}: {
  champion: { key: string; name: string }
  existing?: ChampionPoolEntry
  isOpen: boolean
  onToggle: () => void
  onSetTier: (tier: Tier) => void
  onRemove: () => void
}) {
  const iconUrl = useChampionIconUrl(champion.key)
  const tier = existing?.tier as Tier | undefined
  const colors = tier ? TIER_COLORS[tier] : null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'relative w-full aspect-square rounded-md border-2 overflow-hidden bg-black/30 transition-all hover:border-hextech-gold/50 hover:scale-[1.04]',
          colors ? colors.border : 'border-transparent',
          colors && `shadow-md ${colors.glow}`,
          isOpen && 'ring-2 ring-hextech-gold ring-offset-1 ring-offset-hextech-dark',
        )}
        title={`${champion.name}${tier ? ` (${tier})` : ''}`}
      >
        {iconUrl && <img src={iconUrl} alt={champion.name} className="w-full h-full object-cover pointer-events-none" />}

        {/* Tier badge in the corner when assigned — confirms current tier at a glance */}
        {tier && (
          <span className={cn(
            'absolute top-0.5 right-0.5 px-1 py-px rounded text-[8px] font-bold uppercase tracking-wider leading-tight',
            colors!.bg, colors!.text, 'backdrop-blur-sm border', colors!.border,
          )}>
            {tier[0].toUpperCase()}
          </span>
        )}

        {/* Stats overlay (mastery/play count) on top-left for auto-filled entries */}
        {existing && (existing.playRate || existing.winRate !== null) && (
          <span className="absolute bottom-0 left-0 right-0 px-1 py-px bg-black/70 text-[8px] text-white/80 leading-tight flex justify-between">
            {existing.playRate ? <span>{existing.playRate}g</span> : <span />}
            {existing.winRate !== null && existing.winRate !== undefined ? <span>{existing.winRate}%</span> : null}
          </span>
        )}
      </button>
      <p className="text-[10px] text-center text-hextech-text mt-0.5 truncate font-medium">{champion.name}</p>

      {/* Tier picker — opens on click. Renders below the card and is wrapped
          in a full-screen invisible backdrop that closes on outside click. */}
      {isOpen && (
        <>
          {/* Click-outside backdrop. Pointer events catch any click that
              doesn't hit the popup itself. Stop propagation on the inner
              container so clicks inside don't bubble to this layer. */}
          <div className="fixed inset-0 z-30" onClick={onToggle} />
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-40"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-hextech-dark rounded-md shadow-2xl border border-hextech-gold/40 flex flex-col gap-px p-1 min-w-[120px]">
              {TIERS.map((tname) => {
                const isActive = tier === tname
                const c = TIER_COLORS[tname]
                return (
                  <button
                    key={tname}
                    onClick={() => onSetTier(tname)}
                    className={cn(
                      'px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded transition-all text-left flex items-center gap-1.5',
                      isActive
                        ? cn(c.bg, c.text, 'border', c.border)
                        : 'text-hextech-text-dim hover:bg-white/10 hover:text-white border border-transparent',
                    )}
                    title={`Set tier: ${tname}`}
                  >
                    <span className={cn('h-2 w-2 rounded-full', c.bg.replace('/20', ''))} />
                    {tname}
                  </button>
                )
              })}
              {tier && (
                <button
                  onClick={onRemove}
                  className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded transition-all text-left flex items-center gap-1.5 text-red-300 hover:bg-red-500/20 border border-transparent mt-1"
                  title="Remove from pool"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function PoolRow({ entry, onRemove }: { entry: ChampionPoolEntry; onRemove: () => void }) {
  const iconUrl = useChampionIconUrl(entry.championKey)
  return (
    <div className="flex items-center gap-2 bg-white/5 rounded px-2 py-1 group hover:bg-white/10 transition-colors">
      {iconUrl && <img src={iconUrl} alt={entry.championKey} className="h-7 w-7 rounded" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-hextech-text-bright truncate">{entry.championKey}</p>
        <p className="text-[10px] text-hextech-text-dim">
          {entry.role}
          {entry.playRate !== null && entry.playRate !== undefined && ` · ${entry.playRate}g`}
          {entry.winRate !== null && entry.winRate !== undefined && ` · ${entry.winRate}% WR`}
        </p>
      </div>
      <button onClick={onRemove} className="opacity-0 group-hover:opacity-100 text-hextech-text-dim hover:text-red-400 transition-all">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}
