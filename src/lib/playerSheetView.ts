/**
 * Pure helpers of the player sheet's display (docs/contracts/player-session-stats.md part B). Front side only: nothing
 * here computes a statistic, it sorts, groups and adapts what the Back already computed (playerSessionStatsCore).
 * A null stays null (never 0): the components print « — ».
 */
import type { SynergyPlayerStats } from './synergyStats'
import type { EventSummary, MapZone, PlayerEvent, PlayerSessionStats, UnavailableGame } from './playerSessionStatsCore'
import type { PlayerStatsSheet, SheetGamePoint } from './playerStatsSheetCore'
import { mergePlayerStats } from './teamSessionHistoryCore'

/** Deaths or kills split the way the sheet lists them. `unknown` = after 14:00 with no position (never counted as « not isolated »). */
export interface EventGroups {
  early: PlayerEvent[]
  isolatedLate: PlayerEvent[]
  unknownLate: PlayerEvent[]
  otherLate: PlayerEvent[]
}

export function groupEvents(events: readonly PlayerEvent[] | null | undefined): EventGroups | null {
  if (!events) return null
  const out: EventGroups = { early: [], isolatedLate: [], unknownLate: [], otherLate: [] }
  for (const e of events) {
    if (e.early) out.early.push(e)
    else if (e.isolated === true) out.isolatedLate.push(e)
    else if (e.isolated === null) out.unknownLate.push(e)
    else out.otherLate.push(e)
  }
  return out
}

/** Kills the sheet lists: the isolated ones at any minute (isolated === true); null = position unknown, kept apart. */
export function groupKills(events: readonly PlayerEvent[] | null | undefined): { isolated: PlayerEvent[]; unknown: PlayerEvent[]; other: PlayerEvent[] } | null {
  if (!events) return null
  return {
    isolated: events.filter((e) => e.isolated === true),
    unknown: events.filter((e) => e.isolated === null),
    other: events.filter((e) => e.isolated === false),
  }
}

/** Same counts as the Back's EventSummary, for one game's events (the session uses `total.deaths` / `total.kills`). */
export function summarizeEvents(events: readonly PlayerEvent[] | null | undefined): EventSummary | null {
  if (!events) return null
  const byZone: Partial<Record<MapZone, number>> = {}
  for (const e of events) if (e.zone) byZone[e.zone] = (byZone[e.zone] ?? 0) + 1
  return {
    total: events.length, early: events.filter((e) => e.early).length,
    isolated: events.filter((e) => e.isolated === true).length, judged: events.filter((e) => e.isolated !== null).length, byZone,
  }
}

/** Zones of a summary, most frequent first. */
export function zonesOf(s: EventSummary | null): Array<[MapZone, number]> {
  return s ? (Object.entries(s.byZone) as Array<[MapZone, number]>).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : []
}

/**
 * The Review player's address for a moment of a recorded game. `vodSeekSec` is game time (Back: atSec − 10 s); the player
 * (RecordPlayerPage `?at=`) turns it into video time with THIS recording's offset (eventSync.deriveOffsetSec), so the
 * offset of the game is never applied twice.
 */
export function vodHref(recordingId: string, vodSeekSec: number): string {
  return `/record/${encodeURIComponent(recordingId)}?at=${Math.max(0, Math.round(vodSeekSec))}`
}

/** Runs of consecutive known values of a per-minute series (a null breaks the line: a gap is never drawn as 0). */
export function seriesRuns(values: ReadonlyArray<number | null>): Array<Array<{ minute: number; value: number }>> {
  const runs: Array<Array<{ minute: number; value: number }>> = []
  let cur: Array<{ minute: number; value: number }> = []
  values.forEach((v, minute) => {
    if (v == null || !Number.isFinite(v)) { if (cur.length) runs.push(cur); cur = [] } else cur.push({ minute, value: v })
  })
  if (cur.length) runs.push(cur)
  return runs
}

/** (value − reference) / |reference| × 100, null when either is missing or the reference is 0. */
export function relDeltaPct(value: number | null | undefined, reference: number | null | undefined): number | null {
  if (value == null || reference == null || !Number.isFinite(value) || !Number.isFinite(reference) || reference === 0) return null
  return ((value - reference) / Math.abs(reference)) * 100
}

/** Share of the objectives a player was part of: participated / ours, null when the team took none. */
export function participationPct(line: { ours: number; participated: number }): number | null {
  return line.ours > 0 ? Math.round((line.participated / line.ours) * 100) : null
}

/** Seconds as m:ss. */
export function mmss(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── Solo: the full PlayerSessionStats as the sheet's PlayerStatsSheet ───────────────────────────────────────────

function pointOf(g: PlayerSessionStats['games'][number]): SheetGamePoint {
  const a = g.base.averages
  return {
    gameId: g.gameId, index: g.gameIndex, status: 'ready', played: true, win: g.win, durationSec: g.durationSec, championKey: g.championKey || null,
    kda: a.kda, kills: a.kills, deaths: a.deaths, assists: a.assists, cs: a.cs, csPerMin: a.csPerMin, damagePerMin: a.damagePerMin,
    goldPerMin: a.goldPerMin, visionScore: a.visionScore, kpPct: g.base.shares.kpPct, damagePct: g.base.shares.damagePct,
  }
}

function unavailablePoint(u: UnavailableGame): SheetGamePoint {
  // not-a-player: the game exists and has stats, he just is not in it (a gap, not an error).
  const status: SheetGamePoint['status'] = u.reason === 'no-match' ? 'error' : u.reason === 'no-side' ? 'no-side' : 'ready'
  return {
    gameId: u.gameId, index: u.gameIndex, status, played: false, win: null, durationSec: null, championKey: null,
    kda: null, kills: null, deaths: null, assists: null, cs: null, csPerMin: null, damagePerMin: null, goldPerMin: null,
    visionScore: null, kpPct: null, damagePct: null,
  }
}

/**
 * The sheet of a solo session built from `soloSessionPlayerStats` (full figures: duel, shares, gold, damage… all filled),
 * with the same shape as a team session's. Session = `total.base` (mean per game); the duel's opponent is the mean of the
 * lane opponents met. Unavailable games become gaps of the chart; `partial` stays false (nothing to hide).
 */
export function sheetFromPlayerStats(stats: PlayerSessionStats, gameIndex: number | null): PlayerStatsSheet {
  const series = [...stats.games.map(pointOf), ...stats.unavailableGames.map(unavailablePoint)].sort((a, b) => a.index - b.index)
  const picked = gameIndex != null ? stats.games.find((g) => g.gameIndex === gameIndex) ?? null : null
  const pickedPoint = gameIndex != null ? series.find((p) => p.index === gameIndex) ?? null : null
  let line: SynergyPlayerStats | null = null
  let enemy: SynergyPlayerStats | null = null
  if (gameIndex != null) {
    line = picked?.base ?? null
    enemy = picked?.opponent ?? null
  } else if (stats.games.length) {
    line = stats.total.base
    const opps = stats.games.map((g) => g.opponent).filter((o): o is SynergyPlayerStats => !!o)
    enemy = opps.length ? mergePlayerStats(opps.map((o) => [o]), () => 'opponent')[0] ?? null : null
    if (enemy && new Set(opps.map((o) => o.displayName)).size > 1) enemy = { ...enemy, displayName: '' }
  }
  const status: PlayerStatsSheet['status'] = gameIndex != null
    ? (pickedPoint ? pickedPoint.status : 'unknown-game')
    : series.length === 0 ? 'no-data' : stats.games.length ? 'ready' : (series.find((p) => p.status !== 'ready')?.status ?? 'no-data')
  return {
    source: stats.source, userId: stats.memberId, gameIndex, status, playerFound: !!line, line,
    duel: line && enemy ? { role: line.role, our: line, enemy } : null,
    series, averages: line?.averages ?? null, gamesCounted: gameIndex != null ? (picked ? 1 : 0) : stats.gamesCounted,
    gamesTotal: series.length, gamesWithStats: stats.games.length, partial: false, missing: [],
  }
}
