import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { Save, Copy, Plus, Trash2, Search, X, Ban, Users, Target, ChevronRight, AlertTriangle, Flame, Crown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAllChampions, type ChampionMeta } from '@/hooks/useAllChampions'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import type { DraftPrep, Team, TeamMember, ChampionPoolEntry } from '@/lib/ipc'
import { championPlaysRole, getChampionRoles, ROLES, ROLE_LABEL_SHORT, type Role } from '@/lib/championRoles'

// ──────────────────────────────────────────────────────────────────────────
// Threat analysis — surfaces "dangerous" opponent picks in the draft grid
// and pool sidebar. Computed entirely from cached pool entries (no extra
// Riot calls) so it updates instantly when the user switches opponent or
// re-scouts.
//
//   RED    : 100+ games on this champion AND it's the member's most-played
//            champion this season → unmistakable comfort pick, expect it.
//   ORANGE : 300k+ mastery points  → long-term comfort pick even if recent
//            play count is low (think otp's who main-swapped).
//   YELLOW : 2+ different members have this champion in their pool → flex
//            threat; the opponent can dodge target bans by giving it to
//            another teammate.
//
// Priority is RED > ORANGE > YELLOW when a champion qualifies for several.
// ──────────────────────────────────────────────────────────────────────────

export type ThreatLevel = 'red' | 'orange' | 'yellow'

/** Threat assessment for a champion played by a *specific* member.
 *  `null` = no threat. */
interface MemberThreat {
  level: 'red' | 'orange' | null
  // Human-readable reason shown in tooltips (e.g. "120 games · main pick").
  reason: string
}

/** Threat assessment for a champion across an entire team. Combines the
 *  per-member highest threat with the team-level flex (yellow) check. */
interface ChampionThreat {
  level: ThreatLevel
  reason: string
  /** Names of every member who plays this champion in the team's pool. */
  members: string[]
}

const MASTERY_ORANGE_THRESHOLD = 300_000
// Two ways a champion qualifies as "red threat" — either reached works:
//   1. Absolute   : 100+ games on it (the user's original spec — only
//                   reachable in "Complete" scope, where we can see the
//                   full season count).
//   2. Relative   : it's clearly the dominant pick — most-played in role
//                   AND accounts for >=25% of the player's role games AND
//                   has at least MIN_DOMINANT_GAMES games to avoid red
//                   firing on a 2-game sample. Works in "Quick" scope.
// The relative rule was added after testing showed Quick-scoped scouts
// (100 games total) could never reach 100+ on a single champion — so red
// never lit up even on clear one-tricks.
const GAMES_RED_ABSOLUTE = 100
const DOMINANT_SHARE_THRESHOLD = 0.25
const MIN_DOMINANT_GAMES = 10

/**
 * Per-member threat lookup. Pre-computes each member's #1 most-played
 * champion per role so the red-tier check ("dominant pick") is O(1) at
 * render time. Independent of which other opponents exist — used by the
 * sidebar's per-member icons.
 */
function buildMemberThreatMap(member: TeamMember): Map<string, MemberThreat> {
  const out = new Map<string, MemberThreat>()
  const pool = member.champPool ?? []
  if (pool.length === 0) return out

  // Identify the most-played champion per role + total games per role.
  // Mastery-only entries (playRate = 0) can't be the "dominant pick" —
  // that distinction is about recent activity, not lifetime points.
  const topByRole = new Map<string, { championKey: string; playRate: number }>()
  const totalByRole = new Map<string, number>()
  for (const e of pool) {
    const games = e.playRate ?? 0
    if (games <= 0) continue
    totalByRole.set(e.role, (totalByRole.get(e.role) ?? 0) + games)
    const cur = topByRole.get(e.role)
    if (!cur || games > cur.playRate) topByRole.set(e.role, { championKey: e.championKey, playRate: games })
  }

  for (const e of pool) {
    const games = e.playRate ?? 0
    const mastery = e.masteryPoints ?? 0
    const top = topByRole.get(e.role)
    const isDominant = top?.championKey === e.championKey
    const totalInRole = totalByRole.get(e.role) ?? 0
    const share = totalInRole > 0 ? games / totalInRole : 0

    // Red: absolute (100+ games) OR relative dominance (top of role +
    // meaningful sample + >=25% of role games). Both signals matter:
    // absolute catches one-tricks, relative catches "this is THE comfort
    // pick" even with a smaller scouted sample.
    const isRedAbsolute = games >= GAMES_RED_ABSOLUTE
    const isRedRelative = isDominant && games >= MIN_DOMINANT_GAMES && share >= DOMINANT_SHARE_THRESHOLD

    if (isRedAbsolute || isRedRelative) {
      const reason = isRedAbsolute
        ? `${games}g · most-played ${e.role}`
        : `${games}g (${Math.round(share * 100)}% of ${e.role}) · most-played`
      out.set(e.championKey, { level: 'red', reason })
    } else if (mastery >= MASTERY_ORANGE_THRESHOLD) {
      out.set(e.championKey, {
        level: 'orange',
        reason: `${Math.round(mastery / 1000)}k mastery`,
      })
    }
    // Yellow is team-scoped, not per-member.
  }
  return out
}

/**
 * Team-wide threat lookup, keyed by champion. Aggregates per-member
 * threats (taking the strongest) and adds yellow flags for any champion
 * appearing in 2+ members' pools.
 */
function buildTeamThreatMap(team: Team | null): Map<string, ChampionThreat> {
  const out = new Map<string, ChampionThreat>()
  if (!team?.members) return out

  // championKey → set of member display names (Set for cheap dedup when a
  // member has the same champion across multiple roles).
  const memberSets = new Map<string, Set<string>>()
  // championKey → strongest per-member threat across all members
  const memberThreats = new Map<string, MemberThreat>()

  for (const m of team.members) {
    const memberMap = buildMemberThreatMap(m)
    for (const e of (m.champPool ?? [])) {
      const setExisting = memberSets.get(e.championKey) ?? new Set<string>()
      setExisting.add(m.displayName)
      memberSets.set(e.championKey, setExisting)
    }
    for (const [key, threat] of memberMap) {
      if (!threat.level) continue
      const cur = memberThreats.get(key)
      // red > orange — keep the strongest signal across the team.
      if (!cur || (cur.level !== 'red' && threat.level === 'red')) {
        memberThreats.set(key, threat)
      }
    }
  }

  for (const [key, set] of memberSets) {
    const members = Array.from(set)
    const memberThreat = memberThreats.get(key)
    if (memberThreat?.level === 'red') {
      out.set(key, { level: 'red', reason: memberThreat.reason, members })
    } else if (memberThreat?.level === 'orange') {
      out.set(key, { level: 'orange', reason: memberThreat.reason, members })
    } else if (set.size >= 2) {
      // Yellow only kicks in when there's no stronger signal — a champion
      // that's both a dominant pick AND a flex threat stays red, because
      // we want the user's eye drawn to the more individually-threatening
      // signal first.
      out.set(key, {
        level: 'yellow',
        reason: `flex threat — ${set.size} players play it`,
        members,
      })
    }
  }
  return out
}

/** Tailwind classes for each threat tier — applied as the border ring on
 *  champion icons. Kept side-by-side so the visual identity is easy to
 *  tweak (and Tailwind's purge picks up every class). */
const THREAT_RING: Record<ThreatLevel, string> = {
  red:    'ring-2 ring-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]',
  orange: 'ring-2 ring-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.55)]',
  yellow: 'ring-2 ring-yellow-300/90 shadow-[0_0_8px_rgba(253,224,71,0.5)]',
}

/** Inline icon used inside threat tooltips. Saves duplicating the icon
 *  switch in three different render functions. */
function ThreatBadge({ level }: { level: ThreatLevel }) {
  if (level === 'red') return <Flame className="h-3 w-3 text-red-400" />
  if (level === 'orange') return <Crown className="h-3 w-3 text-orange-300" />
  return <AlertTriangle className="h-3 w-3 text-yellow-300" />
}

// Pro draft order — flat 20-slot sequence used to label each slot (B1..B20)
// and to drive auto-advance after a pick.
type Side = 'blue' | 'red'
type SlotType = 'pick' | 'ban'
interface DraftSlot {
  side: Side
  type: SlotType
  index: number // 0-4 within its side+type group
  order: number // 1-20 global order
}

const DRAFT_SEQUENCE: DraftSlot[] = [
  { side: 'blue', type: 'ban', index: 0, order: 1 },
  { side: 'red',  type: 'ban', index: 0, order: 2 },
  { side: 'blue', type: 'ban', index: 1, order: 3 },
  { side: 'red',  type: 'ban', index: 1, order: 4 },
  { side: 'blue', type: 'ban', index: 2, order: 5 },
  { side: 'red',  type: 'ban', index: 2, order: 6 },
  { side: 'blue', type: 'pick', index: 0, order: 7 },
  { side: 'red',  type: 'pick', index: 0, order: 8 },
  { side: 'red',  type: 'pick', index: 1, order: 9 },
  { side: 'blue', type: 'pick', index: 1, order: 10 },
  { side: 'blue', type: 'pick', index: 2, order: 11 },
  { side: 'red',  type: 'pick', index: 2, order: 12 },
  { side: 'red',  type: 'ban', index: 3, order: 13 },
  { side: 'blue', type: 'ban', index: 3, order: 14 },
  { side: 'red',  type: 'ban', index: 4, order: 15 },
  { side: 'blue', type: 'ban', index: 4, order: 16 },
  { side: 'red',  type: 'pick', index: 3, order: 17 },
  { side: 'blue', type: 'pick', index: 3, order: 18 },
  { side: 'blue', type: 'pick', index: 4, order: 19 },
  { side: 'red',  type: 'pick', index: 4, order: 20 },
]

/**
 * Each slot now holds an ARRAY of candidate champions (priority-ordered).
 * Empty array = no candidates yet. The first entry is the "leading pick"
 * used for the composition summary and the used-champ deduplication.
 */
type SlotOptions = string[]
interface DraftState {
  bluePicks: SlotOptions[]
  blueBans: SlotOptions[]
  redPicks: SlotOptions[]
  redBans: SlotOptions[]
}

function emptyDraft(): DraftState {
  const five = (): SlotOptions[] => [[], [], [], [], []]
  return { bluePicks: five(), blueBans: five(), redPicks: five(), redBans: five() }
}

/**
 * Parse stored JSON. Handles both the legacy flat `string[]` shape and the
 * new nested `string[][]` shape — lets old saved drafts load cleanly.
 */
function parseSlots(json: string): SlotOptions[] {
  try {
    const v = JSON.parse(json)
    if (!Array.isArray(v)) return []
    const out: SlotOptions[] = v.map((slot) => {
      if (Array.isArray(slot)) return slot.filter((c): c is string => typeof c === 'string')
      if (typeof slot === 'string') return slot ? [slot] : []
      return []
    })
    return padTo5(out)
  } catch { return [[], [], [], [], []] }
}

function padTo5(arr: SlotOptions[]): SlotOptions[] {
  const out: SlotOptions[] = [...arr]
  while (out.length < 5) out.push([])
  return out.slice(0, 5)
}

function fromDb(d: DraftPrep): DraftState {
  return {
    bluePicks: parseSlots(d.bluePicks),
    blueBans:  parseSlots(d.blueBans),
    redPicks:  parseSlots(d.redPicks),
    redBans:   parseSlots(d.redBans),
  }
}

interface Props {
  myTeam: Team | null
}

export function DraftTab({ myTeam }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { champions } = useAllChampions()
  const [drafts, setDrafts] = useState<DraftPrep[]>([])
  const [opponentTeams, setOpponentTeams] = useState<Team[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [name, setName] = useState('New draft')
  const [vsTeamId, setVsTeamId] = useState<string | null>(null)
  // Which side YOUR team plays — drives role attribution for each pick.
  const [myTeamSide, setMyTeamSide] = useState<Side>('blue')
  const [draft, setDraft] = useState<DraftState>(emptyDraft())
  const [activeSlot, setActiveSlot] = useState<DraftSlot | null>(DRAFT_SEQUENCE[0])
  const [search, setSearch] = useState('')
  // Role filter: 'ALL' or one of the 5 canonical roles. Drives the grid
  // (only show champions that play this role).
  const [roleFilter, setRoleFilter] = useState<'ALL' | Role>('ALL')
  // Which team's pool we display in the sidebar (my roster vs opponent).
  const [poolView, setPoolView] = useState<'mine' | 'opponent'>('mine')

  // ── Self-sizing draft area ────────────────────────────────────────────
  // Rather than guessing the chrome height above the draft (page title,
  // team selector card, tabs, toolbar — all of which vary with translation
  // length, button wrapping, etc.), we measure where the container actually
  // sits in the viewport and stretch it to fill exactly the rest. That way
  // the page never needs to scroll, regardless of layout shifts above.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [areaHeight, setAreaHeight] = useState<number>(0)
  useLayoutEffect(() => {
    const recompute = () => {
      const el = containerRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      // Leave a tiny bottom gap so cards don't kiss the window edge.
      const BOTTOM_PAD = 16
      const next = Math.max(420, Math.floor(window.innerHeight - top - BOTTOM_PAD))
      setAreaHeight(next)
    }
    recompute()
    window.addEventListener('resize', recompute)
    // Watch the body so we catch anything above the grid changing size:
    // toolbar wrapping when a team name is long, the active-team Card
    // growing when more teams are created, language switches resizing
    // tab labels, etc.
    const ro = new ResizeObserver(recompute)
    ro.observe(document.body)
    return () => {
      window.removeEventListener('resize', recompute)
      ro.disconnect()
    }
  }, [])

  const loadDrafts = async () => {
    try { setDrafts(await window.api.listDrafts()) }
    catch (err) { console.error('[DraftTab] Failed to load drafts:', err) }
  }
  const loadOpponents = async () => {
    try { setOpponentTeams(await window.api.listTeams({ isOpponent: true })) }
    catch (err) { console.error('[DraftTab] Failed to load opponent teams:', err) }
  }

  useEffect(() => { loadDrafts(); loadOpponents() }, [])

  const loadDraft = (d: DraftPrep) => {
    setActiveId(d.id)
    setName(d.name)
    setVsTeamId(d.vsTeamId ?? null)
    setMyTeamSide(d.myTeamSide ?? 'blue')
    setDraft(fromDb(d))
    setActiveSlot(DRAFT_SEQUENCE[0])
  }

  const newDraft = () => {
    setActiveId(null)
    setName('New draft')
    setVsTeamId(null)
    setMyTeamSide('blue')
    setDraft(emptyDraft())
    setActiveSlot(DRAFT_SEQUENCE[0])
  }

  const saveDraft = async () => {
    try {
      const payload = {
        name: name.trim() || 'Untitled',
        vsTeamId: vsTeamId,
        myTeamSide,
        bluePicks: draft.bluePicks,
        blueBans: draft.blueBans,
        redPicks: draft.redPicks,
        redBans: draft.redBans,
      }
      if (activeId) {
        await window.api.updateDraft(activeId, payload)
      } else {
        const created = await window.api.createDraft(payload)
        setActiveId(created.id)
      }
      await loadDrafts()
      toast({ title: t('team.draft.saved', { defaultValue: 'Draft saved' }) })
    } catch (err) {
      toast({ title: 'Failed to save', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const duplicateDraft = async () => {
    if (!activeId) return
    try {
      const d = await window.api.duplicateDraft(activeId)
      await loadDrafts()
      loadDraft(d)
      toast({ title: t('team.draft.duplicated', { defaultValue: 'Draft duplicated' }) })
    } catch (err) {
      toast({ title: 'Failed to duplicate', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const deleteDraft = async () => {
    if (!activeId) return
    if (!confirm(t('team.draft.confirmDelete', { defaultValue: 'Delete this draft?' }))) return
    try {
      await window.api.deleteDraft(activeId)
      await loadDrafts()
      newDraft()
    } catch (err) {
      toast({ title: 'Failed to delete', description: (err as Error).message, variant: 'destructive' })
    }
  }

  // Champions used as the LEADING pick anywhere — these are exclusive (can't be in 2 leading slots)
  // Secondary options are NOT counted as used since they're hypotheticals.
  const usedAsLeading = useMemo(() => {
    const used = new Set<string>()
    for (const list of [draft.bluePicks, draft.blueBans, draft.redPicks, draft.redBans]) {
      for (const opts of list) {
        if (opts.length > 0) used.add(opts[0])
      }
    }
    return used
  }, [draft])

  // EVERY champion mentioned anywhere in the draft (leading + alternatives).
  // Drives the "greyed-out in the right-side pool" treatment so the user
  // can see at a glance which of a player's champs have already been
  // considered/locked in this draft. Includes alternatives (not just
  // leading) because "I'm considering Aatrox or Renekton" should grey
  // BOTH in the pool sidebar.
  const usedAnywhere = useMemo(() => {
    const used = new Set<string>()
    for (const list of [draft.bluePicks, draft.blueBans, draft.redPicks, draft.redBans]) {
      for (const opts of list) {
        for (const c of opts) used.add(c)
      }
    }
    return used
  }, [draft])

  /**
   * Add a champion option to the currently-active slot. If the slot is empty
   * the champion becomes the leading pick; otherwise it's appended as an
   * alternative candidate. Auto-advances to the next slot only after the
   * leading pick is set (so consecutive clicks add alternatives to the same
   * slot until the user clicks elsewhere).
   */
  const addToActiveSlot = (key: string) => {
    if (!activeSlot) return
    setDraft((prev) => {
      const next = { ...prev }
      const sideKey = sideKeyFor(activeSlot)
      const arr = [...next[sideKey]]
      const existing = arr[activeSlot.index] ?? []
      if (existing.includes(key)) return prev // no duplicates within a slot
      arr[activeSlot.index] = [...existing, key]
      next[sideKey] = arr
      return next
    })
    // Auto-advance ONLY when slot was empty (first leading pick). When adding
    // alternatives we want to stay on the slot.
    const slotKey = sideKeyFor(activeSlot)
    const wasEmpty = (draft[slotKey][activeSlot.index] ?? []).length === 0
    if (wasEmpty) {
      const next = DRAFT_SEQUENCE.find((s) => s.order > activeSlot.order)
      if (next) setActiveSlot(next)
    }
  }

  const removeOption = (slot: DraftSlot, championKey: string) => {
    setDraft((prev) => {
      const next = { ...prev }
      const sideKey = sideKeyFor(slot)
      const arr = [...next[sideKey]]
      arr[slot.index] = (arr[slot.index] ?? []).filter((c) => c !== championKey)
      next[sideKey] = arr
      return next
    })
  }

  const promoteToLeading = (slot: DraftSlot, championKey: string) => {
    setDraft((prev) => {
      const next = { ...prev }
      const sideKey = sideKeyFor(slot)
      const arr = [...next[sideKey]]
      const opts = arr[slot.index] ?? []
      arr[slot.index] = [championKey, ...opts.filter((c) => c !== championKey)]
      next[sideKey] = arr
      return next
    })
  }

  const filteredChampions = useMemo(() => {
    const q = search.trim().toLowerCase()
    return champions.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !c.key.toLowerCase().includes(q)) return false
      if (roleFilter !== 'ALL' && !championPlaysRole(c.key, roleFilter, c.tags)) return false
      return true
    })
  }, [champions, search, roleFilter])

  const vsTeam = opponentTeams.find((t) => t.id === vsTeamId) ?? null
  const poolTeam = poolView === 'mine' ? myTeam : vsTeam

  // Threat map for the OPPONENT team — used to highlight dangerous picks
  // in the main champion grid regardless of which pool the sidebar
  // currently shows. Recomputed only when the opponent's data actually
  // changes (memo key on team id + member count + first updatedAt) to
  // avoid re-walking the pool on every keystroke in the search box.
  const opponentThreats = useMemo(
    () => buildTeamThreatMap(vsTeam),
    [vsTeam],
  )
  // A second map computed against the team currently displayed in the
  // sidebar — so when the user switches to "My team" view the icons
  // there also light up for their own dominant picks.
  const sidebarThreats = useMemo(
    () => buildTeamThreatMap(poolTeam),
    [poolTeam],
  )

  // Role distribution per side. Each side is mapped against either MY team
  // pool (if it's our side) or the opponent's pool (if scouted). When a pick
  // isn't in any pool we fall back to a tag-based heuristic, last resort "?".
  const blueRoles = useMemo(
    () => computeRoleDistribution(draft.bluePicks.map((o) => o[0] ?? null), myTeamSide === 'blue' ? myTeam : vsTeam, champions),
    [draft.bluePicks, myTeam, vsTeam, myTeamSide, champions],
  )
  const redRoles = useMemo(
    () => computeRoleDistribution(draft.redPicks.map((o) => o[0] ?? null), myTeamSide === 'red' ? myTeam : vsTeam, champions),
    [draft.redPicks, myTeam, vsTeam, myTeamSide, champions],
  )

  return (
    // Height is measured at runtime (see useLayoutEffect above) so the
    // grid takes EXACTLY the space remaining below whatever chrome
    // (title, team selector, tabs, toolbar) sits above. Page never
    // scrolls; all 4 columns are exactly the same height.
    <div
      ref={containerRef}
      className="grid grid-cols-[180px_1fr_380px] gap-3 min-h-[420px]"
      style={areaHeight ? { height: `${areaHeight}px` } : undefined}
    >
      {/* Sidebar: drafts list */}
      <Card className="p-2 space-y-1 h-full overflow-y-auto">
        <Button size="sm" className="w-full mb-2" onClick={newDraft}>
          <Plus className="h-3 w-3 mr-1" />{t('team.draft.new', { defaultValue: 'New' })}
        </Button>
        {drafts.length === 0 && (
          <p className="text-xs text-hextech-text-dim italic px-2 text-center">{t('team.draft.noDrafts', { defaultValue: 'No drafts saved yet.' })}</p>
        )}
        {drafts.map((d) => (
          <button
            key={d.id}
            onClick={() => loadDraft(d)}
            className={cn(
              'w-full text-left px-2 py-1.5 rounded text-xs transition-colors',
              activeId === d.id
                ? 'bg-hextech-gold/20 text-hextech-gold-bright'
                : 'text-hextech-text hover:bg-white/5',
            )}
          >
            <div className="truncate font-medium">{d.name}</div>
            <div className="text-[10px] text-hextech-text-dim">{new Date(d.updatedAt).toLocaleDateString()}</div>
          </button>
        ))}
      </Card>

      {/* Main draft area — flex column so the toolbar stays fixed at the
          top and the inner 3-col grid grabs all remaining vertical
          space. min-h-0 lets the grid actually shrink below its
          intrinsic content size. */}
      <div className="flex flex-col gap-3 min-w-0 h-full min-h-0">
        {/* Toolbar */}
        <Card className="p-2 flex items-center gap-2 flex-wrap shrink-0">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('team.draft.namePlaceholder', { defaultValue: 'Draft name' })}
            className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-sm font-semibold flex-1 min-w-[150px]"
          />
          <select
            value={vsTeamId ?? ''}
            onChange={(e) => setVsTeamId(e.target.value || null)}
            className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-sm"
            title={t('team.draft.vsTeamHint', { defaultValue: 'Pick the opponent team being drafted against' })}
          >
            <option value="">{t('team.draft.noOpponent', { defaultValue: '— No opponent —' })}</option>
            {opponentTeams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </select>

          {/* My-side toggle — drives which side maps to MY team's pool for
              role attribution. */}
          <div className="flex items-center gap-1 bg-hextech-dark border border-hextech-border rounded p-0.5">
            <span className="text-[10px] text-hextech-text-dim px-1 uppercase tracking-wider font-semibold">
              {t('team.draft.mySide', { defaultValue: 'My side' })}
            </span>
            <button
              onClick={() => setMyTeamSide('blue')}
              className={cn(
                'px-2 py-0.5 text-[10px] font-bold uppercase rounded transition-colors',
                myTeamSide === 'blue' ? 'bg-blue-500 text-white' : 'text-blue-300/60 hover:text-blue-300',
              )}
              title={t('team.draft.mySideBlue', { defaultValue: 'I play blue side' })}
            >Blue</button>
            <button
              onClick={() => setMyTeamSide('red')}
              className={cn(
                'px-2 py-0.5 text-[10px] font-bold uppercase rounded transition-colors',
                myTeamSide === 'red' ? 'bg-red-500 text-white' : 'text-red-300/60 hover:text-red-300',
              )}
              title={t('team.draft.mySideRed', { defaultValue: 'I play red side' })}
            >Red</button>
          </div>
          <Button size="sm" onClick={saveDraft}>
            <Save className="h-3 w-3 mr-1" />{t('team.draft.save', { defaultValue: 'Save' })}
          </Button>
          <Button size="sm" variant="outline" onClick={duplicateDraft} disabled={!activeId}>
            <Copy className="h-3 w-3 mr-1" />{t('team.draft.duplicate', { defaultValue: 'Duplicate' })}
          </Button>
          <Button size="sm" variant="outline" onClick={deleteDraft} disabled={!activeId}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </Card>

        <div className="grid grid-cols-[1fr_1.4fr_1fr] gap-3 min-w-0 flex-1 min-h-0">
          {/* Blue side */}
          <SideColumn
            side="blue"
            picks={draft.bluePicks}
            bans={draft.blueBans}
            activeSlot={activeSlot}
            onSelectSlot={setActiveSlot}
            onRemoveOption={removeOption}
            onPromote={promoteToLeading}
            roles={blueRoles}
            isMySide={myTeamSide === 'blue'}
          />

          {/* Champion grid */}
          <Card className="p-2 h-full overflow-y-auto">
            <div className="sticky top-0 bg-hextech-dark/95 pb-2 z-10 space-y-1.5 mb-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-hextech-text-dim" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('team.draft.searchPlaceholder', { defaultValue: 'Search…' })}
                    className="w-full bg-hextech-dark border border-hextech-border rounded pl-7 pr-2 py-1 text-sm"
                  />
                </div>
              </div>

              {/* Role filter — 5 toggle pills + "All". Mirrors the format used
                  by drafter.lol and lolalytics: click a role to show only
                  champions commonly played there. */}
              <div className="flex items-center gap-1 bg-hextech-dark border border-hextech-border rounded p-0.5">
                <button
                  onClick={() => setRoleFilter('ALL')}
                  className={cn(
                    'flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-colors',
                    roleFilter === 'ALL' ? 'bg-hextech-gold text-black' : 'text-hextech-text-dim hover:text-white',
                  )}
                >
                  {t('team.draft.allRoles', { defaultValue: 'All' })}
                </button>
                {ROLES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRoleFilter(r)}
                    className={cn(
                      'flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-colors',
                      roleFilter === r
                        ? ROLE_FILTER_ACTIVE[r]
                        : 'text-hextech-text-dim hover:text-white',
                    )}
                    title={`Show champions commonly played as ${ROLE_LABEL_SHORT[r]}`}
                  >
                    {ROLE_LABEL_SHORT[r]}
                  </button>
                ))}
              </div>
            </div>
            {activeSlot ? (
              <p className="text-[10px] text-hextech-gold uppercase tracking-wider mb-2 px-1">
                {t('team.draft.addingTo', {
                  defaultValue: 'Adding to: {{side}} {{type}} #{{idx}}',
                  side: activeSlot.side === 'blue' ? 'Blue' : 'Red',
                  type: activeSlot.type,
                  idx: activeSlot.index + 1,
                })}
              </p>
            ) : (
              <p className="text-[10px] text-hextech-text-dim italic mb-2 px-1">{t('team.draft.selectSlotFirst', { defaultValue: 'Select a slot first' })}</p>
            )}
            {/* Threat legend — shown once at the top of the grid so users
                immediately know what the colored rings mean. Compact, no
                visual noise when no opponent is selected. */}
            {vsTeam && opponentThreats.size > 0 && (
              <ThreatLegend />
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-1.5">
              {filteredChampions.map((c) => (
                <ChampionPickButton
                  key={c.key}
                  champion={c}
                  // Only the LEADING pick locks a champion. Alternatives don't.
                  used={usedAsLeading.has(c.key)}
                  disabled={!activeSlot}
                  threat={opponentThreats.get(c.key) ?? null}
                  onClick={() => addToActiveSlot(c.key)}
                />
              ))}
            </div>
          </Card>

          {/* Red side */}
          <SideColumn
            side="red"
            picks={draft.redPicks}
            bans={draft.redBans}
            activeSlot={activeSlot}
            onSelectSlot={setActiveSlot}
            onRemoveOption={removeOption}
            onPromote={promoteToLeading}
            roles={redRoles}
            isMySide={myTeamSide === 'red'}
          />
        </div>
      </div>

      {/* Right: champion pool sidebar with team toggle */}
      <PoolSidebar
        poolTeam={poolTeam}
        poolView={poolView}
        onSwitch={setPoolView}
        hasOpponent={!!vsTeam}
        myTeamName={myTeam?.name}
        opponentName={vsTeam?.name}
        threats={sidebarThreats}
        usedChampions={usedAnywhere}
      />
    </div>
  )
}

function sideKeyFor(slot: DraftSlot): keyof DraftState {
  return `${slot.side}${slot.type === 'pick' ? 'Picks' : 'Bans'}` as keyof DraftState
}

// ──────────────────────────────────────────────────────────────────────────
// Side column (Blue/Red) — renders slots in REAL pro draft order, grouped
// into the 4 official phases: Bans 1-3 → Picks 1-3 → Bans 4-5 → Picks 4-5.
// ──────────────────────────────────────────────────────────────────────────
interface PhaseGroup {
  label: string
  type: SlotType
  indices: number[] // indices within picks/bans arrays for this side
}

// Same structure for both sides — order is preserved per-side regardless of
// which side picks first (visually each team sees their own bans/picks in
// phase order, which matches how casters & sites present the draft).
const PHASES: PhaseGroup[] = [
  { label: 'Bans 1-3',  type: 'ban',  indices: [0, 1, 2] },
  { label: 'Picks 1-3', type: 'pick', indices: [0, 1, 2] },
  { label: 'Bans 4-5',  type: 'ban',  indices: [3, 4] },
  { label: 'Picks 4-5', type: 'pick', indices: [3, 4] },
]

function SideColumn({
  side, picks, bans, activeSlot, onSelectSlot, onRemoveOption, onPromote, roles, isMySide,
}: {
  side: Side
  picks: SlotOptions[]
  bans: SlotOptions[]
  activeSlot: DraftSlot | null
  onSelectSlot: (slot: DraftSlot) => void
  onRemoveOption: (slot: DraftSlot, championKey: string) => void
  onPromote: (slot: DraftSlot, championKey: string) => void
  roles: RoleDistribution
  isMySide: boolean
}) {
  const { t } = useTranslation()
  const sideBorder = side === 'blue' ? 'border-blue-500/50' : 'border-red-500/50'
  const sideText = side === 'blue' ? 'text-blue-300' : 'text-red-300'
  const label = side === 'blue' ? t('team.draft.blueSide', { defaultValue: 'Blue side' }) : t('team.draft.redSide', { defaultValue: 'Red side' })

  return (
    // h-full + flex column lets the side column fill the grid cell its
    // parent (`flex-1`) sized for it. The flex children below divide
    // that height proportionally so all 10 slots get equal-ish rows.
    <Card className={cn('p-2 border-l-4 h-full flex flex-col min-h-0 overflow-hidden', sideBorder)}>
      <h3 className={cn('text-xs font-bold uppercase tracking-wider mb-2 pb-1 flex items-center justify-between shrink-0', sideText)}>
        <span>{label}</span>
        {isMySide && (
          <span className="text-[9px] font-bold bg-hextech-gold/20 text-hextech-gold border border-hextech-gold/40 rounded px-1 py-0.5">
            {t('team.draft.myTeamTag', { defaultValue: 'MY TEAM' })}
          </span>
        )}
      </h3>

      {/* Slots area: takes the full remaining vertical space. Each phase
          gets a weight equal to its slot count so all 10 slots end up
          roughly the same row height regardless of phase. */}
      <div className="flex-1 flex flex-col gap-2 min-h-0">
        {PHASES.map((phase) => (
          <div
            key={phase.label}
            // Weight = number of slots in this phase. 3 for Bans 1-3 /
            // Picks 1-3, 2 for Bans 4-5 / Picks 4-5. Adds up to 10 total.
            // Using `flex` shorthand so flex-basis: 0 (children share
            // space purely by weight, ignoring intrinsic content size).
            style={{ flex: phase.indices.length }}
            className="flex flex-col min-h-0"
          >
            <p className={cn(
              'text-[10px] uppercase tracking-wider mb-1 font-semibold flex items-center gap-1.5 shrink-0',
              phase.type === 'ban' ? 'text-red-300/80' : 'text-emerald-300/80',
            )}>
              {/* Tiny color dot mirrors the slot tint for instant association */}
              <span className={cn('h-1.5 w-1.5 rounded-full', phase.type === 'ban' ? 'bg-red-400' : 'bg-emerald-400')} />
              {phase.label}
            </p>
            {/* Inner column: distribute the phase's allocated height
                evenly between its slots. */}
            <div className="flex-1 flex flex-col gap-1 min-h-0">
              {phase.indices.map((i) => {
                const slot = DRAFT_SEQUENCE.find((s) => s.side === side && s.type === phase.type && s.index === i)!
                const options = phase.type === 'ban' ? (bans[i] ?? []) : (picks[i] ?? [])
                const isActive = activeSlot?.side === side && activeSlot?.type === phase.type && activeSlot?.index === i
                return (
                  <MultiOptionSlot
                    key={`${phase.type}-${i}`}
                    slot={slot}
                    options={options}
                    isActive={isActive}
                    side={side}
                    onSelect={() => onSelectSlot(slot)}
                    onRemove={(k) => onRemoveOption(slot, k)}
                    onPromote={(k) => onPromote(slot, k)}
                    isBan={phase.type === 'ban'}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Roles summary — pinned to the bottom, doesn't compete with the
          slots for vertical space. Only rendered once at least one pick
          exists to avoid an empty visual block on a fresh draft. */}
      {roles.totalPicks > 0 && (
        <div className="pt-2 mt-2 border-t border-hextech-border-dim shrink-0">
          <p className="text-[10px] text-hextech-text-dim uppercase tracking-wider mb-1 flex items-center gap-1">
            <span>{t('team.draft.roles', { defaultValue: 'Roles' })}</span>
            {roles.unknown > 0 && (
              <span className="text-[9px] italic text-hextech-text-dim/70">
                ({roles.unknown} {t('team.draft.unknownShort', { defaultValue: 'unknown' })})
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-1">
            {ROLE_ORDER.map((r) => (
              <RoleBadge
                key={r}
                role={r}
                champions={roles.byRole[r] ?? []}
              />
            ))}
            {roles.unknown > 0 && (
              <RoleBadge role="?" champions={roles.unknownChamps} />
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

const ROLE_LABEL: Record<string, string> = {
  TOP: 'Top', JUNGLE: 'JG', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Sup', '?': '?',
}
const ROLE_COLOR: Record<string, string> = {
  TOP:     'bg-orange-500/20 border-orange-500/50 text-orange-200',
  JUNGLE:  'bg-emerald-500/20 border-emerald-500/50 text-emerald-200',
  MID:     'bg-purple-500/20 border-purple-500/50 text-purple-200',
  ADC:     'bg-yellow-500/20 border-yellow-500/50 text-yellow-200',
  SUPPORT: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200',
  '?':     'bg-zinc-500/20 border-zinc-500/50 text-zinc-300',
}
// Solid backgrounds for the role-filter pills — saturated enough to read
// clearly as "selected" against the toolbar.
const ROLE_FILTER_ACTIVE: Record<Role, string> = {
  TOP:     'bg-orange-500 text-black',
  JUNGLE:  'bg-emerald-500 text-black',
  MID:     'bg-purple-500 text-white',
  ADC:     'bg-yellow-500 text-black',
  SUPPORT: 'bg-cyan-500 text-black',
}

function RoleBadge({ role, champions }: { role: string; champions: string[] }) {
  const filled = champions.length > 0
  return (
    <span
      title={champions.join(', ') || `${ROLE_LABEL[role]}: empty`}
      className={cn(
        'text-[10px] rounded px-1.5 py-0.5 border font-semibold uppercase tracking-wider transition-opacity',
        filled ? ROLE_COLOR[role] : 'bg-white/5 border-white/10 text-hextech-text-dim/60 opacity-60',
      )}
    >
      {ROLE_LABEL[role]} <span className="font-bold">{champions.length}</span>
    </span>
  )
}

/**
 * A single draft slot row that holds multiple champion options.
 * Click the `+` (or any empty area) to make this slot active for the next
 * grid pick. Click an option to promote it to leading; the X removes it.
 *
 * Visual identity:
 *   - Bans:  red-tinted background + Ban icon overlay on each option
 *   - Picks: side-tinted background (blue or red) — matches the team color
 */
function MultiOptionSlot({
  slot, options, isActive, side, onSelect, onRemove, onPromote, isBan,
}: {
  slot: DraftSlot
  options: string[]
  isActive: boolean
  side: Side
  onSelect: () => void
  onRemove: (championKey: string) => void
  onPromote: (championKey: string) => void
  isBan?: boolean
}) {
  // Distinct backgrounds make pick vs ban obvious at a glance without needing
  // to read the section header. Active slot always wins (gold ring).
  const baseBg = isBan
    ? 'bg-red-950/40 border-red-900/60 hover:bg-red-950/60'
    : side === 'blue'
      ? 'bg-blue-950/40 border-blue-900/60 hover:bg-blue-950/60'
      : 'bg-red-900/30 border-red-800/50 hover:bg-red-900/40'
  return (
    // flex-1 makes the slot share its phase's height evenly with sibling
    // slots. min-h-0 lets it shrink below its content's natural size if
    // needed (otherwise long alt-option lists would push it taller than
    // its allocation).
    <div
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded border transition-all cursor-pointer flex-1 min-h-0',
        isActive
          ? 'border-hextech-gold bg-hextech-gold/10 ring-1 ring-hextech-gold/30'
          : baseBg,
      )}
      title={`Slot #${slot.order}${isBan ? ' (ban)' : ' (pick)'}`}
    >
      <span className={cn(
        'text-[10px] font-bold w-6 text-center shrink-0 leading-tight',
        isActive ? 'text-hextech-gold' : isBan ? 'text-red-300/70' : side === 'blue' ? 'text-blue-300/70' : 'text-red-300/70',
      )}>
        {isBan ? `B${slot.index + 1}` : `P${slot.index + 1}`}
      </span>

      {options.length === 0 ? (
        <span className={cn('text-[11px] italic flex-1', isActive ? 'text-hextech-gold' : 'text-hextech-text-dim')}>
          {isActive ? 'Click champion →' : isBan ? 'no ban' : 'no pick'}
        </span>
      ) : (
        <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
          {options.map((c, idx) => (
            <SlotOption
              key={c}
              championKey={c}
              isLeading={idx === 0}
              isBan={isBan}
              onPromote={(e) => { e.stopPropagation(); onPromote(c) }}
              onRemove={(e) => { e.stopPropagation(); onRemove(c) }}
            />
          ))}
        </div>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onSelect() }}
        title="Add another option (click then pick a champion)"
        className={cn(
          'shrink-0 h-7 w-7 rounded flex items-center justify-center transition-colors',
          isActive ? 'bg-hextech-gold/30 text-hextech-gold-bright' : 'bg-black/30 text-hextech-text-dim hover:bg-black/50 hover:text-white',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function SlotOption({ championKey, isLeading, isBan, onPromote, onRemove }: {
  championKey: string
  isLeading: boolean
  isBan?: boolean
  onPromote: (e: React.MouseEvent) => void
  onRemove: (e: React.MouseEvent) => void
}) {
  const iconUrl = useChampionIconUrl(championKey)
  return (
    <div className="relative group/opt">
      <button
        onClick={onPromote}
        title={`${championKey}${isLeading ? ' (leading)' : ' — click to promote'}`}
        className={cn(
          // Bumped from h-7 w-7 (28px) to h-11 w-11 (44px) so the champion
          // portrait is actually readable in the now-larger slot rows.
          // Leading pick keeps a thicker gold border so it remains
          // visually distinct from alternatives even at a glance.
          'h-11 w-11 rounded overflow-hidden border-2 flex items-center justify-center bg-black/30',
          isLeading ? 'border-hextech-gold' : 'border-hextech-border-dim opacity-70 hover:opacity-100 hover:border-hextech-border',
        )}
      >
        {iconUrl && <img src={iconUrl} alt={championKey} className="w-full h-full object-cover" />}
        {isBan && (
          <div className="absolute inset-0 bg-red-500/40 flex items-center justify-center pointer-events-none">
            <Ban className="h-4 w-4 text-white/80" />
          </div>
        )}
      </button>
      <button
        onClick={onRemove}
        title="Remove this option"
        className="absolute -top-1 -right-1 bg-red-500/80 hover:bg-red-500 rounded-full w-4 h-4 items-center justify-center opacity-0 group-hover/opt:opacity-100 transition-opacity flex"
      >
        <X className="h-2.5 w-2.5 text-white" />
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Champion pick button (grid)
// ──────────────────────────────────────────────────────────────────────────
function ChampionPickButton({ champion, used, disabled, threat, onClick }: {
  champion: ChampionMeta
  used: boolean
  disabled: boolean
  /** Threat assessment from the opponent's pool, or `null` if not a threat. */
  threat: ChampionThreat | null
  onClick: () => void
}) {
  const iconUrl = useChampionIconUrl(champion.key)
  // Tooltip text — appended to the champion name so the user gets context
  // on hover without an extra UI element.
  const tooltipParts: string[] = [used ? `${champion.name} (already leading pick)` : champion.name]
  if (threat) tooltipParts.push(`THREAT: ${threat.reason} — ${threat.members.join(', ')}`)
  return (
    <button
      onClick={onClick}
      disabled={disabled || used}
      title={tooltipParts.join('\n')}
      className={cn(
        'relative aspect-square rounded overflow-hidden transition-all border-2',
        used || disabled
          ? 'opacity-30 cursor-not-allowed grayscale'
          : 'hover:border-hextech-gold border-transparent hover:scale-105',
        // Threat ring sits on top of the icon — kept on a separate class
        // layer so opacity/hover scaling animations don't drag it around.
        // Greyed-out (used/disabled) champions keep their ring so the user
        // can still tell the threat is locked.
        threat && THREAT_RING[threat.level],
      )}
    >
      {iconUrl && <img src={iconUrl} alt={champion.name} className="w-full h-full object-cover" />}
      {threat && (
        // Tiny corner badge — purely redundant with the ring, but useful
        // for colorblind users who'd otherwise miss the orange vs red
        // distinction.
        <span className="absolute top-0.5 right-0.5 bg-black/80 rounded-full p-px">
          <ThreatBadge level={threat.level} />
        </span>
      )}
    </button>
  )
}

/**
 * Inline legend explaining what the colored champion rings mean. Shown
 * above the grid when an opponent team is selected and at least one of
 * its champions is flagged as a threat. Hidden otherwise to avoid noise.
 */
function ThreatLegend() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mb-2 px-1 text-[10px] text-hextech-text-dim">
      <span className="font-bold uppercase tracking-wider">
        {t('team.draft.threats', { defaultValue: 'Opponent threats' })}:
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded ring-2 ring-red-500" />
        <Flame className="h-3 w-3 text-red-400" />
        {t('team.draft.threatRed', { defaultValue: '100+ games & most-played' })}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded ring-2 ring-orange-400" />
        <Crown className="h-3 w-3 text-orange-300" />
        {t('team.draft.threatOrange', { defaultValue: '300k+ mastery' })}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded ring-2 ring-yellow-300/90" />
        <AlertTriangle className="h-3 w-3 text-yellow-300" />
        {t('team.draft.threatYellow', { defaultValue: 'flex pick (2+ players)' })}
      </span>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Right sidebar: champion pool, switchable between My team and Opponent
// ──────────────────────────────────────────────────────────────────────────
function PoolSidebar({
  poolTeam, poolView, onSwitch, hasOpponent, myTeamName, opponentName, threats, usedChampions,
}: {
  poolTeam: Team | null
  poolView: 'mine' | 'opponent'
  onSwitch: (v: 'mine' | 'opponent') => void
  hasOpponent: boolean
  myTeamName?: string
  opponentName?: string
  /** Threat lookup matching the team currently displayed in the sidebar.
   *  Empty map = no threat highlights (e.g. no opponent scouted yet). */
  threats: Map<string, ChampionThreat>
  /** Champions already picked/banned anywhere in the current draft —
   *  rendered with a greyscale + opacity treatment in the sidebar so the
   *  user can tell what's still on the board at a glance. */
  usedChampions: Set<string>
}) {
  const { t } = useTranslation()
  return (
    <Card className="p-2 h-full overflow-y-auto">
      <h3 className="text-xs font-bold uppercase tracking-wider text-hextech-text-dim mb-2 flex items-center gap-1.5">
        <Target className="h-3 w-3" />
        {t('team.draft.poolSidebar', { defaultValue: 'Champion pools' })}
      </h3>

      {/* Team toggle — only meaningful when we have an opponent */}
      <div className="flex bg-hextech-dark border border-hextech-border rounded p-0.5 mb-2">
        <button
          onClick={() => onSwitch('mine')}
          className={cn(
            'flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-colors',
            poolView === 'mine' ? 'bg-hextech-gold text-black' : 'text-hextech-text-dim hover:text-white',
          )}
        >
          <Users className="h-3 w-3 inline mr-1" />
          {myTeamName ?? t('team.draft.myTeam', { defaultValue: 'My team' })}
        </button>
        <button
          onClick={() => onSwitch('opponent')}
          disabled={!hasOpponent}
          className={cn(
            'flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-colors',
            poolView === 'opponent'
              ? 'bg-red-500/80 text-white'
              : 'text-hextech-text-dim hover:text-white disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          <Target className="h-3 w-3 inline mr-1" />
          {opponentName ?? t('team.draft.opponent', { defaultValue: 'Opponent' })}
        </button>
      </div>

      {!poolTeam ? (
        <p className="text-[10px] text-hextech-text-dim italic text-center py-4 px-2">
          {poolView === 'mine'
            ? t('team.draft.noMyTeam', { defaultValue: 'No active team selected. Create or pick one above.' })
            : t('team.draft.noOpponentPool', { defaultValue: 'No opponent assigned to this draft. Pick one in the toolbar.' })}
        </p>
      ) : (poolTeam.members ?? []).length === 0 ? (
        <p className="text-[10px] text-hextech-text-dim italic text-center py-4 px-2">
          {t('team.draft.noMembers', { defaultValue: 'No members on this team yet.' })}
        </p>
      ) : (
        <div className="space-y-2">
          {(poolTeam.members ?? [])
            .slice() // avoid in-place sort of the original array reference
            .sort((a, b) => roleOrder(a.role) - roleOrder(b.role))
            .map((m) => (
              <MemberPoolBlock key={m.id} member={m} threats={threats} usedChampions={usedChampions} />
            ))}
        </div>
      )}
    </Card>
  )
}

const ROLE_ORDER = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']
function roleOrder(r: string): number {
  const i = ROLE_ORDER.indexOf(r.toUpperCase())
  return i === -1 ? 99 : i
}

const TIER_BG: Record<string, string> = {
  main: 'border-emerald-500/70',
  comfort: 'border-blue-500/70',
  flex: 'border-yellow-500/70',
  learning: 'border-zinc-500/70',
}

function MemberPoolBlock({ member, threats, usedChampions }: {
  member: TeamMember
  threats: Map<string, ChampionThreat>
  /** Champions already in the draft — greyed out in the displayed pool. */
  usedChampions: Set<string>
}) {
  const [pool, setPool] = useState<ChampionPoolEntry[]>([])
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.api.listChampionPool(member.id)
      .then((p) => { if (!cancelled) setPool(p) })
      .catch(() => { /* keep empty */ })
    return () => { cancelled = true }
  }, [member.id])

  // Filter to the member's assigned role only — a TOP laner's draft pool
  // shouldn't show off-role flex picks (Braum on a TOP main, etc.).
  // Pool entries from older scouts may have other roles; they're hidden but
  // still in the DB for the dedicated Champion Pool tab.
  const memberRole = (member.role || '').toUpperCase()
  const groups = useMemo(() => {
    const out: Record<string, ChampionPoolEntry[]> = { main: [], comfort: [], flex: [], learning: [] }
    for (const e of pool) {
      if (e.role.toUpperCase() !== memberRole) continue
      (out[e.tier] ?? out.flex).push(e)
    }
    return out
  }, [pool, memberRole])

  // Per-member threat assessment — combined with the team-level map so an
  // individual icon shows the player-specific "100g + most-played" signal
  // even when the same champion isn't on multiple members.
  const memberThreats = useMemo(() => buildMemberThreatMap({ ...member, champPool: pool }), [member, pool])

  return (
    <div className="rounded border border-hextech-border-dim overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-2 py-1 bg-hextech-elevated/50 hover:bg-hextech-elevated flex items-center gap-1.5 text-left"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform shrink-0', expanded && 'rotate-90')} />
        <span className="text-[10px] font-bold text-hextech-text-bright truncate">{member.displayName}</span>
        <span className="text-[9px] text-hextech-text-dim shrink-0 ml-auto">{member.role}</span>
      </button>
      {expanded && (
        <div className="p-1.5 space-y-1">
          {pool.length === 0 ? (
            <p className="text-[9px] text-hextech-text-dim italic text-center py-1">
              No pool yet
            </p>
          ) : (
            (['main', 'comfort', 'flex'] as const).map((tier) => {
              const items = groups[tier]
              if (items.length === 0) return null
              return (
                <div key={tier}>
                  <p className="text-[8px] uppercase tracking-wider text-hextech-text-dim font-semibold mb-0.5">
                    {tier} ({items.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {items.map((e) => {
                      // Resolve the strongest threat available for this
                      // icon: prefer the per-member signal (red/orange);
                      // fall back to the team-wide map (which can supply
                      // yellow for flex threats).
                      const personal = memberThreats.get(e.championKey)
                      const teamWide = threats.get(e.championKey)
                      const threat: ThreatLevel | null =
                        personal?.level
                        ?? teamWide?.level
                        ?? null
                      const reason = personal?.reason ?? teamWide?.reason ?? ''
                      return (
                        <PoolMiniIcon
                          key={e.id}
                          championKey={e.championKey}
                          tier={e.tier}
                          winRate={e.winRate ?? undefined}
                          playRate={e.playRate ?? undefined}
                          masteryPoints={e.masteryPoints ?? undefined}
                          threat={threat}
                          threatReason={reason}
                          used={usedChampions.has(e.championKey)}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

function PoolMiniIcon({ championKey, tier, winRate, playRate, masteryPoints, threat, threatReason, used }: {
  championKey: string
  tier: string
  winRate?: number
  playRate?: number
  masteryPoints?: number
  threat?: ThreatLevel | null
  threatReason?: string
  /** True when this champion is already used somewhere in the active draft
   *  — applies a grayscale + reduced opacity treatment so the user can
   *  scan a player's pool for what's still pickable. */
  used?: boolean
}) {
  const iconUrl = useChampionIconUrl(championKey)
  // Tooltip aggregates everything we know — game count, win rate, mastery,
  // and the threat reason if one applies. Multi-line so it stays readable.
  const lines = [
    championKey,
    playRate ? `${playRate}g` : null,
    winRate !== undefined ? `${winRate}% WR` : null,
    masteryPoints ? `${Math.round(masteryPoints / 1000)}k mastery` : null,
    threat ? `THREAT (${threat}): ${threatReason}` : null,
    used ? 'Already in current draft' : null,
  ].filter(Boolean) as string[]
  return (
    <div
      title={lines.join('\n')}
      className={cn(
        // Larger icons (40×40) so champions are recognizable without hovering.
        // Tier color is on a thicker border to keep main/comfort/flex obvious
        // even at this size.
        'relative h-10 w-10 rounded overflow-hidden border-2 bg-black/30 group/icon transition-all',
        TIER_BG[tier] ?? 'border-hextech-border-dim',
        // Threat ring layers on top of the tier border — we keep both so
        // the user can read tier AND threat at a glance. Suppressed when
        // used (the icon is already deprioritized; ring + grayscale fight
        // for attention).
        threat && !used && THREAT_RING[threat],
        // Greyed-out treatment for champions already in the draft. We
        // grayscale + dim instead of hiding so the user can still see
        // they're there (and use the WR/mastery info to compare).
        used && 'grayscale opacity-40',
      )}
    >
      {iconUrl && <img src={iconUrl} alt={championKey} className="w-full h-full object-cover" />}
      {/* Win rate badge on the bottom — only shown for entries with data
          (auto-filled / scouted). Manual entries stay clean. */}
      {winRate !== undefined && playRate !== undefined && (
        <span className="absolute bottom-0 inset-x-0 bg-black/75 text-[8px] font-bold text-white text-center leading-tight py-px">
          {winRate}%
        </span>
      )}
      {/* Threat badge (top-left) — colorblind-safe secondary signal. */}
      {threat && !used && (
        <span className="absolute top-0 left-0 bg-black/80 rounded-br px-px">
          <ThreatBadge level={threat} />
        </span>
      )}
      {/* "Used" marker — small check-style overlay so the eye can spot
          drafted picks without needing to read the tooltip. */}
      {used && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="bg-black/70 rounded-full p-0.5">
            <X className="h-3 w-3 text-white/90" />
          </span>
        </span>
      )}
    </div>
  )
}

interface RoleDistribution {
  /** champions assigned per canonical role (TOP/JUNGLE/MID/ADC/SUPPORT) */
  byRole: Record<string, string[]>
  /** champions we couldn't confidently attribute */
  unknownChamps: string[]
  unknown: number
  totalPicks: number
}

/**
 * Best-effort role attribution for each pick:
 *   1. Look the champion up in the team's members' pools. If exactly one
 *      member has it, take that member's role. If multiple have it, pick
 *      the one where it's highest-tier (main > comfort > flex > learning).
 *   2. If not in any pool, fall back to a tag heuristic (Marksman→ADC,
 *      Support→SUPPORT, Mage→MID, Tank→TOP, Assassin→MID, Fighter→TOP).
 *      These defaults match the most common pro mapping; users can disagree
 *      and it'll fall into "?" if no tag matches.
 *   3. Otherwise classify as unknown ("?").
 *
 * Returns a stable object so all 5 canonical roles always appear in the UI
 * (empty roles render as faded badges).
 */
function computeRoleDistribution(
  picks: (string | null)[],
  team: Team | null,
  champions: ChampionMeta[],
): RoleDistribution {
  const byRole: Record<string, string[]> = { TOP: [], JUNGLE: [], MID: [], ADC: [], SUPPORT: [] }
  const unknownChamps: string[] = []
  let total = 0

  for (const key of picks) {
    if (!key) continue
    total++
    const role = attributeRole(key, team, champions)
    if (role && byRole[role]) {
      byRole[role].push(key)
    } else {
      unknownChamps.push(key)
    }
  }
  return { byRole, unknownChamps, unknown: unknownChamps.length, totalPicks: total }
}

const TIER_PRIORITY: Record<string, number> = { main: 4, comfort: 3, flex: 2, learning: 1 }

function attributeRole(championKey: string, team: Team | null, champions: ChampionMeta[]): string | null {
  // 1) Search the team's pools — most accurate signal since the team has
  // explicitly assigned this champion to a member playing that role.
  if (team?.members) {
    let bestRole: string | null = null
    let bestScore = -1
    for (const m of team.members) {
      const entry = m.champPool?.find((e) => e.championKey === championKey)
      if (!entry) continue
      const score = TIER_PRIORITY[entry.tier] ?? 0
      if (score > bestScore) {
        bestScore = score
        bestRole = entry.role.toUpperCase()
      }
    }
    if (bestRole && bestRole in { TOP: 1, JUNGLE: 1, MID: 1, ADC: 1, SUPPORT: 1 }) return bestRole
  }

  // 2) Curated mapping fallback (championRoles.ts) — uses the primary role
  // for unknown picks. Falls back internally to a tag heuristic for new
  // champions not yet in the catalog.
  const c = champions.find((c) => c.key === championKey)
  const roles = getChampionRoles(championKey, c?.tags ?? [])
  return roles[0] ?? null
}
