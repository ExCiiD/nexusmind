import type { DeathBreakdown, DragonType, FightItem, FirstOwner, GameCollective, Pair, SessionCollective, SetupItem } from '@/lib/teamCollectiveStatsCore'

/**
 * What the « Collective stats » block shows, for the whole session or for one game (docs/design/STATS_COLLECTIVES_EQUIPE.md).
 * Pure reading of the Back-end payload (teamCollectiveStatsCore.ts): nothing is recomputed from Riot, only re-grouped.
 * An unknown value is null (shown « — »), never 0.
 */

export type NeutralKey = 'dragons' | 'grubs' | 'herald' | 'baron' | 'elder' | 'towers'
export const OBJECTIVE_ROWS: readonly NeutralKey[] = ['dragons', 'grubs', 'herald', 'baron', 'elder', 'towers']
export type FirstKey = 'blood' | 'tower' | 'dragon' | 'herald'
export const FIRST_KEYS: readonly FirstKey[] = ['blood', 'tower', 'dragon', 'herald']

/** Under this many games the rates read « small sample » (spec § 2). */
export const SMALL_SAMPLE = 5

export type CollectiveScope = { kind: 'session'; c: SessionCollective } | { kind: 'game'; c: SessionCollective; game: GameCollective }

/** The scope of the page: the picked game when the payload has it, the session otherwise. Null = that game is not in the payload. */
export function scopeOf(c: SessionCollective, gameIndex: number | null): CollectiveScope | null {
  if (gameIndex == null) return { kind: 'session', c }
  const game = c.games.find((g) => g.gameIndex === gameIndex)
  return game ? { kind: 'game', c, game } : null
}

const counted = (c: SessionCollective) => c.games.filter((g) => !g.remake)
/** The games the figures of this scope are made of. */
export function scopeGames(s: CollectiveScope): GameCollective[] {
  return s.kind === 'game' ? [s.game] : counted(s.c)
}

/** Share of the neutral objectives taken by us (drakes + grubs + herald + baron + elder; towers are not neutral). */
export function controlShare(rows: Array<{ key: NeutralKey; ours: number; theirs: number }>): { ours: number; theirs: number; pct: number | null } {
  const neutral = rows.filter((r) => r.key !== 'towers')
  const ours = neutral.reduce((s, r) => s + r.ours, 0), theirs = neutral.reduce((s, r) => s + r.theirs, 0)
  return { ours, theirs, pct: ours + theirs > 0 ? (ours / (ours + theirs)) * 100 : null }
}

export interface ObjectivesView {
  rows: Array<{ key: NeutralKey; ours: number; theirs: number }>
  /** Per type; null without a timeline (the match only has totals). */
  types: Array<{ type: DragonType; ours: number; theirs: number }> | null
  /** Session: games where we / they got it, out of the games where it is known. Game: the owner. */
  firsts: Array<{ key: FirstKey; us: number; them: number; games: number; owner: FirstOwner }>
}

const pairOf = (p: Pair | null | undefined): Pair => p ?? { ours: 0, theirs: 0 }

export function objectivesOf(s: CollectiveScope): ObjectivesView {
  if (s.kind === 'session') {
    const o = s.c.objectives
    const types = s.c.gamesWithTimeline > 0 ? (Object.entries(o.dragonsByType) as Array<[DragonType, Pair]>).filter(([, p]) => p.ours + p.theirs > 0).map(([type, p]) => ({ type, ours: p.ours, theirs: p.theirs })) : null
    return {
      rows: OBJECTIVE_ROWS.map((key) => ({ key, ...pairOf(o[key]) })),
      types,
      firsts: FIRST_KEYS.map((key) => ({ key, ...o.firsts[key], owner: null })),
    }
  }
  const o = s.game.objectives
  return {
    rows: OBJECTIVE_ROWS.map((key) => ({ key, ...pairOf(o[key]) })),
    types: o.dragonsByType ? (Object.entries(o.dragonsByType) as Array<[DragonType, Pair]>).filter(([, p]) => p.ours + p.theirs > 0).map(([type, p]) => ({ type, ours: p.ours, theirs: p.theirs })) : null,
    firsts: FIRST_KEYS.map((key) => {
      const owner = o.firsts[key]
      return { key, us: owner === 'us' ? 1 : 0, them: owner === 'them' ? 1 : 0, games: owner ? 1 : 0, owner }
    }),
  }
}

export interface GoldView {
  at10: number | null
  at15: number | null
  at20: number | null
  /** Games lost while ahead at 15:00, out of the games that were ahead. */
  lostWhileAhead: number
  ahead: number
  /** One entry per game of the scope (for the table). */
  perGame: Array<{ gameIndex: number; gameId: string; win: boolean; at10: number | null; at15: number | null; at20: number | null; lostWhileAhead: boolean }>
  known: boolean
}

export function goldOf(s: CollectiveScope): GoldView {
  const games = scopeGames(s)
  const perGame = games.filter((g) => g.goldLead).map((g) => ({
    gameIndex: g.gameIndex, gameId: g.gameId, win: g.win, at10: g.goldLead!.at10, at15: g.goldLead!.at15, at20: g.goldLead!.at20, lostWhileAhead: g.goldLead!.lostWhileAhead === true,
  }))
  if (s.kind === 'game') {
    const l = s.game.goldLead
    return { at10: l?.at10 ?? null, at15: l?.at15 ?? null, at20: l?.at20 ?? null, lostWhileAhead: l?.lostWhileAhead ? 1 : 0, ahead: l?.ahead15 ? 1 : 0, perGame, known: !!l }
  }
  const g = s.c.goldLead
  return { at10: g.avgAt10, at15: g.avgAt15, at20: g.avgAt20, lostWhileAhead: g.lostWhileAhead, ahead: g.ahead15, perGame, known: perGame.length > 0 }
}

export interface ConversionItem extends FightItem { gameIndex: number; gameId: string }
export interface ConversionView {
  fightsWon: number
  converted: number
  ratePct: number | null
  /** Not converted first, then by time. */
  items: ConversionItem[]
  known: boolean
  /** Games the figures come from. */
  games: number
}

export function conversionOf(s: CollectiveScope): ConversionView {
  const games = scopeGames(s).filter((g) => g.conversion)
  const items: ConversionItem[] = games.flatMap((g) => g.conversion!.items.map((i) => ({ ...i, gameIndex: g.gameIndex, gameId: g.gameId })))
  items.sort((a, b) => Number(a.objective !== null) - Number(b.objective !== null) || a.gameIndex - b.gameIndex || a.atSec - b.atSec)
  const fightsWon = games.reduce((n, g) => n + g.conversion!.fightsWon, 0), converted = games.reduce((n, g) => n + g.conversion!.converted, 0)
  return { fightsWon, converted, ratePct: fightsWon > 0 ? (converted / fightsWon) * 100 : null, items, known: games.length > 0, games: games.length }
}

export interface SetupRow extends SetupItem { gameIndex: number; gameId: string }
export interface SetupView {
  rows: SetupRow[]
  taken: number
  avgWards: number | null
  /** « Taken with ≥ 3 wards : x / y · with < 3 : x / y » (proposal 2). */
  withWards: { taken: number; total: number }
  withoutWards: { taken: number; total: number }
  /** Games of the scope with timeline but without ward events (old cache). */
  gamesWithout: number
  /** Game numbers with a timeline but no ward events. */
  missing: number[]
  /** Games the rows come from. */
  games: number
  known: boolean
}

export const WARDS_THRESHOLD = 3

export function setupOf(s: CollectiveScope): SetupView {
  const games = scopeGames(s)
  const withSetup = games.filter((g) => g.setup)
  const rows: SetupRow[] = withSetup.flatMap((g) => g.setup!.items.map((i) => ({ ...i, gameIndex: g.gameIndex, gameId: g.gameId }))).sort((a, b) => a.gameIndex - b.gameIndex || a.atSec - b.atSec)
  const split = (pred: (r: SetupRow) => boolean) => { const l = rows.filter(pred); return { taken: l.filter((r) => r.outcome === 'taken').length, total: l.length } }
  return {
    rows, taken: rows.filter((r) => r.outcome === 'taken').length,
    avgWards: rows.length > 0 ? rows.reduce((n, r) => n + r.wardsPlaced, 0) / rows.length : null,
    withWards: split((r) => r.wardsPlaced >= WARDS_THRESHOLD), withoutWards: split((r) => r.wardsPlaced < WARDS_THRESHOLD),
    gamesWithout: games.filter((g) => g.timeline === 'ready' && !g.setup).length,
    missing: games.filter((g) => g.timeline === 'ready' && !g.setup).map((g) => g.gameIndex), games: withSetup.length,
    known: withSetup.length > 0,
  }
}

export function deathsOf(s: CollectiveScope): DeathBreakdown | null {
  return s.kind === 'game' ? s.game.deaths : s.c.deaths
}

/** « 23 deaths · 9 isolated · 7 after 25′ ». */
export function deathsSummary(d: DeathBreakdown): { total: number; isolated: number; late: number } {
  return { total: d.total, isolated: d.early.isolated + d.mid.isolated + d.late.isolated, late: d.late.isolated + d.late.grouped + d.late.unknown }
}

export interface KpRow { memberId: string; displayName: string; kpPct: number; gapPct: number }
export function kpOf(s: CollectiveScope): KpRow[] {
  return s.kind === 'game' ? s.game.kp : s.c.kp
}

export interface WinRow { games: number; wins: number }
export const winPct = (w: WinRow): number | null => (w.games > 0 ? (w.wins / w.games) * 100 : null)

/** Games of the scope whose timeline is not extracted (the sections Gold, Fights, Setup and Deaths need it). */
export function gamesWithoutTimeline(s: CollectiveScope): GameCollective[] {
  return scopeGames(s).filter((g) => g.timeline !== 'ready')
}

export function headerOf(s: CollectiveScope): { games: number; wins: number; losses: number; blue: WinRow; red: WinRow } {
  if (s.kind === 'game') {
    const w: WinRow = { games: 1, wins: s.game.win ? 1 : 0 }
    return { games: 1, wins: w.wins, losses: 1 - w.wins, blue: s.game.side === 'blue' ? w : { games: 0, wins: 0 }, red: s.game.side === 'red' ? w : { games: 0, wins: 0 } }
  }
  const games = counted(s.c)
  const wins = games.filter((g) => g.win).length
  return { games: games.length, wins, losses: games.length - wins, blue: s.c.bySide.blue, red: s.c.bySide.red }
}

/** How many games each timeline-based figure is made of (« over 2 games » when fewer than the counted ones). */
export function deathsGames(s: CollectiveScope): number {
  return scopeGames(s).filter((g) => g.deaths).length
}
