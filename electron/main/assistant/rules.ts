/**
 * Assistant — A2 declarative rule engine.
 *
 * Rules are plain data (`RULES` below is JSON-serialisable): conditions over
 * the feature store, a priority, a confidence, an i18n message with params
 * and a suggested action. The engine evaluates them against a
 * `PlayerContext` and returns matches with their evidence, so every insight
 * can say exactly why it fired.
 *
 * Adding a rule = adding an object here + its i18n variants
 * (`assistant.rules.<id>.v1..vN` in en.json / fr.json). No code change.
 */

import { roleBucket, type GameFeatures, type Metric, type MetricStats, type PlayerContext } from './features'

export type Moment = 'post_game' | 'session' | 'weekly'
export type Op = '>=' | '<=' | '>' | '<' | '=='
export type Tone = 'positive' | 'warning' | 'negative' | 'neutral'

export type ContextKey =
  | 'lossStreak'
  | 'winStreak'
  | 'sessionMinutes'
  | 'sessionGames'
  | 'sessionLosses'
  | 'reviewRate'
  | 'unreviewed'
  | 'objectiveRunSessions'
  | 'objectiveProgressing'
  | 'kpiDelta'
  | 'perfRecent'
  | 'gamesTotal'

export type Condition =
  /** At least `atLeast` of the newest `of` games (with data) satisfy `metric op value`. */
  | { kind: 'count'; metric: Metric; op: Op; value: number; atLeast: number; of: number; as?: string }
  /** A rolling statistic of the metric (see MetricStats). */
  | { kind: 'stat'; metric: Metric; field: 'recentMean' | 'z' | 'trend' | 'mean'; op: Op; value: number; minGames?: number; as?: string }
  /** A player-level context value. */
  | { kind: 'context'; key: ContextKey; op: Op; value: number; as?: string }
  /** The target game's raw value (post-game moment). */
  | { kind: 'game'; metric: Metric; op: Op; value: number; as?: string }
  /** The target game vs the player's other games (z-score). */
  | { kind: 'gameZ'; metric: Metric; op: Op; value: number; minGames?: number; as?: string }
  /** Role bucket of the target / most recent game. */
  | { kind: 'role'; bucket: 'jungle' | 'support' | 'laner'; not?: boolean }
  /** Some mistake tag shows up in at least `atLeast` of the newest `of` games. */
  | { kind: 'recurringMistake'; atLeast: number; of: number; as?: string }

export type ActionSpec =
  | { type: 'objective'; objectiveId: string }
  | { type: 'neighbourObjective' }
  | { type: 'rewatch'; source: 'earlyDeaths' | 'mistake' }
  | { type: 'lanePhase' }
  | { type: 'break'; minutes: number }
  | { type: 'drill'; drillId: string }
  | { type: 'review' }
  /** Objective = the fundamental of the matched mistake tag's problem (problems.ts). */
  | { type: 'mistakeObjective' }

export type ParamSpec = string | { from: string; digits?: number; kind?: 'objective' }

export interface WhySpec {
  key: 'lastGames' | 'thisGame' | 'thisSession' | 'lastSessions' | 'baseline' | 'reviews'
  n?: string
}

export interface Rule {
  id: string
  moments: Moment[]
  tone: Tone
  /** 0–100: how important the insight is when it fires. */
  priority: number
  /** 0–1: how sure the heuristic is. */
  confidence: number
  /** Only the best-ranked rule of a group is kept. */
  group?: string
  /** Wellbeing rules: 👍/👎 feedback never re-weights them. */
  fixedWeight?: boolean
  when: Condition[]
  /** Number of phrasings in i18n (`assistant.rules.<id>.v1..vN`). */
  variants: number
  params?: Record<string, ParamSpec>
  why: WhySpec
  action?: ActionSpec
}

// ── Rules (data) ─────────────────────────────────────────────────────────

const ALL: Moment[] = ['post_game', 'session', 'weekly']
const TRENDS: Moment[] = ['session', 'weekly']

export const RULES: Rule[] = [
  // ─ Laning & deaths ─
  {
    id: 'early_deaths_pattern',
    moments: ALL,
    tone: 'negative',
    priority: 90,
    confidence: 0.85,
    group: 'early_deaths',
    when: [{ kind: 'count', metric: 'deathsBefore10', op: '>=', value: 2, atLeast: 3, of: 5 }],
    variants: 3,
    params: { count: 'c0.matched', n: 'c0.of' },
    why: { key: 'lastGames', n: 'c0.of' },
    action: { type: 'rewatch', source: 'earlyDeaths' },
  },
  {
    id: 'pg_early_deaths',
    moments: ['post_game'],
    tone: 'negative',
    priority: 80,
    confidence: 0.8,
    group: 'early_deaths',
    when: [{ kind: 'game', metric: 'deathsBefore10', op: '>=', value: 2 }],
    variants: 3,
    params: { deaths: 'c0.value' },
    why: { key: 'thisGame' },
    action: { type: 'rewatch', source: 'earlyDeaths' },
  },
  {
    id: 'high_deaths_trend',
    moments: TRENDS,
    tone: 'negative',
    priority: 75,
    confidence: 0.8,
    group: 'deaths',
    when: [{ kind: 'stat', metric: 'deaths', field: 'recentMean', op: '>=', value: 6, minGames: 5 }],
    variants: 2,
    params: { avg: { from: 'c0.value', digits: 1 }, n: 'c0.recentN' },
    why: { key: 'lastGames', n: 'c0.recentN' },
    action: { type: 'objective', objectiveId: 'tempo' },
  },
  {
    id: 'pg_deaths_spike',
    moments: ['post_game'],
    tone: 'negative',
    priority: 72,
    confidence: 0.75,
    group: 'deaths',
    when: [
      { kind: 'game', metric: 'deaths', op: '>=', value: 6 },
      { kind: 'gameZ', metric: 'deaths', op: '>=', value: 1, minGames: 5 },
    ],
    variants: 2,
    params: { deaths: 'c0.value', avg: { from: 'c1.avg', digits: 1 } },
    why: { key: 'baseline', n: 'c1.n' },
    action: { type: 'objective', objectiveId: 'tempo' },
  },
  {
    id: 'lane_weak_pattern',
    moments: TRENDS,
    tone: 'negative',
    priority: 70,
    confidence: 0.75,
    group: 'lane',
    when: [{ kind: 'count', metric: 'laneScore', op: '<=', value: 40, atLeast: 3, of: 5 }],
    variants: 2,
    params: { count: 'c0.matched', n: 'c0.of' },
    why: { key: 'lastGames', n: 'c0.of' },
    action: { type: 'objective', objectiveId: 'trades' },
  },
  {
    id: 'pg_lane_weak',
    moments: ['post_game'],
    tone: 'warning',
    priority: 62,
    confidence: 0.7,
    group: 'lane',
    when: [{ kind: 'game', metric: 'laneScore', op: '<=', value: 40 }],
    variants: 2,
    why: { key: 'thisGame' },
    action: { type: 'lanePhase' },
  },
  {
    id: 'pg_lane_strong',
    moments: ['post_game'],
    tone: 'positive',
    priority: 50,
    confidence: 0.75,
    group: 'lane',
    when: [{ kind: 'game', metric: 'laneScore', op: '>=', value: 72 }],
    variants: 3,
    why: { key: 'thisGame' },
    action: { type: 'lanePhase' },
  },

  // ─ Farming ─
  {
    id: 'cs_trend_down',
    moments: TRENDS,
    tone: 'warning',
    priority: 60,
    confidence: 0.7,
    group: 'cs',
    when: [
      { kind: 'role', bucket: 'support', not: true },
      { kind: 'stat', metric: 'csPerMin', field: 'z', op: '<=', value: -1, minGames: 10 },
      { kind: 'stat', metric: 'csPerMin', field: 'trend', op: '<', value: 0 },
    ],
    variants: 2,
    params: { recent: { from: 'c1.recentMean', digits: 1 }, base: { from: 'c1.baselineMean', digits: 1 }, n: 'c1.n' },
    why: { key: 'lastGames', n: 'c1.n' },
    action: { type: 'drill', drillId: 'last_hit' },
  },
  {
    id: 'cs_trend_up',
    moments: TRENDS,
    tone: 'positive',
    priority: 45,
    confidence: 0.7,
    group: 'cs',
    when: [
      { kind: 'role', bucket: 'support', not: true },
      { kind: 'stat', metric: 'csPerMin', field: 'z', op: '>=', value: 1, minGames: 10 },
    ],
    variants: 2,
    params: { recent: { from: 'c1.recentMean', digits: 1 }, base: { from: 'c1.baselineMean', digits: 1 } },
    why: { key: 'lastGames', n: 'c1.n' },
  },
  {
    id: 'cs10_low',
    moments: TRENDS,
    tone: 'warning',
    priority: 58,
    confidence: 0.7,
    group: 'cs',
    when: [
      { kind: 'role', bucket: 'laner' },
      { kind: 'stat', metric: 'csAt10', field: 'recentMean', op: '<', value: 60, minGames: 3 },
    ],
    variants: 2,
    params: { cs: { from: 'c1.value', digits: 0 }, n: 'c1.recentN' },
    why: { key: 'lastGames', n: 'c1.recentN' },
    action: { type: 'objective', objectiveId: 'csing_pathing' },
  },
  {
    id: 'pg_cs_low',
    moments: ['post_game'],
    tone: 'warning',
    priority: 55,
    confidence: 0.65,
    group: 'cs',
    when: [
      { kind: 'role', bucket: 'support', not: true },
      { kind: 'gameZ', metric: 'csPerMin', op: '<=', value: -1, minGames: 5 },
    ],
    variants: 2,
    params: { cs: { from: 'c1.value', digits: 1 }, avg: { from: 'c1.avg', digits: 1 } },
    why: { key: 'baseline', n: 'c1.n' },
    action: { type: 'objective', objectiveId: 'csing_pathing' },
  },
  {
    id: 'pg_cs_high',
    moments: ['post_game'],
    tone: 'positive',
    priority: 48,
    confidence: 0.7,
    group: 'cs',
    when: [
      { kind: 'role', bucket: 'support', not: true },
      { kind: 'gameZ', metric: 'csPerMin', op: '>=', value: 1, minGames: 5 },
    ],
    variants: 3,
    params: { cs: { from: 'c1.value', digits: 1 }, avg: { from: 'c1.avg', digits: 1 } },
    why: { key: 'baseline', n: 'c1.n' },
  },

  // ─ Vision & map ─
  {
    id: 'vision_drop',
    moments: TRENDS,
    tone: 'warning',
    priority: 60,
    confidence: 0.7,
    group: 'vision',
    when: [{ kind: 'stat', metric: 'visionPerMin', field: 'z', op: '<=', value: -1, minGames: 10 }],
    variants: 2,
    params: { recent: { from: 'c0.recentMean', digits: 2 }, base: { from: 'c0.baselineMean', digits: 2 } },
    why: { key: 'lastGames', n: 'c0.n' },
    action: { type: 'objective', objectiveId: 'vision_control' },
  },
  {
    id: 'pg_vision_low',
    moments: ['post_game'],
    tone: 'warning',
    priority: 52,
    confidence: 0.65,
    group: 'vision',
    when: [{ kind: 'gameZ', metric: 'visionPerMin', op: '<=', value: -1.2, minGames: 5 }],
    variants: 2,
    params: { vision: { from: 'c0.value', digits: 2 }, avg: { from: 'c0.avg', digits: 2 } },
    why: { key: 'baseline', n: 'c0.n' },
    action: { type: 'drill', drillId: 'ward_timers' },
  },
  {
    id: 'pg_vision_high',
    moments: ['post_game'],
    tone: 'positive',
    priority: 42,
    confidence: 0.65,
    group: 'vision',
    when: [{ kind: 'gameZ', metric: 'visionPerMin', op: '>=', value: 1.2, minGames: 5 }],
    variants: 2,
    params: { vision: { from: 'c0.value', digits: 2 }, avg: { from: 'c0.avg', digits: 2 } },
    why: { key: 'baseline', n: 'c0.n' },
  },
  {
    id: 'low_kp',
    moments: TRENDS,
    tone: 'warning',
    priority: 50,
    confidence: 0.6,
    when: [
      { kind: 'role', bucket: 'laner', not: true },
      { kind: 'stat', metric: 'kp', field: 'recentMean', op: '<', value: 45, minGames: 5 },
    ],
    variants: 2,
    params: { kp: { from: 'c1.value', digits: 0 }, n: 'c1.recentN' },
    why: { key: 'lastGames', n: 'c1.recentN' },
    action: { type: 'objective', objectiveId: 'map_awareness' },
  },

  // ─ Self-assessment ─
  {
    id: 'kpi_bias',
    moments: TRENDS,
    tone: 'warning',
    priority: 80,
    confidence: 0.65,
    group: 'bias',
    when: [
      { kind: 'context', key: 'kpiDelta', op: '>=', value: 0.75 },
      { kind: 'context', key: 'perfRecent', op: '<=', value: -0.5 },
    ],
    variants: 3,
    params: { delta: { from: 'c0.value', digits: 1 } },
    why: { key: 'reviews', n: 'const.5' },
  },
  {
    id: 'pg_self_bias',
    moments: ['post_game'],
    tone: 'warning',
    priority: 70,
    confidence: 0.6,
    group: 'bias',
    when: [
      { kind: 'game', metric: 'kpiAvg', op: '>=', value: 7.5 },
      { kind: 'game', metric: 'perfIndex', op: '<=', value: -0.75 },
    ],
    variants: 2,
    params: { score: { from: 'c0.value', digits: 1 } },
    why: { key: 'thisGame' },
  },
  {
    id: 'pg_harsh_self',
    moments: ['post_game'],
    tone: 'positive',
    priority: 45,
    confidence: 0.55,
    group: 'bias',
    when: [
      { kind: 'game', metric: 'kpiAvg', op: '<=', value: 4.5 },
      { kind: 'game', metric: 'perfIndex', op: '>=', value: 0.75 },
    ],
    variants: 2,
    params: { score: { from: 'c0.value', digits: 1 } },
    why: { key: 'thisGame' },
  },
  {
    id: 'review_backlog',
    moments: TRENDS,
    tone: 'neutral',
    priority: 50,
    confidence: 0.9,
    when: [{ kind: 'context', key: 'unreviewed', op: '>=', value: 4 }],
    variants: 2,
    params: { count: 'c0.value' },
    why: { key: 'lastGames', n: 'const.10' },
    action: { type: 'review' },
  },

  // ─ Objectives ─
  {
    id: 'objective_stagnation',
    moments: TRENDS,
    tone: 'warning',
    priority: 70,
    confidence: 0.7,
    group: 'objective',
    when: [
      { kind: 'context', key: 'objectiveRunSessions', op: '>=', value: 4 },
      { kind: 'context', key: 'objectiveProgressing', op: '==', value: 0 },
    ],
    variants: 2,
    params: { sessions: 'c0.value', objective: { from: 'run.objectiveId', kind: 'objective' } },
    why: { key: 'lastSessions', n: 'c0.value' },
    action: { type: 'neighbourObjective' },
  },
  {
    id: 'objective_progress',
    moments: ALL,
    tone: 'positive',
    priority: 50,
    confidence: 0.7,
    group: 'objective',
    when: [
      { kind: 'context', key: 'objectiveRunSessions', op: '>=', value: 3 },
      { kind: 'context', key: 'objectiveProgressing', op: '==', value: 1 },
    ],
    variants: 2,
    params: { sessions: 'c0.value', objective: { from: 'run.objectiveId', kind: 'objective' } },
    why: { key: 'lastSessions', n: 'c0.value' },
  },
  {
    id: 'pg_objective_respected',
    moments: ['post_game'],
    tone: 'positive',
    priority: 40,
    confidence: 0.8,
    group: 'objective_game',
    when: [{ kind: 'game', metric: 'objectiveRespected', op: '==', value: 1 }],
    variants: 3,
    why: { key: 'thisGame' },
  },
  {
    id: 'recurring_mistake',
    moments: ALL,
    tone: 'negative',
    priority: 72,
    confidence: 0.8,
    when: [{ kind: 'recurringMistake', atLeast: 3, of: 5 }],
    variants: 2,
    params: { tag: 'c0.tagLabel', count: 'c0.matched', n: 'c0.of' },
    why: { key: 'lastGames', n: 'c0.of' },
    action: { type: 'rewatch', source: 'mistake' },
  },
  {
    // AS2 / MX4: a tag in ≥ 40 % of the last 10 games becomes the objective to work on.
    id: 'dominant_mistake',
    moments: TRENDS,
    tone: 'negative',
    priority: 74,
    confidence: 0.75,
    when: [{ kind: 'recurringMistake', atLeast: 4, of: 10 }],
    variants: 2,
    params: { tag: 'c0.tagLabel', count: 'c0.matched', n: 'c0.of' },
    why: { key: 'lastGames', n: 'c0.of' },
    action: { type: 'mistakeObjective' },
  },

  // ─ Mental ─
  {
    id: 'tilt_break',
    moments: ['session', 'post_game'],
    tone: 'negative',
    priority: 100,
    confidence: 0.85,
    group: 'tilt',
    fixedWeight: true,
    when: [
      { kind: 'context', key: 'lossStreak', op: '>=', value: 3 },
      { kind: 'context', key: 'sessionMinutes', op: '>=', value: 120 },
    ],
    variants: 3,
    params: { losses: 'c0.value', hours: { from: 'c1.hours', digits: 1 } },
    why: { key: 'thisSession' },
    action: { type: 'break', minutes: 15 },
  },
  {
    id: 'loss_streak',
    moments: ['session', 'post_game'],
    tone: 'warning',
    priority: 85,
    confidence: 0.75,
    group: 'tilt',
    when: [{ kind: 'context', key: 'lossStreak', op: '>=', value: 3 }],
    variants: 2,
    params: { losses: 'c0.value' },
    why: { key: 'lastGames', n: 'c0.value' },
    action: { type: 'break', minutes: 10 },
  },
  {
    id: 'long_session',
    moments: ['session', 'post_game'],
    tone: 'neutral',
    priority: 55,
    confidence: 0.7,
    group: 'tilt',
    when: [{ kind: 'context', key: 'sessionGames', op: '>=', value: 6 }],
    variants: 2,
    params: { games: 'c0.value' },
    why: { key: 'thisSession' },
    action: { type: 'break', minutes: 10 },
  },
  {
    id: 'win_streak',
    moments: ALL,
    tone: 'positive',
    priority: 45,
    confidence: 0.8,
    when: [{ kind: 'context', key: 'winStreak', op: '>=', value: 3 }],
    variants: 3,
    params: { wins: 'c0.value' },
    why: { key: 'lastGames', n: 'c0.value' },
  },
]

// ── Engine ───────────────────────────────────────────────────────────────

type Evidence = Record<string, number | string | null>

export interface ConditionResult {
  ok: boolean
  evidence: Evidence
  /** Games that satisfied the condition (used to resolve re-watch actions). */
  games?: GameFeatures[]
  tagSlug?: string
}

export interface EvalTarget {
  moment: Moment
  /** Game the post-game moment is about. */
  gameId?: string | null
}

export function compare(a: number, op: Op, b: number): boolean {
  switch (op) {
    case '>=': return a >= b
    case '<=': return a <= b
    case '>': return a > b
    case '<': return a < b
    case '==': return Math.abs(a - b) < 1e-9
  }
}

function contextValue(ctx: PlayerContext, key: ContextKey): number | null {
  switch (key) {
    case 'lossStreak': return ctx.lossStreak
    case 'winStreak': return ctx.winStreak
    case 'sessionMinutes': return ctx.activeSession?.minutes ?? null
    case 'sessionGames': return ctx.activeSession?.games ?? null
    case 'sessionLosses': return ctx.activeSession?.losses ?? null
    case 'reviewRate': return ctx.reviewRate
    case 'unreviewed': return ctx.unreviewed
    case 'objectiveRunSessions': return ctx.objectiveRun?.sessions ?? null
    case 'objectiveProgressing': return ctx.objectiveRun ? (ctx.objectiveRun.progressing ? 1 : 0) : null
    case 'kpiDelta': return ctx.kpiDelta
    case 'perfRecent': return ctx.perfRecent
    case 'gamesTotal': return ctx.games.length
  }
}

function statField(s: MetricStats, field: 'recentMean' | 'z' | 'trend' | 'mean'): number | null {
  return s[field]
}

/** Games up to and including the target (newest first). Post-game rules ignore later games. */
function gamesUpTo(ctx: PlayerContext, target: EvalTarget): GameFeatures[] {
  if (!target.gameId) return ctx.games
  const idx = ctx.games.findIndex((g) => g.gameId === target.gameId)
  return idx < 0 ? ctx.games : ctx.games.slice(idx)
}

export function evaluateCondition(c: Condition, ctx: PlayerContext, target: EvalTarget): ConditionResult {
  const games = gamesUpTo(ctx, target)
  const targetGame = target.gameId ? ctx.games.find((g) => g.gameId === target.gameId) ?? null : null
  switch (c.kind) {
    case 'count': {
      const withData = games.filter((g) => g.values[c.metric] != null).slice(0, c.of)
      if (withData.length < c.of) return { ok: false, evidence: {} }
      const hits = withData.filter((g) => compare(g.values[c.metric] as number, c.op, c.value))
      return { ok: hits.length >= c.atLeast, evidence: { matched: hits.length, of: c.of }, games: hits }
    }
    case 'stat': {
      const s = ctx.stats[c.metric]
      if (!s || s.n < (c.minGames ?? 1)) return { ok: false, evidence: {} }
      const v = statField(s, c.field)
      if (v == null) return { ok: false, evidence: {} }
      return {
        ok: compare(v, c.op, c.value),
        evidence: {
          value: v,
          n: s.n,
          recentN: Math.min(s.n, 5),
          mean: s.mean,
          recentMean: s.recentMean,
          baselineMean: s.baselineMean,
        },
      }
    }
    case 'context': {
      const v = contextValue(ctx, c.key)
      if (v == null) return { ok: false, evidence: {} }
      return { ok: compare(v, c.op, c.value), evidence: { value: v, hours: v / 60 } }
    }
    case 'game': {
      const v = targetGame?.values[c.metric]
      if (v == null) return { ok: false, evidence: {} }
      return { ok: compare(v, c.op, c.value), evidence: { value: v }, games: [targetGame!] }
    }
    case 'gameZ': {
      if (!targetGame) return { ok: false, evidence: {} }
      const v = targetGame.values[c.metric]
      const others = ctx.games
        .filter((g) => g.gameId !== targetGame.gameId)
        .map((g) => g.values[c.metric])
        .filter((x): x is number => x != null)
      if (v == null || others.length < (c.minGames ?? 5)) return { ok: false, evidence: {} }
      const m = others.reduce((a, b) => a + b, 0) / others.length
      const sd = Math.sqrt(others.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(others.length - 1, 1))
      const z = (v - m) / Math.max(sd, 1e-6, Math.abs(m) * 0.05)
      return { ok: compare(z, c.op, c.value), evidence: { value: v, z, avg: m, n: others.length }, games: [targetGame] }
    }
    case 'role': {
      const g = targetGame ?? ctx.games[0]
      if (!g) return { ok: false, evidence: {} }
      const is = roleBucket(g.role) === c.bucket
      return { ok: c.not ? !is : is, evidence: { role: g.role } }
    }
    case 'recurringMistake': {
      const window = games.slice(0, c.of)
      if (window.length < c.of) return { ok: false, evidence: {} }
      const perTag = new Map<string, GameFeatures[]>()
      for (const g of window) {
        for (const slug of Object.keys(g.mistakeCounts)) {
          perTag.set(slug, [...(perTag.get(slug) ?? []), g])
        }
      }
      let best: [string, GameFeatures[]] | null = null
      for (const entry of perTag) if (!best || entry[1].length > best[1].length) best = entry
      if (!best) return { ok: false, evidence: {} }
      // A post-game insight about mistakes must involve the game just played.
      if (targetGame && !best[1].includes(targetGame)) return { ok: false, evidence: {} }
      const label = best[1][0].mistakes.find((m) => m.tagSlug === best![0])?.tagLabel ?? best[0]
      return {
        ok: best[1].length >= c.atLeast,
        evidence: { tag: best[0], tagLabel: label, matched: best[1].length, of: c.of },
        games: best[1],
        tagSlug: best[0],
      }
    }
  }
}

export interface RuleMatch {
  rule: Rule
  evidence: Record<string, Evidence>
  results: ConditionResult[]
  /** What the insight is about — used to build a stable insight key. */
  subject: string
}

function subjectFor(ctx: PlayerContext, target: EvalTarget): string {
  if (target.moment === 'post_game') return target.gameId ?? ctx.games[0]?.gameId ?? 'none'
  if (target.moment === 'session') return ctx.activeSession?.id ?? `day-${new Date(ctx.now).toISOString().slice(0, 10)}`
  const d = new Date(ctx.now)
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)))
  return `week-${monday.toISOString().slice(0, 10)}`
}

export function evaluateRule(rule: Rule, ctx: PlayerContext, target: EvalTarget): RuleMatch | null {
  if (!rule.moments.includes(target.moment)) return null
  const results: ConditionResult[] = []
  const evidence: Record<string, Evidence> = {}
  for (const [i, c] of rule.when.entries()) {
    const r = evaluateCondition(c, ctx, target)
    if (!r.ok) return null
    results.push(r)
    evidence[('as' in c && c.as) || `c${i}`] = r.evidence
  }
  if (ctx.objectiveRun) evidence.run = { objectiveId: ctx.objectiveRun.objectiveId }
  return { rule, evidence, results, subject: subjectFor(ctx, target) }
}

export function evaluateRules(rules: Rule[], ctx: PlayerContext, target: EvalTarget): RuleMatch[] {
  if (target.moment === 'post_game' && target.gameId && !ctx.games.some((g) => g.gameId === target.gameId)) return []
  return rules.map((r) => evaluateRule(r, ctx, target)).filter((m): m is RuleMatch => m != null)
}

/** Resolves `c0.value`, `run.objectiveId` or `const.10` against a match's evidence. */
export function resolvePath(evidence: Record<string, Evidence>, path: string): number | string | null {
  const [head, field] = path.split('.')
  if (head === 'const') return Number(field)
  return evidence[head]?.[field] ?? null
}

export function resolveParams(
  match: RuleMatch,
): { params: Record<string, number | string>; paramKinds: Record<string, 'objective'> } {
  const params: Record<string, number | string> = {}
  const paramKinds: Record<string, 'objective'> = {}
  for (const [name, spec] of Object.entries(match.rule.params ?? {})) {
    const from = typeof spec === 'string' ? spec : spec.from
    const raw = resolvePath(match.evidence, from)
    if (raw == null) continue
    if (typeof raw === 'number') {
      const digits = typeof spec === 'string' ? (Number.isInteger(raw) ? 0 : 1) : (spec.digits ?? (Number.isInteger(raw) ? 0 : 1))
      params[name] = Number(raw.toFixed(digits))
    } else {
      params[name] = raw
    }
    if (typeof spec !== 'string' && spec.kind === 'objective') paramKinds[name] = 'objective'
  }
  return { params, paramKinds }
}
