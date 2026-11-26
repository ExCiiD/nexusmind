/**
 * Individual stats of a player in a team session or a solo session (lots « Stats indiv joueur » and L11b), contracts
 * docs/contracts/team-session-history.md § 7 and docs/contracts/player-session-stats.md part B. Pure, shared by the
 * desktop and the web: the platform loads the games (cached match + timeline summary), this does the rest.
 * Re-exported by teamSessionHistory.ts.
 *
 * Nothing here calls Riot. Timeline-only figures (positions, isolation, deaths before 14:00, diffs at 10 / 15, objectives
 * participation, events) are null when the game's cached summary has no `players` block of the current version; they are
 * never 0.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SynergyPlayerStats } from './synergyStats'
import type { TeamGameTimeline } from './analyst'
import { buildDuelRows, buildSideStats, matchParticipantToMember, participantName, type RiotIdMember, type RiotMatchParticipant } from './teamSessionStatsCore'
import { resolveOurTeamId } from './matchSide'
import { hasCurrentPlayers, isCurrentTimeline } from './teamTimelineCore'
import { fail } from './supabaseErrors'
import { mergePlayerStats } from './teamSessionHistoryCore'
import { zoneOf, type Zone } from './microReview/geometry'

// ── What the timeline summary keeps per player (compact: one value per minute) ──────────────────────────────────

/** One participant's minute-by-minute series (index = minute frame, from 0). Positions are kept for OUR side only. */
export interface TimelinePlayerSeries {
  /** Match participantId (1-10). */
  pid: number
  teamId: 100 | 200
  xp: number[]
  /** totalGold. */
  gold: number[]
  /** Level at each minute (v2). */
  lvl?: number[]
  /** minionsKilled + jungleMinionsKilled at each minute (v2). */
  cs?: number[]
  /** Map position, our side only (map units, 0-15000). */
  x?: number[]
  y?: number[]
}

/** A champion kill (executions, killerId 0, included). `t` is the game time in ms. */
export interface TimelineKillEvent {
  t: number
  killer: number
  victim: number
  assists: number[]
  /** Where the victim died. Null when Riot gave no position. */
  x: number | null
  y: number | null
}

/** An objective taken (v2). `teamId` = the team that took it (a tower: the team that destroyed it). One event per grub / tower. */
export interface TimelineObjectiveEvent {
  t: number
  kind: ObjectiveKind
  teamId: 100 | 200
  killer: number
  assists: number[]
  subType?: string
  lane?: 'TOP' | 'MID' | 'BOT'
}

export interface TimelinePlayers {
  /** Version of the block (teamTimelineCore.PLAYERS_BLOCK_VERSION). Absent = v1 (no levels, CS or objectives). */
  v?: number
  players: TimelinePlayerSeries[]
  kills: TimelineKillEvent[]
  objectives?: TimelineObjectiveEvent[]
}

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Isolation distance D (map units): a death or a kill is "isolated" when no living teammate is within D of it.
 * The map is 14 800 units wide; 2 500 is about two thirds of a lane's length / roughly a flash + auto-attack range
 * chain away, i.e. a teammate that could not realistically reach the fight in time. Tunable here only.
 */
export const ISOLATION_DISTANCE = 2500
/** First 14:00 of the game: deaths earlier than this count as `deathsBefore14`; from here on, isolation is judged. */
export const EARLY_DEATH_LIMIT_MS = 14 * 60 * 1000
/** The VOD is opened this many seconds before an event. */
export const VOD_LEAD_SEC = 10
const MINUTE_MS = 60_000

/**
 * Approximate respawn delay (s) of a champion that died at `atMs`. Riot does not log the death timer, and levels are not
 * tracked per kill, so this is the documented linear approximation 10 s + 1.5 s per minute, capped at 60 s. It only
 * decides whether a teammate is "alive" (dead teammates never count as support).
 */
export function respawnSec(atMs: number): number {
  return Math.min(60, 10 + 1.5 * (atMs / MINUTE_MS))
}

// ── Geometry on the extracted series ───────────────────────────────────────────────────────────────────────────

/** Position of one of our players at `tMs`, interpolated between the two minute frames around it. Null without positions. */
export function positionAt(s: TimelinePlayerSeries | undefined, tMs: number): { x: number; y: number } | null {
  if (!s?.x || !s.y || s.x.length === 0) return null
  const f = Math.min(Math.max(tMs / MINUTE_MS, 0), s.x.length - 1)
  const lo = Math.floor(f), hi = Math.min(lo + 1, s.x.length - 1), k = f - lo
  return { x: s.x[lo] + (s.x[hi] - s.x[lo]) * k, y: s.y[lo] + (s.y[hi] - s.y[lo]) * k }
}

/** Whether participant `pid` is dead at `tMs` (died earlier and the approximate respawn delay has not elapsed). */
export function isDeadAt(pid: number, tMs: number, kills: TimelineKillEvent[]): boolean {
  return kills.some((k) => k.victim === pid && k.t <= tMs && tMs < k.t + respawnSec(k.t) * 1000)
}

/**
 * True when no living teammate (other than `selfPid`) is within `distance` of (x, y) at `tMs`; false when one is.
 * Null when the positions are not available (nothing can be judged).
 */
export function isIsolated(
  tp: TimelinePlayers, ourPids: number[], selfPid: number, tMs: number, x: number, y: number, distance = ISOLATION_DISTANCE,
): boolean | null {
  let judged = false
  for (const pid of ourPids) {
    if (pid === selfPid) continue
    const pos = positionAt(tp.players.find((p) => p.pid === pid), tMs)
    if (!pos) continue
    judged = true
    if (isDeadAt(pid, tMs, tp.kills)) continue
    if (Math.hypot(pos.x - x, pos.y - y) <= distance) return false
  }
  return judged ? true : null
}

// ── Radar ────────────────────────────────────────────────────────────────────────────────────────────────────

export type RadarAxisKey = 'damagePerMin' | 'goldPerMin' | 'csPerMin' | 'vision' | 'kpPct' | 'survival' | 'xpPerMin'
export const RADAR_AXES: readonly RadarAxisKey[] = ['damagePerMin', 'goldPerMin', 'csPerMin', 'vision', 'kpPct', 'survival', 'xpPerMin']

/**
 * One radar axis. `player` / `opponent` are 0-100: value / max(player, opponent) × 100, so the better of the two is
 * always 100 and the other is its share of it. Both 0 → 0 and 0. `*Raw` are the unnormalised values for tooltips.
 */
export interface RadarAxis {
  key: RadarAxisKey
  player: number
  opponent: number
  playerRaw: number
  opponentRaw: number
}

/**
 * Raw radar values of one line of stats. `survival` = 1 / (1 + deaths per minute): fewer deaths → closer to 1, so
 * "bigger is better" holds on every axis (deaths/min inverted).
 */
export function radarRaw(s: SynergyPlayerStats, durationMin: number): Record<RadarAxisKey, number> {
  const a = s.averages
  const deathsPerMin = durationMin > 0 ? a.deaths / durationMin : 0
  return {
    damagePerMin: a.damagePerMin, goldPerMin: a.goldPerMin, csPerMin: a.csPerMin, vision: a.visionScore,
    kpPct: s.shares.kpPct, survival: 1 / (1 + deathsPerMin), xpPerMin: a.xpPerMin,
  }
}

function normalize(player: Record<RadarAxisKey, number>, opponent: Record<RadarAxisKey, number>): RadarAxis[] {
  return RADAR_AXES.map((key) => {
    const p = player[key], o = opponent[key], max = Math.max(p, o)
    return { key, player: max > 0 ? (p / max) * 100 : 0, opponent: max > 0 ? (o / max) * 100 : 0, playerRaw: p, opponentRaw: o }
  })
}

/** The radar of a player against his lane opponent, one game (`durationSec` = the game's length). Empty without opponent. */
export function buildPlayerRadar(player: SynergyPlayerStats, opponent: SynergyPlayerStats | null, durationSec: number): RadarAxis[] {
  if (!opponent || durationSec <= 0) return []
  return normalize(radarRaw(player, durationSec / 60), radarRaw(opponent, durationSec / 60))
}

// ── Contract (docs/contracts/player-session-stats.md part B) ───────────────────────────────────────────────────

export interface DiffPoint { goldDiff: number | null; xpDiff: number | null }

export interface VsOpponent {
  opponentName: string
  opponentChampion: string
  /** Player minus opponent. at10 / at15 come from the timeline (null without it, or when the game ended before). */
  at10: DiffPoint
  at15: DiffPoint
  /** End of game, from the match itself (goldEarned, champExperience): known without a timeline. */
  end: DiffPoint
}

/** Where on the map (microReview/geometry.zoneOf), relative to our side. */
export type MapZone = Zone

export interface PlayerEvent {
  gameId: string
  gameIndex: number
  /** Game time. */
  atSec: number
  /** « 12:40 ». */
  clock: string
  x: number | null
  y: number | null
  zone: MapZone | null
  /** Before 14:00. */
  early: boolean
  /** No living teammate within ISOLATION_DISTANCE; null when the positions are unknown. Judged at any minute here. */
  isolated: boolean | null
  /** A death: the killer's champion; a kill: the victim's. Null for an execution or when unknown. */
  otherChampion: string | null
  /** A death: enemies who assisted; a kill: allies who assisted. */
  assisters: number
  /** atSec − VOD_LEAD_SEC (not below 0). The Front adds the recording's offset for this game. */
  vodSeekSec: number
}

export type ObjectiveKind = 'dragon' | 'elder' | 'grubs' | 'herald' | 'baron' | 'tower'
export const OBJECTIVE_KINDS: readonly ObjectiveKind[] = ['dragon', 'elder', 'grubs', 'herald', 'baron', 'tower']

export interface ObjectiveLine { kind: ObjectiveKind; ours: number; participated: number; killed: number; theirs: number }
export interface ObjectiveEvent {
  kind: ObjectiveKind
  atSec: number
  clock: string
  ours: boolean
  participated: boolean
  killed: boolean
  subType?: string
  lane?: 'TOP' | 'MID' | 'BOT'
  vodSeekSec: number
}
export interface ObjectiveParticipation { byKind: ObjectiveLine[]; events: ObjectiveEvent[] }

export interface LaneSide { cs: number | null; gold: number | null; xp: number | null; level: number | null }
export interface LaneSnap { minute: 10 | 15; player: LaneSide; opponent: LaneSide | null; diff: LaneSide | null }
export interface LaneSummary { at10: LaneSnap; at15: LaneSnap; source: 'timeline' | 'lane-report' }

export interface MinuteDiffs { gold: Array<number | null>; xp: Array<number | null>; cs: Array<number | null> }

export interface PlayerExtras {
  soloKills: number | null
  firstBloodInvolved: boolean | null
  largestMultiKill: number | null
  doubleKills: number | null
  tripleKills: number | null
  quadraKills: number | null
  pentaKills: number | null
  killingSprees: number | null
  timeDeadSec: number | null
  timeDeadPct: number | null
  damageToObjectives: number | null
  damageToTurrets: number | null
  damageMitigated: number | null
  healAndShield: number | null
  objectivesStolen: number | null
  visionPerMin: number | null
}

export type HighlightId =
  | 'csPerMin' | 'goldPerMin' | 'damagePerMin' | 'xpPerMin' | 'kda' | 'deaths' | 'kpPct' | 'visionScore'
  | 'goldDiff15' | 'csDiff15' | 'deathsBefore14' | 'isolatedDeaths'
export interface Highlight {
  id: HighlightId
  value: number
  reference: number
  referenceSource: '30d' | 'opponent' | 'even'
  /** (value − reference) / reference × 100, null for the absolute ones (referenceSource 'even'). */
  deltaPct: number | null
}
export interface Highlights { strengths: Highlight[]; weaknesses: Highlight[] }

/** The player's last 30 days, from the same stats as the Dashboard (desktop, the signed-in player only). */
export interface Baseline30d {
  source: 'dashboard'
  games: number
  from: string
  to: string
  winRate: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  kda: number | null
  csPerMin: number | null
  goldPerMin: number | null
  xpPerMin: number | null
  damagePerMin: number | null
  visionScore: number | null
  kpPct: number | null
  damagePct: number | null
  goldDiff15: number | null
  csDiff15: number | null
  xpDiff15: number | null
}

export type TimelineStatus = 'ready' | 'no-players' | 'no-timeline'

export interface PlayerGameStats {
  gameId: string
  gameIndex: number
  memberId: string
  displayName: string
  role: string
  championKey: string
  win: boolean
  durationSec: number
  /** The existing per-game stats (kda, cs, gold, damage, shares, vision, kp, cc…). */
  base: SynergyPlayerStats
  /** challenges.turretPlatesTaken; null when Riot did not give it. */
  plates: number | null
  deathsBefore14: number | null
  isolatedDeathsAfter14: number | null
  isolatedKills: number | null
  vsOpponent: VsOpponent | null
  /** (value / mean of the team's non-support players − 1) × 100, end of game. Null for the support. */
  goldVsTeamAvgPct: number | null
  xpVsTeamAvgPct: number | null
  /** The lane opponent's own base stats (no isolation figures), null without one. */
  opponent: SynergyPlayerStats | null
  radar: RadarAxis[]
  /** 'ready': current players block; 'no-players': cached summary without it (or an older one): extract on demand; 'no-timeline': none cached. */
  timelineStatus: TimelineStatus
  // ── L11b ──
  diffSeries: MinuteDiffs | null
  deathEvents: PlayerEvent[] | null
  killEvents: PlayerEvent[] | null
  objectives: ObjectiveParticipation | null
  laneSummary: LaneSummary | null
  extras: PlayerExtras
  highlights: Highlights
}

export interface EventSummary {
  total: number
  early: number
  /** Events judged isolated. */
  isolated: number
  /** Events whose position allowed the judgement. */
  judged: number
  byZone: Partial<Record<MapZone, number>>
}

/** Session aggregate of the extras: counts summed, rates averaged, largestMultiKill the max, firstBloodShare the share of games (0-1). */
export type SessionExtras = Omit<PlayerExtras, 'firstBloodInvolved'> & { firstBloodShare: number | null }

export interface PlayerSessionTotals {
  deathsBefore14: number | null
  isolatedDeathsAfter14: number | null
  isolatedKills: number | null
  plates: number | null
  /** Games whose timeline figures were available (denominator of the timeline sums). */
  gamesWithTimeline: number
  /** Mean per game over the games counted (gamesPlayed = games counted). */
  base: SynergyPlayerStats
  /** Mean per game of the diffs, null when no game has one. */
  at10: DiffPoint
  at15: DiffPoint
  end: DiffPoint
  goldVsTeamAvgPct: number | null
  xpVsTeamAvgPct: number | null
  // ── L11b ──
  diffSeries: MinuteDiffs | null
  laneSummary: LaneSummary | null
  objectives: ObjectiveLine[] | null
  gamesWithObjectives: number
  extras: SessionExtras
  deaths: EventSummary | null
  kills: EventSummary | null
}

export interface UnavailableGame { gameId: string; gameIndex: number; reason: 'no-match' | 'no-side' | 'not-a-player' }

export interface PlayerSessionStats {
  source: 'team' | 'solo'
  memberId: string
  displayName: string
  role: string
  gamesCounted: number
  games: PlayerGameStats[]
  total: PlayerSessionTotals
  /** Session radar: the mean of each game's raw values, normalised. Empty when no game had an opponent. */
  radar: RadarAxis[]
  deathEvents: PlayerEvent[] | null
  killEvents: PlayerEvent[] | null
  avg30d: Baseline30d | null
  highlights: Highlights
  unavailableGames: UnavailableGame[]
}

// ── Computation ────────────────────────────────────────────────────────────────────────────────────────────────

/** A stored lane phase report (electron/main/lanePhaseAnalyzer.ts), the fields used here. */
export interface LanePhaseReportLike {
  framesByMinute: Array<{
    minute: number
    cs: { player: number; opponent: number; diff: number }
    gold: { player: number; opponent: number; diff: number }
    xp: { player: number; opponent: number; diff: number }
    level: { player: number; opponent: number; diff: number }
  }>
}

export interface PlayerGameInput {
  id: string
  matchId: string
  matchJson: unknown
  ourTeamId: 100 | 200 | null
  timelineSummary: unknown
  /** Solo only: the stored lane report, used for the lane summary when there is no timeline. */
  lanePhaseReport?: LanePhaseReportLike | null
  /** Solo only: ISO end time, the order of the session. */
  playedAt?: string
}

type Part = RiotMatchParticipant & { participantId?: number; challenges?: Record<string, unknown> } & Record<string, unknown>

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const sum = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null)
  return v.length ? v.reduce((s, x) => s + x, 0) : null
}
const known = (xs: Array<number | null | undefined>): number[] => xs.filter((v): v is number => typeof v === 'number')
const meanOf = (xs: Array<number | null | undefined>): number | null => mean(known(xs))
const diff = (a: number | undefined, b: number | undefined): number | null => (typeof a === 'number' && typeof b === 'number' ? a - b : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`

/** (player / mean of the non-support players − 1) × 100, null for the support or without a base. */
function vsTeamAvgPct(value: number, role: string, team: Array<{ role: string; value: number }>): number | null {
  if (role === 'SUPPORT') return null
  const pool = team.filter((t) => t.role !== 'SUPPORT')
  const avg = mean(pool.map((t) => t.value))
  return avg && avg > 0 ? (value / avg - 1) * 100 : null
}

// ── Extras, events, objectives, lane (per game) ───────────────────────────────────────────────────────────────

export function extrasOf(p: Part, durationSec: number): PlayerExtras {
  const ch = p.challenges ?? {}
  const timeDead = num(p.totalTimeSpentDead)
  const fb = [p.firstBloodKill, p.firstBloodAssist].filter((v): v is boolean => typeof v === 'boolean')
  return {
    soloKills: num(ch.soloKills),
    firstBloodInvolved: fb.length ? fb.some(Boolean) : null,
    largestMultiKill: num(p.largestMultiKill),
    doubleKills: num(p.doubleKills), tripleKills: num(p.tripleKills), quadraKills: num(p.quadraKills), pentaKills: num(p.pentaKills),
    killingSprees: num(p.killingSprees),
    timeDeadSec: timeDead,
    timeDeadPct: timeDead !== null && durationSec > 0 ? (timeDead / durationSec) * 100 : null,
    damageToObjectives: num(p.damageDealtToObjectives),
    damageToTurrets: num(p.damageDealtToTurrets),
    damageMitigated: num(p.damageSelfMitigated),
    healAndShield: num(ch.effectiveHealAndShielding) ?? num(p.totalHeal),
    objectivesStolen: num(p.objectivesStolen),
    visionPerMin: durationSec > 0 && typeof p.visionScore === 'number' ? p.visionScore / (durationSec / 60) : null,
  }
}

function eventOf(
  k: TimelineKillEvent, side: 'death' | 'kill', ctx: { tp: TimelinePlayers; ourPids: number[]; pid: number; gameId: string; gameIndex: number; ourTeamId: 100 | 200; champByPid: Map<number, string> },
): PlayerEvent {
  const atSec = Math.round(k.t / 1000)
  const hasPos = k.x !== null && k.y !== null
  const other = side === 'death' ? k.killer : k.victim
  return {
    gameId: ctx.gameId, gameIndex: ctx.gameIndex, atSec, clock: clock(atSec), x: k.x, y: k.y,
    zone: hasPos ? zoneOf({ x: k.x!, y: k.y! }, ctx.ourTeamId) : null,
    early: k.t < EARLY_DEATH_LIMIT_MS,
    isolated: hasPos ? isIsolated(ctx.tp, ctx.ourPids, ctx.pid, k.t, k.x!, k.y!) : null,
    otherChampion: other > 0 ? ctx.champByPid.get(other) ?? null : null,
    assisters: k.assists.length,
    vodSeekSec: Math.max(0, atSec - VOD_LEAD_SEC),
  }
}

export function buildObjectiveParticipation(tp: TimelinePlayers, pid: number, ourTeamId: 100 | 200): ObjectiveParticipation | null {
  if (!tp.objectives) return null
  const lines = new Map<ObjectiveKind, ObjectiveLine>(OBJECTIVE_KINDS.map((kind) => [kind, { kind, ours: 0, participated: 0, killed: 0, theirs: 0 }]))
  const events: ObjectiveEvent[] = []
  for (const e of tp.objectives) {
    const ours = e.teamId === ourTeamId
    const killed = ours && e.killer === pid
    const participated = ours && (killed || e.assists.includes(pid))
    const line = lines.get(e.kind)!
    if (ours) { line.ours++; if (participated) line.participated++; if (killed) line.killed++ } else line.theirs++
    const atSec = Math.round(e.t / 1000)
    events.push({
      kind: e.kind, atSec, clock: clock(atSec), ours, participated, killed, ...(e.subType ? { subType: e.subType } : {}),
      ...(e.lane ? { lane: e.lane } : {}), vodSeekSec: Math.max(0, atSec - VOD_LEAD_SEC),
    })
  }
  return { byKind: [...lines.values()], events }
}

const sideAt = (s: TimelinePlayerSeries | undefined, m: number): LaneSide => ({
  cs: s?.cs?.[m] ?? null, gold: s?.gold[m] ?? null, xp: s?.xp[m] ?? null, level: s?.lvl?.[m] ?? null,
})
const diffSide = (a: LaneSide, b: LaneSide): LaneSide => ({
  cs: diff(a.cs ?? undefined, b.cs ?? undefined), gold: diff(a.gold ?? undefined, b.gold ?? undefined),
  xp: diff(a.xp ?? undefined, b.xp ?? undefined), level: diff(a.level ?? undefined, b.level ?? undefined),
})
const emptySide = (): LaneSide => ({ cs: null, gold: null, xp: null, level: null })

function snapFromSeries(minute: 10 | 15, mine: TimelinePlayerSeries | undefined, opp: TimelinePlayerSeries | undefined): LaneSnap {
  const player = sideAt(mine, minute)
  const opponent = opp ? sideAt(opp, minute) : null
  return { minute, player, opponent, diff: opponent ? diffSide(player, opponent) : null }
}

function snapFromReport(minute: 10 | 15, report: LanePhaseReportLike): LaneSnap {
  const f = report.framesByMinute.find((x) => x.minute === minute)
  if (!f) return { minute, player: emptySide(), opponent: null, diff: null }
  const at = (k: 'player' | 'opponent' | 'diff'): LaneSide => ({ cs: f.cs[k], gold: f.gold[k], xp: f.xp[k], level: f.level[k] })
  return { minute, player: at('player'), opponent: at('opponent'), diff: at('diff') }
}

/** The lane summary of the timeline when it has the player's series, else of the stored lane report, else null. */
export function buildLaneSummary(mine: TimelinePlayerSeries | undefined, opp: TimelinePlayerSeries | undefined, report: LanePhaseReportLike | null | undefined): LaneSummary | null {
  if (mine) return { at10: snapFromSeries(10, mine, opp), at15: snapFromSeries(15, mine, opp), source: 'timeline' }
  if (report?.framesByMinute?.length) return { at10: snapFromReport(10, report), at15: snapFromReport(15, report), source: 'lane-report' }
  return null
}

export function buildDiffSeries(mine: TimelinePlayerSeries | undefined, opp: TimelinePlayerSeries | undefined): MinuteDiffs | null {
  if (!mine || !opp) return null
  const len = Math.max(mine.gold.length, opp.gold.length)
  const per = (a: number[] | undefined, b: number[] | undefined) => Array.from({ length: len }, (_, m) => diff(a?.[m], b?.[m]))
  return { gold: per(mine.gold, opp.gold), xp: per(mine.xp, opp.xp), cs: per(mine.cs, opp.cs) }
}

// ── Highlights ───────────────────────────────────────────────────────────────────────────────────────────────

/** A ratio metric is a highlight from this relative gap to its reference. */
export const HIGHLIGHT_REL = 0.15
export const HIGHLIGHT_GOLD_DIFF = 300
export const HIGHLIGHT_CS_DIFF = 8
export const HIGHLIGHT_COUNT = 2
const MAX_HIGHLIGHTS = 3

interface HighlightInput {
  base: SynergyPlayerStats
  opponent: SynergyPlayerStats | null
  goldDiff15: number | null
  csDiff15: number | null
  deathsBefore14: number | null
  isolatedDeaths: number | null
}

const RATIOS: Array<{ id: HighlightId; lowerBetter?: boolean; of: (s: SynergyPlayerStats) => number }> = [
  { id: 'csPerMin', of: (s) => s.averages.csPerMin },
  { id: 'goldPerMin', of: (s) => s.averages.goldPerMin },
  { id: 'damagePerMin', of: (s) => s.averages.damagePerMin },
  { id: 'xpPerMin', of: (s) => s.averages.xpPerMin },
  { id: 'kda', of: (s) => s.averages.kda },
  { id: 'deaths', lowerBetter: true, of: (s) => s.averages.deaths },
  { id: 'kpPct', of: (s) => s.shares.kpPct },
  { id: 'visionScore', of: (s) => s.averages.visionScore },
]

const baselineOf = (b: Baseline30d | null, id: HighlightId): number | null => {
  if (!b) return null
  const v = ({ csPerMin: b.csPerMin, goldPerMin: b.goldPerMin, damagePerMin: b.damagePerMin, xpPerMin: b.xpPerMin, kda: b.kda, deaths: b.deaths, kpPct: b.kpPct, visionScore: b.visionScore } as Record<string, number | null>)[id]
  return v ?? null
}

/** Strengths and weaknesses from the numbers (docs/contracts/player-session-stats.md § B4). Pure, no text. */
export function buildHighlights(input: HighlightInput, baseline: Baseline30d | null): Highlights {
  const found: Array<{ h: Highlight; good: boolean; weight: number }> = []
  for (const m of RATIOS) {
    const value = m.of(input.base)
    const b = baselineOf(baseline, m.id)
    const ref = b !== null && b > 0 ? { v: b, src: '30d' as const } : input.opponent ? { v: m.of(input.opponent), src: 'opponent' as const } : null
    if (!ref || !(ref.v > 0)) continue
    const delta = (value - ref.v) / ref.v
    const goodness = m.lowerBetter ? -delta : delta
    if (Math.abs(goodness) < HIGHLIGHT_REL) continue
    found.push({ h: { id: m.id, value, reference: ref.v, referenceSource: ref.src, deltaPct: Math.round(delta * 1000) / 10 }, good: goodness > 0, weight: Math.abs(goodness) })
  }
  const abs = (id: HighlightId, value: number | null, threshold: number, goodSide: boolean) => {
    if (value === null) return
    const good = goodSide && value >= threshold, bad = value <= -threshold || (!goodSide && value >= threshold)
    if (!good && !bad) return
    found.push({ h: { id, value, reference: 0, referenceSource: 'even', deltaPct: null }, good, weight: (Math.abs(value) / threshold) * HIGHLIGHT_REL })
  }
  abs('goldDiff15', input.goldDiff15, HIGHLIGHT_GOLD_DIFF, true)
  abs('csDiff15', input.csDiff15, HIGHLIGHT_CS_DIFF, true)
  abs('deathsBefore14', input.deathsBefore14, HIGHLIGHT_COUNT, false)
  abs('isolatedDeaths', input.isolatedDeaths, HIGHLIGHT_COUNT, false)
  const pick = (good: boolean) => found.filter((f) => f.good === good).sort((a, b) => b.weight - a.weight).slice(0, MAX_HIGHLIGHTS).map((f) => f.h)
  return { strengths: pick(true), weaknesses: pick(false) }
}

const highlightsOfGame = (g: Pick<PlayerGameStats, 'base' | 'opponent' | 'laneSummary' | 'deathsBefore14' | 'isolatedDeathsAfter14'>, baseline: Baseline30d | null) =>
  buildHighlights({
    base: g.base, opponent: g.opponent, goldDiff15: g.laneSummary?.at15.diff?.gold ?? null, csDiff15: g.laneSummary?.at15.diff?.cs ?? null,
    deathsBefore14: g.deathsBefore14, isolatedDeaths: g.isolatedDeathsAfter14,
  }, baseline)

// ── One game ─────────────────────────────────────────────────────────────────────────────────────────────────

interface LineContext {
  ourTeamId: (participants: Part[]) => 100 | 200 | null
  nameFor: (p: RiotMatchParticipant) => { id: string; displayName: string }
  /** Only these members get a line (a substitute / unknown name has no account to show it to). */
  keep: (memberId: string) => boolean
}

type SkipReason = UnavailableGame['reason']

/** Every kept player's individual line for one game, or why the game gives none. */
function gameLines(g: PlayerGameInput, gameIndex: number, ctx: LineContext): { lines: PlayerGameStats[]; skip: SkipReason | null } {
  const match = g.matchJson as { info?: { participants?: Part[]; gameDuration?: number } } | null
  const participants = match?.info?.participants
  const durationSec = match?.info?.gameDuration
  if (!Array.isArray(participants) || typeof durationSec !== 'number' || durationSec <= 0) return { lines: [], skip: 'no-match' }
  const ourTeamId = g.ourTeamId ?? ctx.ourTeamId(participants)
  if (ourTeamId !== 100 && ourTeamId !== 200) return { lines: [], skip: 'no-side' }
  const ours = participants.filter((p) => p.teamId === ourTeamId)
  const theirs = participants.filter((p) => p.teamId !== ourTeamId && (p.teamId === 100 || p.teamId === 200))
  const players = buildSideStats(ours, durationSec, (p) => ctx.nameFor(p))
  const enemies = buildSideStats(theirs, durationSec, (p) => ({ id: participantName(p), displayName: participantName(p) }))
  // buildSideStats keeps the order: players[i] is ours[i].
  const partOf = new Map<SynergyPlayerStats, Part>()
  players.forEach((s, i) => partOf.set(s, ours[i]))
  enemies.forEach((s, i) => partOf.set(s, theirs[i]))
  const duels = buildDuelRows(players, enemies)

  const summary = isCurrentTimeline(g.timelineSummary) ? (g.timelineSummary as TeamGameTimeline) : null
  const tp = summary?.players ?? null
  const status: TimelineStatus = summary ? (hasCurrentPlayers(summary) ? 'ready' : 'no-players') : 'no-timeline'
  const ourPids = ours.map((p) => p.participantId).filter((n): n is number => typeof n === 'number')
  const champByPid = new Map<number, string>()
  for (const p of participants) if (typeof p.participantId === 'number' && p.championName) champByPid.set(p.participantId, p.championName)
  const teamGold = players.map((s) => ({ role: s.role, value: partOf.get(s)?.goldEarned ?? 0 }))
  const teamXp = players.map((s) => ({ role: s.role, value: partOf.get(s)?.champExperience ?? 0 }))
  const win = !!ours[0]?.win

  const lines: PlayerGameStats[] = []
  players.forEach((s, i) => {
    if (!ctx.keep(s.memberId)) return
    const part = ours[i]
    const duel = duels.find((d) => d.our === s)
    const opp = duel?.enemy ?? null
    const oppPart = opp ? partOf.get(opp) : undefined
    const series = (pid: number | undefined) => tp?.players.find((p) => p.pid === pid)
    const mine = series(part.participantId), theirsS = series(oppPart?.participantId)

    let deathsBefore14: number | null = null, isolatedDeaths: number | null = null, isolatedKills: number | null = null
    let deathEvents: PlayerEvent[] | null = null, killEvents: PlayerEvent[] | null = null
    let objectives: ObjectiveParticipation | null = null
    if (tp && typeof part.participantId === 'number') {
      const pid = part.participantId
      const deaths = tp.kills.filter((k) => k.victim === pid)
      deathsBefore14 = deaths.filter((k) => k.t < EARLY_DEATH_LIMIT_MS).length
      const isoOf = (k: TimelineKillEvent) => (k.x === null || k.y === null ? null : isIsolated(tp, ourPids, pid, k.t, k.x, k.y))
      const late = deaths.filter((k) => k.t >= EARLY_DEATH_LIMIT_MS).map(isoOf)
      const killed = tp.kills.filter((k) => k.killer === pid)
      const kills = killed.map(isoOf)
      // Without positions nothing is judged: null, not 0. An event with no position is not counted.
      const judged = !!mine?.x
      isolatedDeaths = judged ? late.filter((v) => v === true).length : null
      isolatedKills = judged ? kills.filter((v) => v === true).length : null
      const evCtx = { tp, ourPids, pid, gameId: g.id, gameIndex, ourTeamId, champByPid }
      deathEvents = deaths.map((k) => eventOf(k, 'death', evCtx))
      killEvents = killed.map((k) => eventOf(k, 'kill', evCtx))
      objectives = buildObjectiveParticipation(tp, pid, ourTeamId)
    }

    const at = (m: number, a: TimelinePlayerSeries | undefined, b: TimelinePlayerSeries | undefined): DiffPoint => ({
      goldDiff: diff(a?.gold[m], b?.gold[m]), xpDiff: diff(a?.xp[m], b?.xp[m]),
    })
    const plates = num(part.challenges?.turretPlatesTaken)
    const laneSummary = buildLaneSummary(mine, opp ? theirsS : undefined, g.lanePhaseReport)

    const line: PlayerGameStats = {
      gameId: g.id, gameIndex, memberId: s.memberId, displayName: s.displayName, role: s.role,
      championKey: part.championName ?? 'Unknown', win, durationSec, base: s, plates,
      deathsBefore14, isolatedDeathsAfter14: isolatedDeaths, isolatedKills,
      vsOpponent: opp && oppPart ? {
        opponentName: opp.displayName, opponentChampion: oppPart.championName ?? 'Unknown',
        at10: at(10, mine, theirsS), at15: at(15, mine, theirsS),
        end: { goldDiff: s.averages.gold - opp.averages.gold, xpDiff: (part.champExperience ?? 0) - (oppPart.champExperience ?? 0) },
      } : null,
      goldVsTeamAvgPct: vsTeamAvgPct(part.goldEarned ?? 0, s.role, teamGold),
      xpVsTeamAvgPct: vsTeamAvgPct(part.champExperience ?? 0, s.role, teamXp),
      opponent: opp,
      radar: buildPlayerRadar(s, opp, durationSec),
      timelineStatus: status,
      diffSeries: opp ? buildDiffSeries(mine, theirsS) : null,
      deathEvents, killEvents, objectives, laneSummary,
      extras: extrasOf(part, durationSec),
      highlights: { strengths: [], weaknesses: [] },
    }
    line.highlights = highlightsOfGame(line, null)
    lines.push(line)
  })
  return { lines, skip: null }
}

/** Team session: every member's individual line for one game. `gameIndex` = the game's rank in the session (1, 2…). */
export function buildPlayerGameStats(g: PlayerGameInput, gameIndex: number, members: RiotIdMember[]): PlayerGameStats[] {
  return gameLines(g, gameIndex, teamContext(members)).lines
}

function teamContext(members: RiotIdMember[]): LineContext {
  return {
    ourTeamId: (participants) => resolveOurTeamId(participants, members.map((m) => m.riotId ?? '').filter(Boolean)),
    nameFor: (p) => {
      const m = matchParticipantToMember(p, members)
      return m ? { id: m.userId, displayName: m.displayName ?? participantName(p) } : { id: participantName(p), displayName: participantName(p) }
    },
    keep: (id) => members.some((m) => m.userId === id),
  }
}

// ── The session ──────────────────────────────────────────────────────────────────────────────────────────────

const meanDiff = (rows: Array<DiffPoint | undefined>): DiffPoint => ({
  goldDiff: meanOf(rows.map((r) => r?.goldDiff)),
  xpDiff: meanOf(rows.map((r) => r?.xpDiff)),
})

function meanMinuteDiffs(list: Array<MinuteDiffs | null>): MinuteDiffs | null {
  const rows = list.filter((d): d is MinuteDiffs => !!d)
  if (rows.length === 0) return null
  const len = Math.max(...rows.map((r) => r.gold.length))
  const per = (k: keyof MinuteDiffs) => Array.from({ length: len }, (_, m) => meanOf(rows.map((r) => r[k][m])))
  return { gold: per('gold'), xp: per('xp'), cs: per('cs') }
}

function meanSide(sides: Array<LaneSide | null | undefined>): LaneSide | null {
  const s = sides.filter((x): x is LaneSide => !!x)
  if (s.length === 0) return null
  const out: LaneSide = { cs: meanOf(s.map((x) => x.cs)), gold: meanOf(s.map((x) => x.gold)), xp: meanOf(s.map((x) => x.xp)), level: meanOf(s.map((x) => x.level)) }
  return out.cs === null && out.gold === null && out.xp === null && out.level === null ? null : out
}

function meanLaneSummary(list: Array<LaneSummary | null>): LaneSummary | null {
  const rows = list.filter((l): l is LaneSummary => !!l)
  if (rows.length === 0) return null
  const snap = (minute: 10 | 15, pick: (l: LaneSummary) => LaneSnap): LaneSnap => ({
    minute,
    player: meanSide(rows.map((r) => pick(r).player)) ?? emptySide(),
    opponent: meanSide(rows.map((r) => pick(r).opponent)),
    diff: meanSide(rows.map((r) => pick(r).diff)),
  })
  return { at10: snap(10, (l) => l.at10), at15: snap(15, (l) => l.at15), source: rows.some((r) => r.source === 'timeline') ? 'timeline' : 'lane-report' }
}

const SUMMED_EXTRAS = ['soloKills', 'doubleKills', 'tripleKills', 'quadraKills', 'pentaKills', 'killingSprees', 'objectivesStolen', 'timeDeadSec'] as const
const NUMERIC_EXTRAS: Array<Exclude<keyof PlayerExtras, 'firstBloodInvolved'>> = [
  'soloKills', 'largestMultiKill', 'doubleKills', 'tripleKills', 'quadraKills', 'pentaKills', 'killingSprees', 'timeDeadSec', 'timeDeadPct',
  'damageToObjectives', 'damageToTurrets', 'damageMitigated', 'healAndShield', 'objectivesStolen', 'visionPerMin',
]

/** Counts are summed, rates averaged, largestMultiKill is the max, firstBloodInvolved the share of games (0-1). */
export function aggregateExtras(list: PlayerExtras[]): SessionExtras {
  const out = {} as Record<string, number | boolean | null>
  for (const k of NUMERIC_EXTRAS) {
    const vals = known(list.map((e) => e[k]))
    out[k] = vals.length === 0 ? null : k === 'largestMultiKill' ? Math.max(...vals) : (SUMMED_EXTRAS as readonly string[]).includes(k) ? vals.reduce((s, v) => s + v, 0) : vals.reduce((s, v) => s + v, 0) / vals.length
  }
  const fb = list.map((e) => e.firstBloodInvolved).filter((v): v is boolean => v !== null)
  out.firstBloodShare = fb.length ? fb.filter(Boolean).length / fb.length : null
  return out as unknown as SessionExtras
}

function summarizeEvents(list: PlayerEvent[] | null): EventSummary | null {
  if (!list) return null
  const byZone: Partial<Record<MapZone, number>> = {}
  for (const e of list) if (e.zone) byZone[e.zone] = (byZone[e.zone] ?? 0) + 1
  return {
    total: list.length, early: list.filter((e) => e.early).length, isolated: list.filter((e) => e.isolated === true).length,
    judged: list.filter((e) => e.isolated !== null).length, byZone,
  }
}

function sumObjectives(list: Array<ObjectiveParticipation | null>): ObjectiveLine[] | null {
  const rows = list.filter((o): o is ObjectiveParticipation => !!o)
  if (rows.length === 0) return null
  return OBJECTIVE_KINDS.map((kind) => {
    const lines = rows.map((r) => r.byKind.find((l) => l.kind === kind)!)
    return {
      kind, ours: lines.reduce((s, l) => s + l.ours, 0), participated: lines.reduce((s, l) => s + l.participated, 0),
      killed: lines.reduce((s, l) => s + l.killed, 0), theirs: lines.reduce((s, l) => s + l.theirs, 0),
    }
  })
}

const concatEvents = (lists: Array<PlayerEvent[] | null>): PlayerEvent[] | null => {
  const ok = lists.filter((l): l is PlayerEvent[] => !!l)
  return ok.length ? ok.flat() : null
}

function assemble(rows: PlayerGameStats[], unavailable: UnavailableGame[], source: 'team' | 'solo'): PlayerSessionStats[] {
  const byMember = new Map<string, PlayerGameStats[]>()
  for (const r of rows) byMember.set(r.memberId, [...(byMember.get(r.memberId) ?? []), r])
  const out: PlayerSessionStats[] = []
  for (const list of byMember.values()) {
    const base = mergePlayerStats([list.map((r) => r.base)], (p) => p.memberId)[0]
    const withOpp = list.filter((r) => r.opponent)
    const raws = withOpp.map((r) => ({ p: radarRaw(r.base, r.durationSec / 60), o: radarRaw(r.opponent!, r.durationSec / 60) }))
    const avgRaw = (pick: 'p' | 'o'): Record<RadarAxisKey, number> =>
      Object.fromEntries(RADAR_AXES.map((k) => [k, mean(raws.map((r) => r[pick][k])) ?? 0])) as Record<RadarAxisKey, number>
    const tl = list.filter((r) => r.timelineStatus === 'ready')
    const deathEvents = concatEvents(list.map((r) => r.deathEvents)), killEvents = concatEvents(list.map((r) => r.killEvents))
    const objectives = sumObjectives(list.map((r) => r.objectives))
    const total: PlayerSessionTotals = {
      deathsBefore14: sum(list.map((r) => r.deathsBefore14)),
      isolatedDeathsAfter14: sum(list.map((r) => r.isolatedDeathsAfter14)),
      isolatedKills: sum(list.map((r) => r.isolatedKills)),
      plates: sum(list.map((r) => r.plates)),
      gamesWithTimeline: tl.length,
      base,
      at10: meanDiff(list.map((r) => r.vsOpponent?.at10)),
      at15: meanDiff(list.map((r) => r.vsOpponent?.at15)),
      end: meanDiff(list.map((r) => r.vsOpponent?.end)),
      goldVsTeamAvgPct: meanOf(list.map((r) => r.goldVsTeamAvgPct)),
      xpVsTeamAvgPct: meanOf(list.map((r) => r.xpVsTeamAvgPct)),
      diffSeries: meanMinuteDiffs(list.map((r) => r.diffSeries)),
      laneSummary: meanLaneSummary(list.map((r) => r.laneSummary)),
      objectives,
      gamesWithObjectives: list.filter((r) => r.objectives).length,
      extras: aggregateExtras(list.map((r) => r.extras)),
      deaths: summarizeEvents(deathEvents),
      kills: summarizeEvents(killEvents),
    }
    out.push({
      source, memberId: list[0].memberId, displayName: list[0].displayName, role: base.role,
      gamesCounted: list.length, games: list, total,
      radar: raws.length ? normalize(avgRaw('p'), avgRaw('o')) : [],
      deathEvents, killEvents, avg30d: null, highlights: { strengths: [], weaknesses: [] }, unavailableGames: unavailable,
    })
    out[out.length - 1].highlights = highlightsOfSession(out[out.length - 1], null)
  }
  return out
}

/** Session highlights from the per-game means (timeline sums divided by the games that have a timeline). */
function highlightsOfSession(s: PlayerSessionStats, baseline: Baseline30d | null): Highlights {
  const t = s.total
  const perGame = (v: number | null) => (v !== null && t.gamesWithTimeline > 0 ? v / t.gamesWithTimeline : null)
  return buildHighlights({
    base: t.base, opponent: meanOpponent(s.games), goldDiff15: t.laneSummary?.at15.diff?.gold ?? null, csDiff15: t.laneSummary?.at15.diff?.cs ?? null,
    deathsBefore14: perGame(t.deathsBefore14), isolatedDeaths: perGame(t.isolatedDeathsAfter14),
  }, baseline)
}

/** The lane opponents of the games combined (the same merge as the whole session's), null without any. */
function meanOpponent(games: PlayerGameStats[]): SynergyPlayerStats | null {
  const opps = games.map((g) => g.opponent).filter((o): o is SynergyPlayerStats => !!o)
  return opps.length ? mergePlayerStats([opps], () => 'opponent')[0] : null
}

/**
 * The session's player stats: one element per member with at least one game, games in the order given. The total's `base`
 * averages the per-game base stats (mergePlayerStats).
 */
export function buildPlayerSessionStats(games: PlayerGameInput[], members: RiotIdMember[]): PlayerSessionStats[] {
  const ctx = teamContext(members)
  const rows: PlayerGameStats[] = []
  const unavailable: UnavailableGame[] = []
  games.forEach((g, i) => {
    const r = gameLines(g, i + 1, ctx)
    rows.push(...r.lines)
    if (r.skip) unavailable.push({ gameId: g.id, gameIndex: i + 1, reason: r.skip })
  })
  return assemble(rows, unavailable, 'team')
}

// ── Solo ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SoloSelf {
  /** The id the Front looks the result up with (the local user's id). */
  userId: string
  displayName: string
  /** The player's Riot accounts (main + secondary). */
  puuids: string[]
}

/**
 * Solo session: the signed-in player's stats from the games' cached match and timeline summary (no Riot call), the same
 * shape as a team session's. Games are put in the order played (`playedAt`, stable when absent); `gameIndex` = rank in that
 * order. A game where none of the player's accounts played is `not-a-player`.
 */
export function buildSoloPlayerSessionStats(games: PlayerGameInput[], self: SoloSelf): PlayerSessionStats[] {
  const ordered = games.map((g, i) => ({ g, i })).sort((a, b) => (Date.parse(a.g.playedAt ?? '') || 0) - (Date.parse(b.g.playedAt ?? '') || 0) || a.i - b.i).map((x) => x.g)
  const isMe = (p: { puuid?: string }) => !!p.puuid && self.puuids.includes(p.puuid)
  const ctx: LineContext = {
    ourTeamId: (participants) => { const t = participants.find(isMe)?.teamId; return t === 100 || t === 200 ? t : null },
    nameFor: (p) => (isMe(p) ? { id: self.userId, displayName: self.displayName } : { id: participantName(p), displayName: participantName(p) }),
    keep: (id) => id === self.userId,
  }
  const rows: PlayerGameStats[] = []
  const unavailable: UnavailableGame[] = []
  ordered.forEach((g, i) => {
    const participants = (g.matchJson as { info?: { participants?: Part[] } } | null)?.info?.participants
    const hit = Array.isArray(participants) && participants.some(isMe)
    const r = gameLines({ ...g, ourTeamId: null }, i + 1, ctx)
    rows.push(...r.lines)
    if (r.skip) unavailable.push({ gameId: g.id, gameIndex: i + 1, reason: r.skip === 'no-side' && Array.isArray(participants) && !hit ? 'not-a-player' : r.skip })
  })
  return assemble(rows, unavailable, 'solo')
}

// ── 30-day baseline ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The 30-day baseline from the Dashboard's averages (electron/main/ipc/stats.ipc.ts computeAverages over the player's
 * DetailedStats of the last 30 days). The same numbers the Dashboard shows, mapped to the sheet's names. Null without games.
 */
export function baseline30dFromAverages(avg: any, from: string, to: string): Baseline30d | null {
  const n = num(avg?.meta?.gameCount)
  if (!n || n <= 0) return null
  const k = num(avg.meta.avgKills), d = num(avg.meta.avgDeaths), a = num(avg.meta.avgAssists)
  return {
    source: 'dashboard', games: n, from, to,
    winRate: num(avg.meta.winRate), kills: k, deaths: d, assists: a,
    kda: k === null || a === null ? null : d !== null && d > 0 ? (k + a) / d : k + a,
    csPerMin: num(avg.economy?.csPerMin), goldPerMin: num(avg.economy?.goldPerMin), xpPerMin: num(avg.economy?.xpPerMin),
    damagePerMin: num(avg.combat?.damagePerMin), visionScore: num(avg.meta.avgVisionScore),
    kpPct: num(avg.combat?.killParticipation), damagePct: num(avg.combat?.teamDamagePercent),
    goldDiff15: num(avg.laning?.goldDiff15), csDiff15: num(avg.laning?.csDiff15), xpDiff15: num(avg.laning?.xpDiff15),
  }
}

/** Puts the 30-day baseline on `userId`'s entry and recomputes the highlights (session and games) against it. Other entries are untouched. */
export function attachBaseline(stats: PlayerSessionStats[], userId: string, baseline: Baseline30d | null): PlayerSessionStats[] {
  if (!baseline) return stats
  return stats.map((s) => {
    if (s.memberId !== userId) return s
    const next: PlayerSessionStats = { ...s, avg30d: baseline, games: s.games.map((g) => ({ ...g, highlights: highlightsOfGame(g, baseline) })) }
    next.highlights = highlightsOfSession(next, baseline)
    return next
  })
}

// ── Platform entry (shared desktop / web) ─────────────────────────────────────────────────────────────────────

/**
 * `teamSessionPlayerStats(sessionId)`. Reads the session's games (cached match + timeline summary), same rights as
 * teamSessionHistoryDetail (the session must be readable: else NOT_FOUND). `enrich(gameId)` is optional: the platform's
 * on-demand extraction of one game's missing `players` block (Riot calls); called one game at a time, only for the
 * games of this session whose cached summary lacks it, never otherwise. A failure leaves that game's figures null.
 */
export async function getPlayerSessionStats(
  sb: SupabaseClient, sessionId: string,
  enrich?: (gameId: string) => Promise<unknown>,
): Promise<PlayerSessionStats[]> {
  const { data: s, error } = await sb.from('team_sessions').select('id, group_id').eq('id', sessionId).maybeSingle()
  if (error) fail(error, 'session')
  if (!s) throw new Error('NOT_FOUND')
  const [gameRows, memberRows] = await Promise.all([
    sb.from('team_session_games').select('id, match_id, created_at, match_json, our_team_id, timeline_summary').eq('session_id', sessionId),
    sb.from('group_members').select('user_id, riot_id, display_name').eq('group_id', s.group_id),
  ])
  for (const r of [gameRows, memberRows]) if (r.error) fail(r.error, 'player stats')
  const startOf = (g: any) => Number(g.match_json?.info?.gameStartTimestamp) || Date.parse(g.created_at)
  const rows = [...(gameRows.data ?? [])].sort((a: any, b: any) => startOf(a) - startOf(b))
  if (enrich) {
    for (const g of rows as any[]) {
      if (!g.match_json || (isCurrentTimeline(g.timeline_summary) && hasCurrentPlayers(g.timeline_summary as TeamGameTimeline))) continue
      try {
        const fresh = await enrich(g.id)
        if (fresh && typeof fresh === 'object' && !('unavailable' in fresh)) g.timeline_summary = fresh
      } catch { /* this game's timeline figures stay null */ }
    }
  }
  const members: RiotIdMember[] = (memberRows.data ?? []).map((m: any) => ({ userId: m.user_id, riotId: m.riot_id, displayName: m.display_name }))
  return buildPlayerSessionStats(rows.map((g: any) => ({
    id: g.id, matchId: g.match_id, matchJson: g.match_json, ourTeamId: g.our_team_id, timelineSummary: g.timeline_summary,
  })), members)
}
