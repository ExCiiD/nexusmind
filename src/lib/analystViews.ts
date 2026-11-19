/**
 * #40, the three analyst screens (docs/DESIGN_STATE.md §§ 10-12): display helpers only. The data shapes are the
 * Back-end contract (src/lib/analyst.ts) and the computations its Cores (teamTimelineCore, draftLogCore,
 * opponentDossierCore). Pure, tested.
 */
import type { TeamObjectivesFilters, TeamGameSource } from './analyst'

/** A 0-1 share as a 0-100 percentage (null stays null). */
export const pct = (share: number | null | undefined): number | null => (share == null ? null : share * 100)

/** "08:42" from seconds (a timing on the frieze or in the table). */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** "−1:15" / "+0:40": ours − theirs, signed (negative = we take it earlier). */
export function signedClockDiff(oursSec: number, theirsSec: number): string {
  const d = Math.round(oursSec - theirsSec)
  const a = Math.abs(d)
  return `${d < 0 ? '−' : d > 0 ? '+' : '±'}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`
}

/** "+1 240" style signed gold (the gold curve's 10 / 15 / 20 min values). */
export function signedGold(v: number): string {
  const r = Math.round(v)
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toLocaleString('fr-FR').replace(/\s/g, ' ')}`
}

/** Frieze ticks every 5 minutes inside the game. */
export function friezeTicks(durationSec: number): number[] {
  const out: number[] = []
  for (let m = 5; m * 60 < durationSec; m += 5) out.push(m)
  return out
}

/** The Objectives tab's period control. */
export type Period = '7d' | '30d' | 'season' | 'custom'

export interface ObjectivesFilterState {
  period: Period
  /** YYYY-MM-DD, for 'custom'. */
  from?: string
  to?: string
  sources: TeamGameSource[]
  side: TeamObjectivesFilters['side']
}

export const DEFAULT_OBJECTIVES_FILTERS: ObjectivesFilterState = { period: '30d', sources: ['scrim', 'tournament'], side: 'both' }

/** The UI filters as the contract's TeamObjectivesFilters (period → dates; the season starts on 1 January, UTC). */
export function toTeamObjectivesFilters(f: ObjectivesFilterState, now: Date = new Date()): TeamObjectivesFilters {
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const base = { sources: f.sources, side: f.side }
  switch (f.period) {
    case '7d': return { ...base, from: day(new Date(now.getTime() - 7 * 86_400_000)) }
    case '30d': return { ...base, from: day(new Date(now.getTime() - 30 * 86_400_000)) }
    case 'season': return { ...base, from: `${now.getUTCFullYear()}-01-01` }
    case 'custom': return { ...base, ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) }
  }
}

/** § 12: the game plan's limit (the contract stores up to 600 characters). */
export const GAME_PLAN_MAX = 600

// ── § 11 pick order ────────────────────────────────────────────────────────

/** The draft's pick slots in order (B1 R1 R2 B2 B3 R3 R4 B4 B5 R5). */
export const PICK_SEQUENCE = ['B1', 'R1', 'R2', 'B2', 'B3', 'R3', 'R4', 'B4', 'B5', 'R5'] as const

/**
 * The blue and red picks in their pick order (B1…B5, R1…R5), from a stored `pickOrder` (10 names along
 * PICK_SEQUENCE). Without a stored order, each side's picks in role order (top → support). Pure.
 */
export function pickOrderSides(
  pickOrder: string[] | null,
  side: 'blue' | 'red',
  ourPicks: Array<{ champion: string }>,
  theirPicks: Array<{ champion: string }>,
): { blue: string[]; red: string[] } {
  const ours = ourPicks.map((p) => p.champion)
  const theirs = theirPicks.map((p) => p.champion)
  const byRole = side === 'blue' ? { blue: ours, red: theirs } : { blue: theirs, red: ours }
  if (!pickOrder || pickOrder.length !== PICK_SEQUENCE.length) return byRole
  const blue: string[] = []
  const red: string[] = []
  PICK_SEQUENCE.forEach((slot, i) => (slot.startsWith('B') ? blue : red).push(pickOrder[i]))
  // A stored order that no longer matches the picks (a pick edited since) falls back to role order.
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
  return same(blue, byRole.blue) && same(red, byRole.red) ? { blue, red } : byRole
}

/** The 10 names along PICK_SEQUENCE, from each side's pick order. Pure. */
export function joinPickOrder(blue: string[], red: string[]): string[] {
  let b = 0, r = 0
  return PICK_SEQUENCE.map((slot) => (slot.startsWith('B') ? blue[b++] : red[r++])).filter((x): x is string => !!x)
}

/** `list` with the item at `from` moved to `to` (clamped). Pure. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const target = Math.max(0, Math.min(next.length - 1, to))
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}
