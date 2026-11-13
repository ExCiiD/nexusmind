/**
 * Assistant — A1 feature store.
 *
 * Pure functions only: the IPC layer loads rows from Prisma / MatchCache and
 * hands plain `GameRecord`s to this module, which turns them into normalised
 * per-game indicators (`GameFeatures`) and rolling per-player statistics
 * (`MetricStats`: personal mean, trend, z-score vs personal baseline).
 *
 * Every number here is reproducible from the player's own data — no model,
 * no network — so the rules built on top can always explain themselves.
 */

// ── Inputs ────────────────────────────────────────────────────────────────

export interface MistakeRecord {
  id: string
  tagSlug: string
  tagLabel?: string
  gameTimeSec: number
  recordingId?: string | null
  /** 1 = minor, 2 = standard, 3 = critical. Missing on older callers → treated as 2. */
  severity?: number
}

/** Lane-phase numbers extracted from a cached LanePhaseReport. */
export interface LaneRecord {
  grade: string
  numericScore?: number | null
  csAt10?: number | null
  csAt14?: number | null
  goldDiff10?: number | null
  goldDiff14?: number | null
}

export interface GameRecord {
  id: string
  matchId: string
  sessionId: string
  /** Game end, epoch ms. */
  endedAt: number
  durationSec: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  cs: number
  visionScore: number
  role: string
  champion: string
  /** Objectives of the session the game was played in. */
  objectiveIds: string[]
  reviewed: boolean
  kpiScores?: Record<string, number> | null
  objectiveRespected?: boolean | null
  lane?: LaneRecord | null
  /** In-game seconds of every death of the player (timeline), null = unknown. */
  deathTimesSec?: number[] | null
  /** Kill participation in percent (0–100), null = unknown. */
  killParticipation?: number | null
  /** The player's team's total gold minus the enemy team's, at game end. */
  finalGoldDiff?: number | null
  mistakes?: MistakeRecord[]
  recordingId?: string | null
}

// ── Per-game features ────────────────────────────────────────────────────

export const METRICS = [
  'csPerMin',
  'csAt10',
  'csAt14',
  'goldDiff10',
  'goldDiff14',
  'deaths',
  'deathsBefore10',
  'deathsBefore14',
  'visionPerMin',
  'kp',
  'kda',
  'laneScore',
  'kpiAvg',
  'objectiveRespected',
  'win',
  'perfIndex',
] as const

export type Metric = (typeof METRICS)[number]

/** Metrics where a higher value is worse (used for "perfIndex" and wording). */
export const LOWER_IS_BETTER: ReadonlySet<Metric> = new Set<Metric>(['deaths', 'deathsBefore10', 'deathsBefore14'])

export interface GameFeatures {
  gameId: string
  matchId: string
  sessionId: string
  endedAt: number
  role: string
  champion: string
  objectiveIds: string[]
  reviewed: boolean
  values: Record<Metric, number | null>
  mistakeCounts: Record<string, number>
  /** Kept to resolve "re-watch" actions. */
  deathTimesSec: number[] | null
  /** The player's team's total gold minus the enemy team's, at game end (null = unknown). */
  finalGoldDiff: number | null
  mistakes: MistakeRecord[]
  recordingId: string | null
  kpiScores: Record<string, number>
}

const LANE_GRADE_SCORE: Record<string, number> = { S: 95, 'A+': 82, A: 72, 'B+': 62, B: 52, C: 40, D: 28, F: 15 }

/** Riot role strings → our buckets. */
export function roleBucket(role: string): 'jungle' | 'support' | 'laner' {
  const r = role.toUpperCase()
  if (r.includes('JUNGLE')) return 'jungle'
  if (r.includes('UTILITY') || r.includes('SUPPORT')) return 'support'
  return 'laner'
}

function avgOf(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}

export function kpiAverage(scores: Record<string, number> | null | undefined): number | null {
  if (!scores) return null
  return avgOf(Object.values(scores).filter((v) => typeof v === 'number' && v > 0))
}

/** Extracts the lane numbers we need from a LanePhaseReport (schema v2). */
export function laneFromReport(report: unknown): LaneRecord | null {
  const r = report as {
    grade?: string
    scoreComponents?: { numericScore?: number }
    framesByMinute?: Array<{ minute: number; cs?: { player?: number }; gold?: { diff?: number } }>
  } | null
  if (!r || typeof r.grade !== 'string') return null
  const frames = Array.isArray(r.framesByMinute) ? r.framesByMinute : []
  const at = (m: number) => frames.find((f) => f.minute === m) ?? null
  const f10 = at(10)
  const f14 = at(14)
  return {
    grade: r.grade,
    numericScore: r.scoreComponents?.numericScore ?? null,
    csAt10: f10?.cs?.player ?? null,
    csAt14: f14?.cs?.player ?? null,
    goldDiff10: f10?.gold?.diff ?? null,
    goldDiff14: f14?.gold?.diff ?? null,
  }
}

export function computeGameFeatures(g: GameRecord): GameFeatures {
  const minutes = Math.max(g.durationSec / 60, 1)
  const deathTimes = g.deathTimesSec ?? null
  const kpiAvg = kpiAverage(g.kpiScores)
  const laneScore = g.lane
    ? (g.lane.numericScore ?? LANE_GRADE_SCORE[g.lane.grade] ?? null)
    : null

  const mistakeCounts: Record<string, number> = {}
  for (const m of g.mistakes ?? []) mistakeCounts[m.tagSlug] = (mistakeCounts[m.tagSlug] ?? 0) + 1

  const values: Record<Metric, number | null> = {
    csPerMin: g.cs / minutes,
    csAt10: g.lane?.csAt10 ?? null,
    csAt14: g.lane?.csAt14 ?? null,
    goldDiff10: g.lane?.goldDiff10 ?? null,
    goldDiff14: g.lane?.goldDiff14 ?? null,
    deaths: g.deaths,
    deathsBefore10: deathTimes ? deathTimes.filter((t) => t < 600).length : null,
    deathsBefore14: deathTimes ? deathTimes.filter((t) => t < 840).length : null,
    visionPerMin: g.visionScore / minutes,
    kp: g.killParticipation ?? null,
    kda: (g.kills + g.assists) / Math.max(g.deaths, 1),
    laneScore,
    kpiAvg,
    objectiveRespected: g.objectiveRespected == null ? null : g.objectiveRespected ? 1 : 0,
    win: g.win ? 1 : 0,
    perfIndex: null,
  }

  return {
    gameId: g.id,
    matchId: g.matchId,
    sessionId: g.sessionId,
    endedAt: g.endedAt,
    role: g.role,
    champion: g.champion,
    objectiveIds: g.objectiveIds,
    reviewed: g.reviewed,
    values,
    mistakeCounts,
    deathTimesSec: deathTimes,
    finalGoldDiff: g.finalGoldDiff ?? null,
    mistakes: g.mistakes ?? [],
    recordingId: g.recordingId ?? null,
    kpiScores: g.kpiScores ?? {},
  }
}

// ── Rolling statistics ───────────────────────────────────────────────────

export interface MetricStats {
  metric: Metric
  /** Non-null samples, oldest → newest. */
  values: number[]
  n: number
  mean: number | null
  sd: number | null
  /** Mean of the `recentWindow` newest samples. */
  recentMean: number | null
  /** Mean / sd of the samples before the recent window (personal baseline). */
  baselineMean: number | null
  baselineSd: number | null
  /** (recentMean - baselineMean) / baselineSd, null when not enough data. */
  z: number | null
  /** Least-squares slope per game over the last `trendWindow` samples. */
  trend: number | null
}

export function mean(xs: number[]): number | null {
  return avgOf(xs)
}

/** Sample standard deviation (n - 1). */
export function stdDev(xs: number[]): number | null {
  if (xs.length < 2) return null
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

/** Least-squares slope of ys against their index. */
export function slope(ys: number[]): number | null {
  const n = ys.length
  if (n < 3) return null
  const mx = (n - 1) / 2
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (ys[i] - my)
    den += (i - mx) ** 2
  }
  return den === 0 ? 0 : num / den
}

/** z-score with a floor on the sd so a near-constant baseline doesn't explode. */
export function zScore(value: number, baselineMean: number, baselineSd: number, minSd = 1e-6): number {
  const sd = Math.max(baselineSd, minSd, Math.abs(baselineMean) * 0.05)
  return (value - baselineMean) / sd
}

export interface StatsOptions {
  recentWindow?: number
  trendWindow?: number
  /** Minimum baseline samples before a z-score is reported. */
  minBaseline?: number
}

export function computeMetricStats(metric: Metric, values: number[], opts: StatsOptions = {}): MetricStats {
  const recentWindow = opts.recentWindow ?? 5
  const trendWindow = opts.trendWindow ?? 10
  const minBaseline = opts.minBaseline ?? 5
  const recent = values.slice(-recentWindow)
  const baseline = values.slice(0, Math.max(values.length - recentWindow, 0))
  const recentMean = mean(recent)
  const baselineMean = mean(baseline)
  const baselineSd = stdDev(baseline)
  const z =
    recentMean != null && baselineMean != null && baselineSd != null && baseline.length >= minBaseline
      ? zScore(recentMean, baselineMean, baselineSd)
      : null
  return {
    metric,
    values,
    n: values.length,
    mean: mean(values),
    sd: stdDev(values),
    recentMean,
    baselineMean,
    baselineSd,
    z,
    trend: slope(values.slice(-trendWindow)),
  }
}

/** Non-null samples of a metric, oldest → newest. */
export function series(games: GameFeatures[], metric: Metric): number[] {
  return [...games]
    .sort((a, b) => a.endedAt - b.endedAt)
    .map((g) => g.values[metric])
    .filter((v): v is number => v != null && Number.isFinite(v))
}

/**
 * Composite "objective performance" per game: mean of the player's personal
 * z-scores on stats they can't self-grade (CS/min, vision/min, KDA, deaths,
 * lane score). Used to detect self-assessment bias. Mutates `values.perfIndex`.
 */
export function attachPerfIndex(games: GameFeatures[]): void {
  const parts: Metric[] = ['csPerMin', 'visionPerMin', 'kda', 'deaths', 'laneScore']
  const ref = new Map<Metric, { m: number; sd: number }>()
  for (const metric of parts) {
    const xs = series(games, metric)
    const m = mean(xs)
    const sd = stdDev(xs)
    if (m != null && sd != null && xs.length >= 5) ref.set(metric, { m, sd })
  }
  for (const g of games) {
    const zs: number[] = []
    for (const [metric, { m, sd }] of ref) {
      const v = g.values[metric]
      if (v == null) continue
      const z = zScore(v, m, sd)
      zs.push(LOWER_IS_BETTER.has(metric) ? -z : z)
    }
    g.values.perfIndex = zs.length >= 2 ? zs.reduce((a, b) => a + b, 0) / zs.length : null
  }
}

// ── Sessions & player context ────────────────────────────────────────────

export interface SessionRecord {
  id: string
  /** Session start, epoch ms. */
  date: number
  status: string
  objectiveIds: string[]
  selectedKpiIds: string[]
}

export interface ObjectiveRun {
  objectiveId: string
  /** Consecutive most-recent sessions (completed or active) that include it. */
  sessions: number
  /** Per-session mean self-score on the objective's KPIs, oldest → newest. */
  kpiTrend: number | null
  respectRates: number[]
  progressing: boolean
}

export interface PlayerContext {
  /** Games sorted newest → oldest. */
  games: GameFeatures[]
  stats: Record<Metric, MetricStats>
  lossStreak: number
  winStreak: number
  activeSession: {
    id: string
    games: number
    /** From the first game's start to now (or last game end). */
    minutes: number
    losses: number
  } | null
  reviewRate: number | null
  unreviewed: number
  objectiveRun: ObjectiveRun | null
  /** Recent self-score minus baseline self-score (KPI points, 0–10 scale). */
  kpiDelta: number | null
  /** Mean perfIndex of the same recent games. */
  perfRecent: number | null
  now: number
}

/** Current streak of identical results, newest first. */
export function streak(games: GameFeatures[], win: boolean): number {
  let n = 0
  for (const g of games) {
    if ((g.values.win === 1) !== win) break
    n++
  }
  return n
}

function objectiveRun(sessions: SessionRecord[], games: GameFeatures[]): ObjectiveRun | null {
  const ordered = [...sessions].sort((a, b) => b.date - a.date)
  if (ordered.length === 0) return null
  const latest = ordered[0]
  let best: ObjectiveRun | null = null
  for (const objectiveId of latest.objectiveIds) {
    let count = 0
    for (const s of ordered) {
      if (!s.objectiveIds.includes(objectiveId)) break
      count++
    }
    const runSessions = ordered.slice(0, count).reverse()
    const perSessionKpi: number[] = []
    const respectRates: number[] = []
    for (const s of runSessions) {
      const sg = games.filter((g) => g.sessionId === s.id)
      const kpis = sg
        .map((g) => {
          const ids = s.selectedKpiIds.length ? s.selectedKpiIds : Object.keys(g.kpiScores)
          return avgOf(ids.map((id) => g.kpiScores[id]).filter((v): v is number => typeof v === 'number' && v > 0))
        })
        .filter((v): v is number => v != null)
      const m = mean(kpis)
      if (m != null) perSessionKpi.push(m)
      const flags = sg.map((g) => g.values.objectiveRespected).filter((v): v is number => v != null)
      if (flags.length) respectRates.push(flags.reduce((a, b) => a + b, 0) / flags.length)
    }
    const kpiTrend = perSessionKpi.length >= 3 ? slope(perSessionKpi) : null
    const respectTrend = respectRates.length >= 3 ? slope(respectRates) : null
    const progressing = (kpiTrend != null && kpiTrend > 0.15) || (respectTrend != null && respectTrend > 0.05)
    const run: ObjectiveRun = { objectiveId, sessions: count, kpiTrend, respectRates, progressing }
    if (!best || run.sessions > best.sessions) best = run
  }
  return best
}

/** A pause longer than this between two games ends a play stretch. */
export const BREAK_GAP_MIN = 45

/**
 * Minutes of continuous play up to now: walks back from the newest game and
 * stops at the first gap > BREAK_GAP_MIN. A session left "active" overnight
 * therefore doesn't count as hours of play, and a real break resets it.
 */
export function playStretchMinutes(games: Array<Pick<GameRecord, 'endedAt' | 'durationSec'>>, now: number): number {
  const ordered = [...games].sort((a, b) => b.endedAt - a.endedAt)
  if (ordered.length === 0) return 0
  const gapMs = BREAK_GAP_MIN * 60000
  if (now - ordered[0].endedAt > gapMs) return 0
  let start = ordered[0].endedAt - ordered[0].durationSec * 1000
  for (const g of ordered.slice(1)) {
    if (start - g.endedAt > gapMs) break
    start = g.endedAt - g.durationSec * 1000
  }
  return Math.max(0, (now - start) / 60000)
}

export interface BuildContextInput {
  games: GameRecord[]
  sessions: SessionRecord[]
  now: number
  statsOptions?: StatsOptions
}

export function buildPlayerContext({ games, sessions, now, statsOptions }: BuildContextInput): PlayerContext {
  const features = games.map(computeGameFeatures).sort((a, b) => b.endedAt - a.endedAt)
  attachPerfIndex(features)

  const stats = {} as Record<Metric, MetricStats>
  for (const metric of METRICS) stats[metric] = computeMetricStats(metric, series(features, metric), statsOptions)

  const active = sessions.find((s) => s.status === 'active') ?? null
  let activeSession: PlayerContext['activeSession'] = null
  if (active) {
    const sg = features.filter((g) => g.sessionId === active.id)
    const record = games.filter((g) => g.sessionId === active.id)
    activeSession = {
      id: active.id,
      games: sg.length,
      minutes: playStretchMinutes(record, now),
      losses: sg.filter((g) => g.values.win === 0).length,
    }
  }

  const last10 = features.slice(0, 10)
  const reviewRate = last10.length ? last10.filter((g) => g.reviewed).length / last10.length : null

  // Self-assessment vs objective stats over reviewed games.
  const reviewed = features.filter((g) => g.values.kpiAvg != null)
  const recentReviewed = reviewed.slice(0, 5)
  const baselineReviewed = reviewed.slice(5)
  const kpiRecent = mean(recentReviewed.map((g) => g.values.kpiAvg as number))
  const kpiBase = mean(baselineReviewed.map((g) => g.values.kpiAvg as number))
  const kpiDelta = kpiRecent != null && kpiBase != null && baselineReviewed.length >= 3 ? kpiRecent - kpiBase : null
  const perfRecent = mean(
    recentReviewed.map((g) => g.values.perfIndex).filter((v): v is number => v != null),
  )

  return {
    games: features,
    stats,
    lossStreak: streak(features, false),
    winStreak: streak(features, true),
    activeSession,
    reviewRate,
    unreviewed: last10.filter((g) => !g.reviewed).length,
    objectiveRun: objectiveRun(sessions.filter((s) => s.status !== 'cancelled'), features),
    kpiDelta,
    perfRecent,
    now,
  }
}
