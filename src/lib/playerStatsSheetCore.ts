/**
 * « Stats individuelles » sheet of one player, for a whole session or one game (contract docs/contracts/player-session-stats.md).
 * Pure, shared desktop / web, no Riot call, no I/O. Nothing is recomputed here: team sessions read what
 * `teamSessionHistoryDetail` already holds (`whole` / `games[]`, built by buildSideStats / buildDuelRows / mergePlayerStats)
 * through `selectGame`; solo sessions read the games already stored locally (Game of useSessionStore).
 *
 * Named apart from playerSessionStatsCore.ts (timeline-based isolation / radar figures of the « Stats indiv joueur » lot).
 */
import type { SynergyPlayerStats } from './synergyStats'
import type { HistoryGame, TeamSessionHistoryDetail } from './teamSessionHistory'
import { selectGame } from './teamSessionHistoryView'
import { mergePlayerStats } from './teamSessionHistoryCore'
import type { DuelRow } from './teamSessionStatsCore'

/** ready: stats computed; not-fetched: match not cached yet; no-side: our side not found; error: not found at Riot. */
export type SheetGameStatus = 'ready' | 'not-fetched' | 'no-side' | 'error'

/** One game of the chart. Numbers are null unless the game is ready and the player played it. */
export interface SheetGamePoint {
  gameId: string
  /** 1, 2, 3… in the order played. */
  index: number
  status: SheetGameStatus
  /** The player has a line in this game (false: absent from the five, or the game has no stats). */
  played: boolean
  win: boolean | null
  durationSec: number | null
  championKey: string | null
  kda: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  cs: number | null
  csPerMin: number | null
  damagePerMin: number | null
  goldPerMin: number | null
  visionScore: number | null
  kpPct: number | null
  damagePct: number | null
}

export interface PlayerStatsSheet {
  source: 'team' | 'solo'
  userId: string
  /** The picked game (1-based), null for the whole session. */
  gameIndex: number | null
  /**
   * A picked game: its status, or 'unknown-game' (index not in the session). The whole session: 'ready' when at least one
   * game has stats, else the status shared by the games, else 'no-data' (no game at all).
   */
  status: SheetGameStatus | 'no-data' | 'unknown-game'
  /** The player has a line in the numbers shown. */
  playerFound: boolean
  /** The player's line: one game, or the mean per game over the games he played (gamesPlayed = those games). Null if none. */
  line: SynergyPlayerStats | null
  /** The player's lane opponent (one game), or the lane opponent combined by role (session). Null without one. */
  duel: DuelRow | null
  /** Every game of the session, in order, for the chart (the picked game too: the Front highlights it). */
  series: SheetGamePoint[]
  /** line.averages, for convenience (null without a line). */
  averages: SynergyPlayerStats['averages'] | null
  /** Games behind `line`: those the player played with stats (1 or 0 for a picked game). */
  gamesCounted: number
  /** Games of the session. */
  gamesTotal: number
  /** Games with stats in the session (the denominator of « 3 / 4 games »), whoever played. */
  gamesWithStats: number
  /**
   * True when only part of the figures exist (solo: kills, deaths, assists, CS, vision, duration; the fields of
   * `missing` are 0 in `line` and must not be shown).
   */
  partial: boolean
  missing: Array<keyof SynergyPlayerStats['averages'] | 'shares' | 'duel'>
}

const NONE = (g: Pick<HistoryGame, 'gameId' | 'index' | 'stats' | 'win' | 'durationSec'>): SheetGamePoint => ({
  gameId: g.gameId, index: g.index, status: g.stats, played: false, win: g.win, durationSec: g.durationSec, championKey: null,
  kda: null, kills: null, deaths: null, assists: null, cs: null, csPerMin: null, damagePerMin: null, goldPerMin: null,
  visionScore: null, kpPct: null, damagePct: null,
})

function pointOf(base: SheetGamePoint, line: SynergyPlayerStats | undefined): SheetGamePoint {
  if (!line) return base
  const a = line.averages
  return {
    ...base, played: true, championKey: line.byChampion[0]?.championKey ?? null,
    kda: a.kda, kills: a.kills, deaths: a.deaths, assists: a.assists, cs: a.cs, csPerMin: a.csPerMin,
    damagePerMin: a.damagePerMin, goldPerMin: a.goldPerMin, visionScore: a.visionScore, kpPct: line.shares.kpPct, damagePct: line.shares.damagePct,
  }
}

/** The status of the whole session from its games' statuses. */
function sessionStatus(statuses: SheetGameStatus[]): PlayerStatsSheet['status'] {
  if (statuses.length === 0) return 'no-data'
  if (statuses.includes('ready')) return 'ready'
  // Nothing ready: the most actionable reason first (a fetch is pending before anything is wrong).
  for (const s of ['not-fetched', 'no-side', 'error'] as const) if (statuses.includes(s)) return s
  return 'no-data'
}

/**
 * Team session: the sheet of `userId` (group_members.user_id = SynergyPlayerStats.memberId on our side) for the game
 * `gameIndex` (HistoryGame.index), or for the whole session when null. One session belongs to one group: a user in
 * several groups gets one sheet per session, with the detail of that session.
 */
export function buildPlayerStatsSheet(
  detail: Pick<TeamSessionHistoryDetail, 'games' | 'whole'>,
  userId: string,
  gameIndex: number | null,
): PlayerStatsSheet {
  const series = detail.games.map((g) => {
    const base = NONE(g)
    return g.stats === 'ready' ? pointOf(base, g.players.find((p) => p.memberId === userId)) : base
  })
  const sel = selectGame(detail, gameIndex)
  const line = sel.players.find((p) => p.memberId === userId) ?? null
  const duel = line ? sel.duels.find((d) => d.our?.memberId === userId) ?? null : null
  const gamesWithStats = detail.games.filter((g) => g.stats === 'ready').length
  const status: PlayerStatsSheet['status'] = gameIndex != null
    ? (sel.game ? sel.game.stats : 'unknown-game')
    : sessionStatus(detail.games.map((g) => g.stats))
  return {
    source: 'team', userId, gameIndex, status, playerFound: !!line, line,
    duel: duel && (duel.enemy || duel.our) ? duel : null,
    series, averages: line?.averages ?? null,
    gamesCounted: line?.gamesPlayed ?? 0, gamesTotal: detail.games.length, gamesWithStats,
    partial: false, missing: [],
  }
}

// ── Solo ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The fields of a stored solo game (useSessionStore Game) this needs; stats are optional like in the store's older rows. */
export interface SoloGameInput {
  id: string
  champion: string
  role?: string
  win: boolean
  kills?: number
  deaths?: number
  assists?: number
  cs?: number
  visionScore?: number
  /** Seconds. */
  duration?: number
  gameEndAt: string
}

const SOLO_MISSING: PlayerStatsSheet['missing'] = [
  'damage', 'damagePerMin', 'damageTaken', 'ccTime', 'wardsPlaced', 'wardsKilled', 'controlWards', 'gold', 'goldPerMin', 'xpPerMin',
  'damagePerGold', 'shares', 'duel',
]

function soloLine(g: SoloGameInput, userId: string): SynergyPlayerStats {
  const k = g.kills ?? 0, d = g.deaths ?? 0, a = g.assists ?? 0, cs = g.cs ?? 0
  const min = (g.duration ?? 0) / 60
  return {
    memberId: userId, displayName: '', role: g.role ?? '', gamesPlayed: 1, wins: g.win ? 1 : 0, winRate: g.win ? 100 : 0,
    averages: {
      kda: d > 0 ? (k + a) / d : k + a, kills: k, deaths: d, assists: a, cs, csPerMin: min > 0 ? cs / min : 0,
      damage: 0, damagePerMin: 0, damageTaken: 0, ccTime: 0, visionScore: g.visionScore ?? 0, wardsPlaced: 0, wardsKilled: 0,
      controlWards: 0, gold: 0, goldPerMin: 0, xpPerMin: 0, damagePerGold: 0,
    },
    shares: { damagePct: 0, goldPct: 0, visionPct: 0, damageTakenPct: 0, ccPct: 0, kpPct: 0 },
    byChampion: [{ championKey: g.champion || 'Unknown', games: 1, wins: g.win ? 1 : 0, winRate: g.win ? 100 : 0 }],
  }
}

/**
 * Solo session: the same sheet from the games already stored locally (no Riot call). The games are put in the order
 * played (`gameEndAt`), `gameIndex` is the 1-based rank in that order. A game without kills / deaths / assists is
 * 'not-fetched' (no stats stored). Gold, damage, shares and the duel are not stored for solo games: `partial` and
 * `missing` say so, and `duel` is null.
 */
export function buildSoloPlayerStatsSheet(games: readonly SoloGameInput[], userId: string, gameIndex: number | null): PlayerStatsSheet {
  const ordered = [...games].sort((a, b) => Date.parse(a.gameEndAt) - Date.parse(b.gameEndAt))
  const has = (g: SoloGameInput) => g.kills !== undefined && g.deaths !== undefined && g.assists !== undefined
  const points = ordered.map((g, i) => {
    const base = NONE({ gameId: g.id, index: i + 1, stats: has(g) ? 'ready' : 'not-fetched', win: has(g) ? g.win : null, durationSec: g.duration && g.duration > 0 ? g.duration : null })
    return has(g) ? pointOf(base, soloLine(g, userId)) : base
  })
  const lines = ordered.map((g) => (has(g) ? soloLine(g, userId) : null))
  const picked = gameIndex != null ? ordered[gameIndex - 1] ?? null : null
  const known = gameIndex == null || (Number.isInteger(gameIndex) && !!picked)
  const chosen = gameIndex != null
    ? (known && lines[gameIndex - 1] ? [lines[gameIndex - 1]!] : [])
    : lines.filter((l): l is SynergyPlayerStats => !!l)
  const line = chosen.length ? mergePlayerStats([chosen], (p) => p.memberId)[0] : null
  const status: PlayerStatsSheet['status'] = gameIndex != null
    ? (known ? points[gameIndex - 1].status : 'unknown-game')
    : sessionStatus(points.map((p) => p.status))
  return {
    source: 'solo', userId, gameIndex, status, playerFound: !!line, line, duel: null, series: points,
    averages: line?.averages ?? null, gamesCounted: line?.gamesPlayed ?? 0, gamesTotal: ordered.length,
    gamesWithStats: points.filter((p) => p.status === 'ready').length,
    partial: true, missing: SOLO_MISSING,
  }
}
