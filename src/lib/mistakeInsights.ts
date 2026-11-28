/**
 * Mistake Lab (Stats → Erreurs). Pure — turns tagged occurrences into the
 * answers the page shows: which mistakes matter most (share + win-rate
 * cost), when in the game they happen, how they evolve, and the exact
 * moments to rewatch. Follows the UI/UX audit of 17/11/2026: one ranking
 * instead of three redundant charts, 4 families instead of a 26-tag cloud,
 * a trend that never renders 90% empty.
 */

import type { MistakeTier, TierReason } from './microReview/mistakeTiers'
export type { MistakeTier, TierReason }

export interface MistakeOccurrence {
  id: string
  tag: { id: string; slug: string; label: string; category: string; color?: string | null }
  severity: number
  gameTimeSec: number
  autoDetected: boolean
  note: string | null
  recordingId: string | null
  /** P(win) was < 0.18 or > 0.85 just before: excluded from the win-rate ratios. */
  garbageTime?: boolean
  /** Tier of this occurrence (docs/design/TIERS_ERREURS_LABO.md): null / absent = unknown (no timeline, the gold gap cannot be computed). */
  tier?: MistakeTier | null
  /** Why the tier (null for « medium »). */
  tierReason?: TierReason | null
  game: { id: string; champion: string; opponentChampion: string | null; win: boolean; gameEndAt: string; duration: number }
}

export type MistakeFamily = 'vision' | 'deaths' | 'tempo' | 'mechanics'
export const FAMILIES: MistakeFamily[] = ['deaths', 'vision', 'tempo', 'mechanics']

const FAMILY_BY_SLUG: Record<string, MistakeFamily> = {
  'forgot-trinket': 'vision', 'no-ward-pre-obj': 'vision', 'walked-into-ward': 'vision', 'face-checked': 'vision', 'no-vision-objective': 'vision',
  'death-before-objective': 'deaths', 'dead-during-objective': 'deaths', 'caught-out': 'deaths', 'dove-tower': 'deaths', 'solo-baron-died': 'deaths', 'bad-positioning': 'deaths',
  'behind-on-levels-death': 'deaths', 'bad-threat-assessment': 'deaths', 'bad-engage-angle': 'deaths',
  'overstay': 'tempo', 'late-back': 'tempo', 'unused-gold': 'tempo', 'bad-wave-sync': 'tempo',
  'cs-deficit': 'mechanics', 'xp-deficit': 'mechanics', 'bad-trade': 'mechanics', 'whiff-skillshot': 'mechanics', 'bad-kiting': 'mechanics',
  'wasted-summoner': 'mechanics', 'bad-dmg-maximisation': 'mechanics', 'bad-lane-opening': 'mechanics', 'bad-rune-choice': 'mechanics',
}
const FAMILY_BY_CATEGORY: Record<string, MistakeFamily> = { vision: 'vision', economy: 'tempo', macro: 'tempo', micro: 'mechanics', draft: 'mechanics' }

export function tagFamily(slug: string, category: string): MistakeFamily {
  return FAMILY_BY_SLUG[slug] ?? FAMILY_BY_CATEGORY[category] ?? 'mechanics'
}

/** Fixed severity colors (not themed — they carry meaning, like win/loss):
 *  crimson = costs fights/objectives, amber = vision/tempo, cyan = micro. */
export const FAMILY_COLOR: Record<MistakeFamily, string> = {
  deaths: '#F43F5E',
  vision: '#F59E0B',
  tempo: '#F59E0B',
  mechanics: '#38BDF8',
}

export interface RankedMistake {
  tagId: string
  slug: string
  label: string
  family: MistakeFamily
  color: string
  count: number
  /** Share of all occurrences in the window, 0–100. */
  share: number
  /** Distinct games where it happened. */
  games: number
  /** Win rate in games with this mistake vs analysed games without it;
   *  null below 2 games on either side. */
  winrateWith: number | null
  winrateWithout: number | null
  /** Games each side of the comparison is made of (decisive games with the mistake / analysed games without it). */
  gamesWith: number
  gamesWithout: number
  /** The occurrences counted in this row, by tier (what the segmented bar draws). */
  tiers: TierCounts
}

/** Below this many analysed games WITHOUT the mistake, the with/without comparison says nothing: the screen qualifies or hides it. */
export const MIN_GAMES_WITHOUT = 3

/** True when the with/without comparison rests on enough games on both sides. */
export const hasComparison = (r: Pick<RankedMistake, 'winrateWith' | 'winrateWithout' | 'gamesWithout'>): boolean =>
  r.winrateWith != null && r.winrateWithout != null && r.gamesWithout >= MIN_GAMES_WITHOUT

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

/** Analysed games = games with at least one tagged mistake in the window
 *  (untagged games were simply not reviewed, so they can't be "without").
 *  Garbage-time occurrences count in the totals but not in the win-rate
 *  ratios: a game where the tag only shows up in garbage time sits on
 *  neither side for that tag. */
export function rankMistakes(occ: MistakeOccurrence[], tier: TierFilter = 'all'): RankedMistake[] {
  const games = new Map<string, boolean>()
  for (const o of occ) games.set(o.game.id, o.game.win)
  // What the rows count: every tier but the trivial ones by default (Engine report 28/11 § 4), or the one tier picked.
  const scoped = occ.filter((o) => inTierScope(o, tier))
  const byTag = new Map<string, { o: MistakeOccurrence; count: number; gameIds: Set<string>; tiers: TierCounts }>()
  for (const o of scoped) {
    const e = byTag.get(o.tag.id) ?? { o, count: 0, gameIds: new Set<string>(), tiers: emptyTierCounts() }
    e.count++
    e.gameIds.add(o.game.id)
    e.tiers[tierKeyOf(o)]++
    byTag.set(o.tag.id, e)
  }
  // The win-rate cost never moves with the tier filter, and leaves out the trivial mistakes (they only happen in games already going badly).
  const decisiveOf = new Map<string, Set<string>>()
  const everIds = new Map<string, Set<string>>()
  for (const o of occ) {
    const all = everIds.get(o.tag.id) ?? new Set<string>()
    all.add(o.game.id); everIds.set(o.tag.id, all)
    if (!o.garbageTime && o.tier !== 'trivial') { const d = decisiveOf.get(o.tag.id) ?? new Set<string>(); d.add(o.game.id); decisiveOf.set(o.tag.id, d) }
  }
  const total = scoped.length
  return [...byTag.values()]
    .map(({ o, count, gameIds, tiers }) => {
      const withIds = [...(decisiveOf.get(o.tag.id) ?? [])]
      const everIdsOfTag = everIds.get(o.tag.id) ?? new Set<string>()
      const withoutIds = [...games.keys()].filter((id) => !everIdsOfTag.has(id))
      const wr = (ids: string[]) => (ids.length >= 2 ? pct(ids.filter((id) => games.get(id)).length, ids.length) : null)
      const family = tagFamily(o.tag.slug, o.tag.category)
      return {
        tagId: o.tag.id, slug: o.tag.slug, label: o.tag.label, family, color: FAMILY_COLOR[family],
        count, share: pct(count, total), games: gameIds.size,
        winrateWith: wr(withIds), winrateWithout: wr(withoutIds), gamesWith: withIds.length, gamesWithout: withoutIds.length, tiers,
      }
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/* ── Tiers (docs/design/TIERS_ERREURS_LABO.md) ── */

export const TIERS: readonly MistakeTier[] = ['fatal', 'critical', 'medium', 'trivial']
export type TierKey = MistakeTier | 'unknown'
export type TierFilter = 'all' | MistakeTier
export type TierCounts = Record<TierKey, number>
/** Pips of a tier (●●● ●●○ ●○○ ○○○) and the opacity of its bar segment (the trivial one is an outline). */
export const TIER_PIPS: Record<MistakeTier, number> = { fatal: 3, critical: 2, medium: 1, trivial: 0 }
export const TIER_OPACITY: Record<MistakeTier, number> = { fatal: 1, critical: 0.6, medium: 0.3, trivial: 0 }
export const pipsOf = (tier: MistakeTier): string => '●'.repeat(TIER_PIPS[tier]) + '○'.repeat(3 - TIER_PIPS[tier])

export const emptyTierCounts = (): TierCounts => ({ fatal: 0, critical: 0, medium: 0, trivial: 0, unknown: 0 })
export const tierKeyOf = (o: Pick<MistakeOccurrence, 'tier'>): TierKey => o.tier ?? 'unknown'
/** « All tiers » leaves the trivial mistakes out of the ranking (visible with their own filter); a picked tier keeps only that tier. */
export const inTierScope = (o: Pick<MistakeOccurrence, 'tier'>, tier: TierFilter): boolean => (tier === 'all' ? o.tier !== 'trivial' : o.tier === tier)

export function tierCounts(occ: Array<Pick<MistakeOccurrence, 'tier'>>): TierCounts {
  const c = emptyTierCounts()
  for (const o of occ) c[tierKeyOf(o)]++
  return c
}

/** True when at least one occurrence carries a tier: the tier controls only show then (older data = no tiers). */
export const hasTiers = (occ: Array<Pick<MistakeOccurrence, 'tier'>>): boolean => occ.some((o) => o.tier != null)

/** Segments of a bar, in the fixed order fatal → critical → medium → trivial → unknown, empty ones left out. */
export function tierSegments(c: TierCounts): Array<{ tier: TierKey; n: number }> {
  return ([...TIERS, 'unknown'] as TierKey[]).map((tier) => ({ tier, n: c[tier] })).filter((x) => x.n > 0)
}

export type RankSort = 'frequency' | 'severity'
/** By frequency (default), or by gravity: most fatal first, then critical, then medium, then count. */
export function sortRanking(rows: RankedMistake[], sort: RankSort): RankedMistake[] {
  if (sort === 'frequency') return rows
  return [...rows].sort((a, b) => b.tiers.fatal - a.tiers.fatal || b.tiers.critical - a.tiers.critical || b.tiers.medium - a.tiers.medium || b.count - a.count || a.label.localeCompare(b.label))
}

export type Phase = 'early' | 'mid' | 'late'
export const PHASES: Phase[] = ['early', 'mid', 'late']
/** 0–14 min laning, 14–25 mid game, 25+ late (Baron/Elder). */
export function phaseOf(gameTimeSec: number): Phase {
  return gameTimeSec < 14 * 60 ? 'early' : gameTimeSec < 25 * 60 ? 'mid' : 'late'
}

export function phaseBreakdown(occ: MistakeOccurrence[]): Record<Phase, number> {
  const out: Record<Phase, number> = { early: 0, mid: 0, late: 0 }
  for (const o of occ) out[phaseOf(o.gameTimeSec)]++
  return out
}

export interface TrendPoint { label: string; counts: Record<string, number> }

/** Per-day when the data spans at least `minDays` distinct days, otherwise
 *  per game (oldest → newest) so a 2-day history never renders as a 30-day
 *  axis with everything crammed on the right. */
export function buildTrend(occ: MistakeOccurrence[], slugs: string[], minDays = 5): { mode: 'day' | 'game'; points: TrendPoint[] } {
  const rel = occ.filter((o) => slugs.includes(o.tag.slug))
  const days = new Set(occ.map((o) => o.game.gameEndAt.slice(0, 10)))
  const mode: 'day' | 'game' = days.size >= minDays ? 'day' : 'game'
  const key = (o: MistakeOccurrence) => (mode === 'day' ? o.game.gameEndAt.slice(0, 10) : o.game.id)
  // Every bucket that had any analysed game, so zero-mistake games show as 0.
  const order = [...new Map(
    [...occ].sort((a, b) => a.game.gameEndAt.localeCompare(b.game.gameEndAt)).map((o) => [key(o), o] as const),
  ).values()]
  const points = order.map((o, i) => {
    const k = key(o)
    const counts: Record<string, number> = {}
    for (const s of slugs) counts[s] = rel.filter((r) => key(r) === k && r.tag.slug === s).length
    return { label: mode === 'day' ? k.slice(5) : `#${i + 1}`, counts }
  })
  return { mode, points }
}

/** The latest occurrences of one tag, newest first. */
export function latestMoments(occ: MistakeOccurrence[], slug: string, n = 3): MistakeOccurrence[] {
  return occ
    .filter((o) => o.tag.slug === slug)
    .sort((a, b) => b.game.gameEndAt.localeCompare(a.game.gameEndAt) || b.gameTimeSec - a.gameTimeSec)
    .slice(0, n)
}

export const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
