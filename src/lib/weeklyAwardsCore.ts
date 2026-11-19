/**
 * Weekly awards of a team roster (Coaching & Management → Espace d'équipe):
 *  - MVP: the best stats of the team over the week,
 *  - Grinder: the most Solo/Duo LP won over the week,
 * with their streaks and totals. The player cards draw them as frames, and an
 * aura when a player keeps winning.
 *
 * Pure: week boundaries, the score of one game, the weekly rankings, the LP
 * won, the holders and streaks. The IO (Riot calls, rank snapshots, the
 * stored history, the schedule) is electron/main/weeklyAwards.ts.
 *
 * ## Weeks
 * Monday 00:00 to the next Monday 00:00, local time. A week is named by its
 * Monday, "2026-11-16" (its key). Games belong to the week they started in.
 *
 * ## MVP score of one game (0–100), `scoreLobby`
 * Six stats, each read against the lobby:
 *   KDA            (kills + assists) / max(1, deaths)
 *   KP             (kills + assists) / kills of the player's team
 *   damage share   damage to champions / the team's damage to champions
 *   gold/min, CS/min (lane minions + jungle monsters), vision score/min
 * 1. Every player's stat is divided by the median of the role they played
 *    (ROLE_NORMS): a support's 2.5 vision/min and a mid laner's 0.7 both read
 *    1.0, a support's 1 CS/min is as normal as an ADC's 7.6.
 * 2. The player's percentile on that ratio among the other players of the
 *    lobby: 0 = lowest, 1 = highest, ties count half. It follows the pace and
 *    length of the game (a bloody game raises every KDA).
 * 3. The six percentiles are summed with the weights of the role played
 *    (ROLE_WEIGHTS, each row sums to 1: vision and KP first for a support, no
 *    CS; damage, CS and gold first for an ADC…) and scaled to 90.
 * 4. That stat part is stretched around 45 by the role's ROLE_SPREAD (then
 *    kept within 0–90), so every role spreads alike: an ADC's stats rise and
 *    fall together (a fed ADC tops every stat), a support's much less, and
 *    without it a great support game would score 8 points under a great ADC
 *    game. A win adds WIN_BONUS (10).
 * A player at their role's median on every stat in a lobby of median players
 * scores 45 (55 in a win), whatever the role. Measured on the 3,032 ranked
 * games cached in the development database (30,320 performances, Nov. 2026):
 * every role averages 49.4 to 50.1, with the same spread (standard deviation
 * of the stat part 18.3 to 18.5) and the same top 10 % (above 76.5 to 78.7).
 * Wins average 61, losses 38. Over 3+ games, a player's average is above 64
 * one time in ten.
 * Counted: Solo/Duo (420) and Flex (440). Not normal draft (400): its MMR is
 * separate and usually lower than ranked, and players try champions there.
 * Remakes (under 5 minutes, or ended by an early surrender vote) never count.
 *
 * ## MVP of the week, `mvpRace`
 * Team games only (#46, 20/11/2026: the MVP went four weeks running to a
 * player whose team never played together): a game counts when at least
 * MVP_MIN_TOGETHER (3) members of the roster played it on the same side
 * (`teamGamesOnly`), the threshold of the team synergy stats. The average
 * score of the player's team games of the week, MVP_MIN_GAMES (3) minimum.
 * Equal averages (to 0.1) go to the player with more games. A roster with
 * fewer than 3 known players has no MVP.
 *
 * ## Grinder of the week, `grinderWeek`
 * Riot keeps no LP history: the rank is read at start, every few hours and
 * whenever the app reads ranks, and stored (RankSnapshot). Every reading is a
 * point on one LP scale (rankCore.ladderScore: 400 per tier, 100 per
 * division, LP; from Master up, LP only).
 * LP won = the week's last reading minus the baseline. The baseline is the
 * last reading before the week, if it was taken at most BASELINE_MAX_AGE_MS
 * (7 days) before the week starts, else the week's first reading. A reading
 * with fewer games than the one before means ranks were reset (new split):
 * the baseline moves to it. +GRINDER_MIN_LP (1) minimum to win, equal LP goes
 * to the player with more games.
 *
 * ## Holders, `buildWeeklyAwards`
 * Each award goes to the winner of the last completed week. While that week
 * has none (the first days of use), the current week's leader holds it,
 * marked live. Streak = consecutive weeks won, ending with the one shown; a
 * week without a result breaks it. Results are matched to today's roster by
 * member, else by PUUID (a player removed then added back keeps their history).
 */

import { normalizeRole } from './teamIdentity'
import { ROLES, type Role } from './championRoles'

// ── Contract (re-exported by src/lib/ipc.ts) ───────────────────────────────

export type AwardKind = 'mvp' | 'grinder'
export const AWARD_KINDS: readonly AwardKind[] = ['mvp', 'grinder']

export interface AwardHolder {
  kind: AwardKind
  /** TeamMember.id */
  memberId: string
  /** ISO date (toISOString) of the local Monday 00:00 that starts the award's week. */
  weekStart: string
  /** true: leader of the current, unfinished week. */
  live: boolean
  /** mvp: score 0–100 · grinder: LP gained */
  value: number
  /** Games counted that week (grinder: Solo/Duo games between the two readings). */
  games: number
  /** Consecutive weeks won, ending with this one (≥ 1). */
  streak: number
}

export interface AwardRaceEntry {
  memberId: string
  value: number
  games: number
}

export interface WeeklyAwards {
  /** At most one per kind. */
  holders: AwardHolder[]
  /** Completed weeks won, by memberId (every roster member, zeros included). */
  totals: Record<string, { mvp: number; grinder: number }>
  /** Current week, best first. mvp: players with a counted game (qualified
   *  ones first, MVP_MIN_GAMES) · grinder: players with a Solo/Duo reading
   *  this week who played or moved. */
  race: Record<AwardKind, AwardRaceEntry[]>
  computedAt: string
}

// ── Rules ──────────────────────────────────────────────────────────────────

/** Queues whose games count for the MVP: Solo/Duo and Flex. */
export const AWARD_QUEUE_IDS: readonly number[] = [420, 440]
/** Shorter games are remakes. */
export const MIN_GAME_SECONDS = 300
export const MVP_MIN_GAMES = 3
/** Members of the roster who must have played a game on the same side for it to count for the MVP (a team game). */
export const MVP_MIN_TOGETHER = 3
/**
 * Bumped when the MVP rule changes: the weeks stored under an older rule are computed again (electron/main/
 * weeklyAwards.ts). 2: team games only (#46).
 */
export const MVP_RULE_VERSION = 2
export const GRINDER_MIN_LP = 1
/** Points of 100 that a win adds to a game's score. */
export const WIN_BONUS = 10
/** Bump when the per-game score changes: stored scores are computed again. */
export const MVP_SCORE_VERSION = 1

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS
/** A reading older than this before the week starts no longer says where the
 *  player stood when it started (the app was closed for a long time). */
export const BASELINE_MAX_AGE_MS = 7 * DAY_MS
/** A week's result is stored this long after it ends, once the games that
 *  ended around midnight are on Riot's match history. Until then it is
 *  computed again on every read. */
export const FINALIZE_GRACE_MS = 3 * HOUR_MS
/** Completed weeks the history covers: the last 4 on the first run, from the
 *  match history (the Grinder needs readings, so it starts with the app). */
export const BACKFILL_WEEKS = 4

// ── Weeks ──────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Local Monday 00:00 of the week `t` falls in. */
export function weekStartOf(t: number | Date): Date {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

/** "2026-11-16": the local Monday of the week `t` falls in. */
export function weekKeyOf(t: number | Date): string {
  const d = weekStartOf(t)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Local Monday 00:00 of a week key. */
export function weekStartFromKey(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) throw new Error(`Invalid week key: ${key}`)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** The week `n` weeks after (before, when negative) `key`. Calendar days, so
 *  a daylight-saving change never shifts the Monday. */
export function shiftWeekKey(key: string, n: number): string {
  const d = weekStartFromKey(key)
  return weekKeyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * n, 12))
}

/** [start, end) of a week in ms. */
export function weekRange(key: string): { start: number; end: number } {
  return { start: weekStartFromKey(key).getTime(), end: weekStartFromKey(shiftWeekKey(key, 1)).getTime() }
}

/**
 * Completed weeks the stored history still lacks, oldest first, among the
 * BACKFILL_WEEKS weeks before the current one. `finalizable`: its end is
 * FINALIZE_GRACE_MS behind, so its result can be stored.
 */
export function pendingWeeks(now: number, stored: ReadonlySet<string>): Array<{ key: string; finalizable: boolean }> {
  const current = weekKeyOf(now)
  const out: Array<{ key: string; finalizable: boolean }> = []
  for (let i = BACKFILL_WEEKS; i >= 1; i--) {
    const key = shiftWeekKey(current, -i)
    if (stored.has(key)) continue
    out.push({ key, finalizable: now >= weekRange(key).end + FINALIZE_GRACE_MS })
  }
  return out
}

// ── MVP score of one game ──────────────────────────────────────────────────

/** The app's role list (championRoles.ts): one set of MVP weights per role. */
export const SCORE_ROLES: readonly Role[] = ROLES
export type ScoreRole = Role
export const SCORE_METRICS = ['kda', 'kp', 'damage', 'gold', 'cs', 'vision'] as const
export type ScoreMetric = (typeof SCORE_METRICS)[number]
type MetricRow = Record<ScoreMetric, number>

/**
 * Median of each stat per role, measured on the 3,032 Solo/Duo and Flex
 * games cached in the development database (Nov. 2026, 6,064 performances
 * per role). `ANY`: all roles, for a player Riot gave no position.
 */
export const ROLE_NORMS: Record<ScoreRole | 'ANY', MetricRow> = {
  TOP: { kda: 1.83, kp: 0.355, damage: 0.216, gold: 411, cs: 7.16, vision: 0.82 },
  JUNGLE: { kda: 2.67, kp: 0.514, damage: 0.189, gold: 446, cs: 6.73, vision: 0.88 },
  MID: { kda: 2.22, kp: 0.436, damage: 0.226, gold: 418, cs: 7.19, vision: 0.71 },
  ADC: { kda: 2.24, kp: 0.478, damage: 0.233, gold: 479, cs: 7.58, vision: 0.62 },
  SUPPORT: { kda: 2.71, kp: 0.553, damage: 0.102, gold: 309, cs: 1.05, vision: 2.54 },
  ANY: { kda: 2.33, kp: 0.469, damage: 0.198, gold: 413, cs: 6.77, vision: 0.84 },
}

/** What each role is judged on; each row sums to 1. */
export const ROLE_WEIGHTS: Record<ScoreRole | 'ANY', MetricRow> = {
  TOP: { kda: 0.2, kp: 0.1, damage: 0.25, gold: 0.15, cs: 0.2, vision: 0.1 },
  JUNGLE: { kda: 0.2, kp: 0.25, damage: 0.15, gold: 0.1, cs: 0.15, vision: 0.15 },
  MID: { kda: 0.2, kp: 0.15, damage: 0.25, gold: 0.15, cs: 0.15, vision: 0.1 },
  ADC: { kda: 0.2, kp: 0.1, damage: 0.3, gold: 0.15, cs: 0.2, vision: 0.05 },
  SUPPORT: { kda: 0.2, kp: 0.3, damage: 0.1, gold: 0.05, cs: 0, vision: 0.35 },
  ANY: { kda: 0.2, kp: 0.2, damage: 0.2, gold: 0.15, cs: 0.15, vision: 0.1 },
}

/**
 * Stretch of the stat part around 45 per role: 18.4 (the roles' mean standard
 * deviation of the stat part) / the role's own, measured on the same games
 * (top 19.6, jungle 17.8, mid 18.5, ADC 20.3, support 15.8).
 */
export const ROLE_SPREAD: Record<ScoreRole | 'ANY', number> = {
  TOP: 0.94,
  JUNGLE: 1.03,
  MID: 0.99,
  ADC: 0.91,
  SUPPORT: 1.16,
  ANY: 1,
}

/** One player of a game, as the score reads it. */
export interface LobbyPlayer {
  puuid: string
  teamId: number
  role: ScoreRole | null
  win: boolean
  kills: number
  deaths: number
  assists: number
  /** Damage to champions. */
  damage: number
  gold: number
  /** Lane minions + jungle monsters. */
  cs: number
  vision: number
}

/** TOP / JUNGLE / MID / ADC / SUPPORT from Riot's position names (or ours). */
export function toScoreRole(position: unknown): ScoreRole | null {
  const role = normalizeRole(typeof position === 'string' ? position : '')
  return (SCORE_ROLES as readonly string[]).includes(role) ? (role as ScoreRole) : null
}

/** Share of `others` below `value`, ties counting half: 0 = lowest, 1 = highest.
 *  Values within a billionth of each other are ties (divisions by the role
 *  norms leave rounding noise). */
export function lobbyPercentile(value: number, others: readonly number[]): number {
  if (others.length === 0) return 0.5
  const tolerance = 1e-9 * Math.max(1, Math.abs(value))
  let below = 0
  for (const o of others) {
    if (Math.abs(o - value) <= tolerance) below += 0.5
    else if (o < value) below += 1
  }
  return below / others.length
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** The six stats of a player, divided by the median of the role they played. */
function normalizedStats(p: LobbyPlayer, teamKills: number, teamDamage: number, minutes: number): MetricRow {
  const norm = ROLE_NORMS[p.role ?? 'ANY']
  const raw: MetricRow = {
    kda: (p.kills + p.assists) / Math.max(1, p.deaths),
    kp: teamKills > 0 ? (p.kills + p.assists) / teamKills : 0,
    damage: teamDamage > 0 ? p.damage / teamDamage : 0,
    gold: p.gold / minutes,
    cs: p.cs / minutes,
    vision: p.vision / minutes,
  }
  const out = {} as MetricRow
  for (const m of SCORE_METRICS) out[m] = raw[m] / norm[m]
  return out
}

/**
 * MVP score (0–100, one decimal) of `puuid` in a game of `minutes`; null when
 * they aren't in the lobby or the lobby has nobody else. See the module doc.
 */
export function scoreLobby(lobby: readonly LobbyPlayer[], puuid: string, minutes: number): number | null {
  const meIndex = lobby.findIndex((p) => p.puuid === puuid)
  if (meIndex < 0 || lobby.length < 2 || !(minutes > 0)) return null
  const kills = new Map<number, number>()
  const damage = new Map<number, number>()
  for (const p of lobby) {
    kills.set(p.teamId, (kills.get(p.teamId) ?? 0) + p.kills)
    damage.set(p.teamId, (damage.get(p.teamId) ?? 0) + p.damage)
  }
  const stats = lobby.map((p) => normalizedStats(p, kills.get(p.teamId) ?? 0, damage.get(p.teamId) ?? 0, minutes))
  const me = lobby[meIndex]
  const mine = stats[meIndex]
  const others = stats.filter((_, i) => i !== meIndex)
  const weights = ROLE_WEIGHTS[me.role ?? 'ANY']
  let sum = 0
  for (const m of SCORE_METRICS) {
    if (weights[m] > 0) sum += weights[m] * lobbyPercentile(mine[m], others.map((o) => o[m]))
  }
  const statMax = 100 - WIN_BONUS
  const statPart = statMax / 2 + ROLE_SPREAD[me.role ?? 'ANY'] * (statMax * sum - statMax / 2)
  return round1(Math.min(statMax, Math.max(0, statPart)) + (me.win ? WIN_BONUS : 0))
}

export interface GameScore {
  matchId: string
  queueId: number
  /** Game start, ms. */
  playedAt: number
  durationSec: number
  /** The position the player had (null: Riot gave none). */
  role: ScoreRole | null
  win: boolean
  /** 0–100; null when the game doesn't count (other queue, remake). */
  score: number | null
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function lobbyPlayerOf(p: any): LobbyPlayer | null {
  if (!p || typeof p !== 'object' || typeof p.puuid !== 'string' || !p.puuid) return null
  return {
    puuid: p.puuid,
    teamId: num(p.teamId),
    role: toScoreRole(p.teamPosition) ?? toScoreRole(p.individualPosition),
    win: p.win === true,
    kills: num(p.kills),
    deaths: num(p.deaths),
    assists: num(p.assists),
    damage: num(p.totalDamageDealtToChampions),
    gold: num(p.goldEarned),
    cs: num(p.totalMinionsKilled) + num(p.neutralMinionsKilled),
    vision: num(p.visionScore),
  }
}

/**
 * Score of `puuid` in a match-v5 body. Null when the body can't be read or
 * the player isn't in it; `score` null when the game doesn't count.
 */
export function scoreGame(match: unknown, puuid: string, queues: readonly number[] = AWARD_QUEUE_IDS): GameScore | null {
  const body = match as { metadata?: { matchId?: unknown }; info?: any } | null
  const info = body?.info
  if (!info || typeof info !== 'object' || !Array.isArray(info.participants)) return null
  const matchId = typeof body?.metadata?.matchId === 'string'
    ? body.metadata.matchId
    : info.platformId && info.gameId ? `${info.platformId}_${info.gameId}` : null
  if (!matchId) return null
  const raw = info.participants.find((p: any) => p?.puuid === puuid)
  const lobby = (info.participants as unknown[]).map(lobbyPlayerOf).filter((p): p is LobbyPlayer => p !== null)
  const me = lobby.find((p) => p.puuid === puuid)
  if (!raw || !me) return null

  const queueId = num(info.queueId)
  // Riot gave milliseconds before patch 11.20; no game lasts 20,000 seconds.
  let durationSec = num(info.gameDuration)
  if (durationSec > 20_000) durationSec /= 1000
  const remake = durationSec < MIN_GAME_SECONDS || raw.gameEndedInEarlySurrender === true
  const counted = queues.includes(queueId) && !remake
  return {
    matchId,
    queueId,
    playedAt: num(info.gameStartTimestamp) || num(info.gameCreation),
    durationSec: Math.round(durationSec),
    role: me.role,
    win: me.win,
    score: counted ? scoreLobby(lobby, puuid, durationSec / 60) : null,
  }
}

// ── Weekly rankings ────────────────────────────────────────────────────────

const byMemberId = (a: AwardRaceEntry, b: AwardRaceEntry) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0)

/**
 * The team games among the roster's scored games: those at least `minTogether` different players of the roster
 * played on the same side. Same match and same result means the same side (a game has one winning team), so two
 * roster players who met on opposite sides in Solo/Duo never make a team game. `games` must hold the roster's
 * players only.
 */
export function teamGamesOnly<T extends { puuid: string; matchId: string; win: boolean }>(games: readonly T[], minTogether = MVP_MIN_TOGETHER): T[] {
  const side = new Map<string, Set<string>>()
  for (const g of games) {
    const key = `${g.matchId}|${g.win}`
    const players = side.get(key) ?? new Set<string>()
    players.add(g.puuid)
    side.set(key, players)
  }
  return games.filter((g) => (side.get(`${g.matchId}|${g.win}`)?.size ?? 0) >= minTogether)
}

/**
 * MVP ranking from the scores of the week's counted games: average (one
 * decimal) and games per player. Qualified players (MVP_MIN_GAMES) first, then
 * best average, then more games.
 */
export function mvpRace(scores: ReadonlyArray<{ memberId: string; score: number | null }>): AwardRaceEntry[] {
  const byMember = new Map<string, number[]>()
  for (const s of scores) {
    if (s.score === null || !Number.isFinite(s.score)) continue
    const list = byMember.get(s.memberId) ?? []
    list.push(s.score)
    byMember.set(s.memberId, list)
  }
  const race = [...byMember].map(([memberId, list]) => ({
    memberId,
    value: round1(list.reduce((a, b) => a + b, 0) / list.length),
    games: list.length,
  }))
  const qualified = (e: AwardRaceEntry) => (e.games >= MVP_MIN_GAMES ? 1 : 0)
  return race.sort((a, b) => qualified(b) - qualified(a) || b.value - a.value || b.games - a.games || byMemberId(a, b))
}

/** One rank reading on the ladder scale. `games`: wins + losses in the queue. */
export interface RankPoint {
  at: number
  ladder: number
  games: number
}

/**
 * LP won (negative: lost) and Solo/Duo games played over [weekStart, weekEnd)
 * from rank readings in any order; null without a reading in the week. See
 * the module doc for the baseline.
 */
export function grinderWeek(points: readonly RankPoint[], weekStart: number, weekEnd: number): { lp: number; games: number } | null {
  const sorted = [...points].sort((a, b) => a.at - b.at)
  const inWeek = sorted.filter((p) => p.at >= weekStart && p.at < weekEnd)
  if (inWeek.length === 0) return null
  const before = sorted.filter((p) => p.at < weekStart).pop()
  let base = before && weekStart - before.at <= BASELINE_MAX_AGE_MS ? before : inWeek[0]
  let prev = base
  for (const p of inWeek) {
    if (p.games < prev.games) base = p
    prev = p
  }
  const last = inWeek[inWeek.length - 1]
  return { lp: last.ladder - base.ladder, games: Math.max(0, last.games - base.games) }
}

/** Grinder ranking: most LP first, then more games. Players who neither played
 *  nor moved are left out. */
export function grinderRace(entries: ReadonlyArray<{ memberId: string; lp: number; games: number }>): AwardRaceEntry[] {
  return entries
    .filter((e) => e.games > 0 || e.lp !== 0)
    .map((e) => ({ memberId: e.memberId, value: e.lp, games: e.games }))
    .sort((a, b) => b.value - a.value || b.games - a.games || byMemberId(a, b))
}

/** The winner of a ranking, if they qualify. */
export function raceLeader(kind: AwardKind, race: readonly AwardRaceEntry[]): AwardRaceEntry | null {
  const top = race[0]
  if (!top) return null
  const qualifies = kind === 'mvp' ? top.games >= MVP_MIN_GAMES : top.value >= GRINDER_MIN_LP
  return qualifies ? top : null
}

// ── History, holders, streaks ──────────────────────────────────────────────

/** The result of one award for one completed week (stored, or computed while
 *  the week is in its grace period). memberId / puuid null: nobody qualified. */
export interface WeekResult {
  kind: AwardKind
  weekKey: string
  memberId: string | null
  puuid: string | null
  value: number | null
  games: number | null
}

export interface RosterRef {
  id: string
  puuid: string | null
}

/** A week's result from its ranking. */
export function weekResultOf(kind: AwardKind, weekKey: string, race: readonly AwardRaceEntry[], roster: readonly RosterRef[]): WeekResult {
  const leader = raceLeader(kind, race)
  return {
    kind,
    weekKey,
    memberId: leader?.memberId ?? null,
    puuid: leader ? roster.find((m) => m.id === leader.memberId)?.puuid ?? null : null,
    value: leader?.value ?? null,
    games: leader?.games ?? null,
  }
}

/** The roster member who won `result`: the same member, else the same player
 *  (PUUID) added back under a new member id; null if they left the roster. */
export function resolveWinner(result: Pick<WeekResult, 'memberId' | 'puuid'>, roster: readonly RosterRef[]): string | null {
  if (result.memberId && roster.some((m) => m.id === result.memberId)) return result.memberId
  if (result.puuid) return roster.find((m) => m.puuid === result.puuid)?.id ?? null
  return null
}

/** Consecutive weeks of `kind` won by `memberId`, ending with `weekKey`. */
export function streakEnding(results: readonly WeekResult[], kind: AwardKind, memberId: string, weekKey: string, roster: readonly RosterRef[]): number {
  const byWeek = new Map<string, WeekResult>()
  for (const r of results) if (r.kind === kind && !byWeek.has(r.weekKey)) byWeek.set(r.weekKey, r)
  let streak = 0
  for (let key = weekKey; ; key = shiftWeekKey(key, -1)) {
    const r = byWeek.get(key)
    if (!r || resolveWinner(r, roster) !== memberId) return streak
    streak++
  }
}

/** Completed weeks won per roster member (zeros included). */
export function awardTotals(results: readonly WeekResult[], roster: readonly RosterRef[]): Record<string, { mvp: number; grinder: number }> {
  const totals: Record<string, { mvp: number; grinder: number }> = {}
  for (const m of roster) totals[m.id] = { mvp: 0, grinder: 0 }
  const seen = new Set<string>()
  for (const r of results) {
    const key = `${r.kind}|${r.weekKey}`
    if (seen.has(key)) continue
    seen.add(key)
    const winner = resolveWinner(r, roster)
    if (winner) totals[winner][r.kind]++
  }
  return totals
}

/**
 * What the roster cards show (see the module doc). `history`: results of
 * completed weeks (later weeks are ignored); `race`: the current week's
 * rankings.
 */
export function buildWeeklyAwards(input: {
  now: number
  roster: readonly RosterRef[]
  history: readonly WeekResult[]
  race: Record<AwardKind, readonly AwardRaceEntry[]>
}): WeeklyAwards {
  const { now, roster } = input
  const currentKey = weekKeyOf(now)
  const lastKey = shiftWeekKey(currentKey, -1)
  const onRoster = new Set(roster.map((m) => m.id))
  const history = input.history.filter((r) => r.weekKey < currentKey)
  const race: Record<AwardKind, AwardRaceEntry[]> = {
    mvp: input.race.mvp.filter((e) => onRoster.has(e.memberId)),
    grinder: input.race.grinder.filter((e) => onRoster.has(e.memberId)),
  }
  const holders: AwardHolder[] = []
  for (const kind of AWARD_KINDS) {
    const last = history.find((r) => r.kind === kind && r.weekKey === lastKey)
    const winner = last ? resolveWinner(last, roster) : null
    if (last && winner) {
      holders.push({
        kind,
        memberId: winner,
        weekStart: weekStartFromKey(lastKey).toISOString(),
        live: false,
        value: last.value ?? 0,
        games: last.games ?? 0,
        streak: streakEnding(history, kind, winner, lastKey, roster),
      })
      continue
    }
    const leader = raceLeader(kind, race[kind])
    if (leader) {
      holders.push({
        kind,
        memberId: leader.memberId,
        weekStart: weekStartFromKey(currentKey).toISOString(),
        live: true,
        value: leader.value,
        games: leader.games,
        streak: 1 + streakEnding(history, kind, leader.memberId, lastKey, roster),
      })
    }
  }
  return { holders, totals: awardTotals(history, roster), race, computedAt: new Date(now).toISOString() }
}
