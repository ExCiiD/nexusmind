/**
 * What the Champion Pool board shows for one player's pool (Coaching &
 * Management → Champion Pool, src/pages/Team/ChampPoolTab.tsx): tier
 * colours, entries grouped by tier, the share of games per champion and
 * per tier, and the small facts a tile prints (new since, inactive for).
 * Pure; the tiers themselves come from src/lib/threatCore.ts.
 */
import type { ChampionPoolEntry } from './ipc'
import { TIERS, isTier, type Tier } from './threatCore'

/** One colour per tier, the same in every theme (Penpot "Champion Pool v2"). */
export const TIER_COLOR: Record<Tier, string> = {
  main: '#E0B054',
  new: '#5BC8AF',
  comfort: '#6FA0D8',
  flex: '#B99AE0',
  learning: '#8A8072',
}

/** Tiers a user can pick by hand. "new" comes from the game dates only: set
 *  by hand it would never expire (and the shared web tables refuse it). */
export const MANUAL_TIERS: readonly Tier[] = ['main', 'comfort', 'flex', 'learning']

const DAY_MS = 86_400_000
/** A main or comfort not played for this long reads "inactive" (threatCore STALE_DAYS). */
export const INACTIVE_DAYS = 30

const timeOf = (d: string | Date | null | undefined): number | null => {
  if (!d) return null
  const t = new Date(d).getTime()
  return Number.isFinite(t) ? t : null
}

export const gamesOf = (e: Pick<ChampionPoolEntry, 'playRate'>): number => Math.max(0, e.playRate ?? 0)
export const tierOf = (e: Pick<ChampionPoolEntry, 'tier'>): Tier => (isTier(e.tier) ? e.tier : 'flex')

/** Entries per tier, most played first (then mastery, then name). */
export function groupByTier(entries: ChampionPoolEntry[]): Record<Tier, ChampionPoolEntry[]> {
  const out = Object.fromEntries(TIERS.map((t) => [t, [] as ChampionPoolEntry[]])) as Record<Tier, ChampionPoolEntry[]>
  for (const e of entries) out[tierOf(e)].push(e)
  for (const t of TIERS) {
    out[t].sort((a, b) => gamesOf(b) - gamesOf(a) || (b.masteryPoints ?? 0) - (a.masteryPoints ?? 0) || a.championKey.localeCompare(b.championKey))
  }
  return out
}

export function tierCounts(entries: ChampionPoolEntry[]): Record<Tier, number> {
  const out = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>
  for (const e of entries) out[tierOf(e)]++
  return out
}

export interface PoolSegment {
  entry: ChampionPoolEntry
  tier: Tier
  games: number
  /** 0-1 share of the pool's games. */
  share: number
}

export interface PoolSummary {
  /** Games behind the entries (auto-filled or scouted ones). */
  games: number
  /** When auto-fill or scouting last wrote this pool (ms), null when never. */
  updatedAt: number | null
  /** Most recent analysed game of any champion (ms), null without dates. */
  latestPlay: number | null
  /** One segment per champion with games, in tier order then most played first. */
  segments: PoolSegment[]
  /** 0-1 share of the games per tier. */
  tierShare: Record<Tier, number>
  /** 0-1 share of the games the 3 most-played champions account for. */
  top3Share: number
  /** True when at least one entry came from Riot (auto-fill / scouting). */
  fetched: boolean
}

export function summarizePool(entries: ChampionPoolEntry[]): PoolSummary {
  const fromRiot = entries.filter((e) => e.playRate != null)
  const games = entries.reduce((sum, e) => sum + gamesOf(e), 0)
  const updates = fromRiot.map((e) => timeOf(e.updatedAt)).filter((t): t is number => t != null)
  const plays = entries.map((e) => timeOf(e.lastPlayedAt)).filter((t): t is number => t != null)
  const grouped = groupByTier(entries.filter((e) => gamesOf(e) > 0))
  const segments = TIERS.flatMap((tier) => grouped[tier].map((entry) => ({
    entry, tier, games: gamesOf(entry), share: games > 0 ? gamesOf(entry) / games : 0,
  })))
  const tierShare = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>
  for (const s of segments) tierShare[s.tier] += s.share
  const top3 = [...segments].sort((a, b) => b.games - a.games).slice(0, 3)
  return {
    games,
    updatedAt: updates.length ? Math.max(...updates) : null,
    latestPlay: plays.length ? Math.max(...plays) : null,
    segments,
    tierShare,
    top3Share: top3.reduce((sum, s) => sum + s.share, 0),
    fetched: fromRiot.length > 0,
  }
}

/** Days since a "new" pick's first analysed game, null otherwise. */
export function newSinceDays(e: Pick<ChampionPoolEntry, 'tier' | 'firstPlayedAt'>, now = Date.now()): number | null {
  const first = timeOf(e.firstPlayedAt)
  if (e.tier !== 'new' || first == null) return null
  return Math.max(1, Math.round((now - first) / DAY_MS))
}

/** Days a champion has gone unplayed while the player kept playing, when
 *  that is INACTIVE_DAYS or more; null otherwise. */
export function inactiveDays(e: Pick<ChampionPoolEntry, 'lastPlayedAt'>, latestPlay: number | null): number | null {
  const last = timeOf(e.lastPlayedAt)
  if (last == null || latestPlay == null) return null
  const days = Math.floor((latestPlay - last) / DAY_MS)
  return days >= INACTIVE_DAYS ? days : null
}

/** The tier the rule computed, when the shown one was picked by hand. */
export function ruleTierIfHandPicked(e: Pick<ChampionPoolEntry, 'tier' | 'autoTier'>): Tier | null {
  return e.autoTier && e.autoTier !== e.tier && isTier(e.autoTier) ? e.autoTier : null
}
