/**
 * Coaching engine — closed loop (docs/MOTEUR_REGLES.md §2 ⑤).
 *
 * A prescription becomes an *experiment*: a measurable criterion checked on
 * each of the next N games, then a verdict:
 *   acquired     criterion held in ≥ 70 % of the games
 *   progressing  not there yet, but clearly better than the player's baseline
 *   no_effect    neither
 * Verdicts feed back into the diagnosis (outcome-based learning) and into
 * "graduated" fundamentals (two acquired verdicts in a row).
 *
 * Pure functions; persistence lives in assistant.ipc.ts.
 */

import { mean, roleBucket, type GameFeatures, type Metric, type PlayerContext } from './features'
import { PROBLEMS, problemById, type Problem } from './problems'
import type { RuleVotes } from './weights'

export type Criterion =
  /** The game's metric must satisfy `op target`. */
  | { kind: 'metric'; metric: Metric; op: '<=' | '>='; target: number }
  /** None of these mistake tags in the game (games without a parsed timeline are skipped). */
  | { kind: 'noMistake'; tags: string[]; label?: string }

export interface Baseline {
  /** Metric criteria: personal mean before the experiment. */
  mean?: number | null
  /** noMistake criteria: share of recent games that had one of the tags. */
  rate?: number | null
  games: number
}

export type Verdict = 'acquired' | 'progressing' | 'no_effect'

export interface ExperimentInput {
  problemId: string
  criterion: Criterion
  baseline: Baseline
  windowGames: number
  /** Epoch ms; only games that ended after it count. */
  startedAt: number
}

export interface GameResult {
  gameId: string
  passed: boolean
  value: number | null
}

export interface ExperimentProgress {
  results: GameResult[]
  counted: number
  passes: number
  passRate: number | null
  done: boolean
  verdict: Verdict | null
}

export const DEFAULT_WINDOW = 5
export const ACQUIRED_RATE = 0.7
/** Recently mastered problems step aside for this long. */
export const MASTERED_DAYS = 14
export const MASTERED_FACTOR = 0.6

const round = (v: number, digits: number) => Number(v.toFixed(digits))

/** Mean of the metric over the newest 10 games (needs 3 values). */
function baselineMean(games: GameFeatures[], metric: Metric): number | null {
  const values = games.slice(0, 10).map((g) => g.values[metric]).filter((v): v is number => v != null)
  return values.length >= 3 ? mean(values) : null
}

/**
 * The measurable criterion for a problem, tailored to the player's baseline
 * (a small, reachable step). Null when the problem has nothing measurable
 * for this role. `before`: the games the baseline is taken from (default: all).
 */
export function criterionForProblem(
  problem: Problem,
  ctx: PlayerContext,
  tagSlug?: string | null,
  tagLabel?: string | null,
  before: GameFeatures[] = ctx.games,
): Criterion | null {
  const role = roleBucket(ctx.games[0]?.role ?? '')
  if (tagSlug) return { kind: 'noMistake', tags: [tagSlug], ...(tagLabel ? { label: tagLabel } : {}) }
  switch (problem.id) {
    case 'laning':
      return { kind: 'metric', metric: 'deathsBefore14', op: '<=', target: 1 }
    case 'deaths': {
      const m = baselineMean(before, 'deaths')
      return { kind: 'metric', metric: 'deaths', op: '<=', target: m == null ? 4 : Math.max(2, Math.floor(m - 1)) }
    }
    case 'farming': {
      if (role === 'support') return null
      const m = baselineMean(before, 'csPerMin')
      return { kind: 'metric', metric: 'csPerMin', op: '>=', target: m == null ? 6 : Math.min(10, round(m + 0.5, 1)) }
    }
    case 'vision': {
      const m = baselineMean(before, 'visionPerMin')
      return { kind: 'metric', metric: 'visionPerMin', op: '>=', target: m == null ? 1 : round(m + 0.15, 2) }
    }
    case 'map-awareness': {
      const m = baselineMean(before, 'kp')
      return { kind: 'metric', metric: 'kp', op: '>=', target: m == null ? 50 : Math.min(80, Math.round(m + 5)) }
    }
    default:
      return problem.mistakeTags.length && !problem.unscored ? { kind: 'noMistake', tags: problem.mistakeTags } : null
  }
}

/** Problem whose fundamental is this objective (to start an experiment from a session objective). */
export function problemForObjective(objectiveId: string): Problem | null {
  return PROBLEMS.find((p) => p.fundamentalId === objectiveId && !p.unscored) ?? null
}

/** Null when the game has no data for the criterion. */
export function evaluateCriterion(c: Criterion, g: GameFeatures): { passed: boolean; value: number | null } | null {
  if (c.kind === 'metric') {
    const v = g.values[c.metric]
    if (v == null) return null
    return { passed: c.op === '<=' ? v <= c.target : v >= c.target, value: round(v, 2) }
  }
  // Without a parsed timeline the Mistake Library has not run: unknown, not "clean".
  if (g.deathTimesSec == null && g.mistakes.length === 0) return null
  const hits = g.mistakes.filter((m) => c.tags.includes(m.tagSlug)).length
  return { passed: hits === 0, value: hits }
}

/** `games`: the player's games before the experiment, newest first. */
export function baselineFor(c: Criterion, games: GameFeatures[], windowGames = 10): Baseline {
  const recent = games.slice(0, windowGames)
  if (c.kind === 'metric') {
    const values = recent.map((g) => g.values[c.metric]).filter((v): v is number => v != null)
    return { mean: values.length ? round(mean(values)!, 2) : null, games: values.length }
  }
  const evaluable = recent.map((g) => evaluateCriterion(c, g)).filter((r): r is NonNullable<typeof r> => r != null)
  return { rate: evaluable.length ? round(evaluable.filter((r) => !r.passed).length / evaluable.length, 2) : null, games: evaluable.length }
}

function improved(exp: ExperimentInput, results: GameResult[]): boolean {
  const passRate = results.filter((r) => r.passed).length / results.length
  const c = exp.criterion
  if (c.kind === 'metric') {
    const b = exp.baseline.mean
    const values = results.map((r) => r.value).filter((v): v is number => v != null)
    const m = mean(values)
    if (b == null || m == null) return passRate >= 0.4
    // At least half-way from the baseline to the target, in the right direction.
    const halfway = b + (c.target - b) / 2
    return c.op === '<=' ? m <= Math.min(halfway, b - 0.25) : m >= Math.max(halfway, b + 1e-9)
  }
  const b = exp.baseline.rate
  const failRate = 1 - passRate
  if (b == null || b === 0) return passRate >= 0.4
  return failRate <= b * 0.7
}

/** Games are newest → oldest (as in PlayerContext); the window takes the first N games after the start. */
export function evaluateExperiment(exp: ExperimentInput, games: GameFeatures[]): ExperimentProgress {
  const after = games.filter((g) => g.endedAt > exp.startedAt).sort((a, b) => a.endedAt - b.endedAt)
  const results: GameResult[] = []
  for (const g of after) {
    const r = evaluateCriterion(exp.criterion, g)
    if (!r) continue
    results.push({ gameId: g.gameId, ...r })
    if (results.length >= exp.windowGames) break
  }
  const passes = results.filter((r) => r.passed).length
  const passRate = results.length ? round(passes / results.length, 2) : null
  const done = results.length >= exp.windowGames
  let verdict: Verdict | null = null
  if (done) verdict = passRate! >= ACQUIRED_RATE ? 'acquired' : improved(exp, results) ? 'progressing' : 'no_effect'
  return { results, counted: results.length, passes, passRate, done, verdict }
}

// ── Outcomes → diagnosis ──────────────────────────────────────────────────

export interface FinishedExperiment {
  problemId: string
  fundamentalId: string | null
  ruleId: string | null
  verdict: Verdict
  endedAt: number
}

export interface ProblemOutcome {
  /** Last verdict was "acquired" less than MASTERED_DAYS ago. */
  mastered: boolean
  /** The last two verdicts were "no effect": try another angle. */
  stuck: boolean
}

/** Newest first. */
export function problemOutcomes(finished: FinishedExperiment[], now: number): Record<string, ProblemOutcome> {
  const byProblem = new Map<string, FinishedExperiment[]>()
  for (const f of [...finished].sort((a, b) => b.endedAt - a.endedAt)) {
    byProblem.set(f.problemId, [...(byProblem.get(f.problemId) ?? []), f])
  }
  const out: Record<string, ProblemOutcome> = {}
  for (const [id, list] of byProblem) {
    out[id] = {
      mastered: list[0].verdict === 'acquired' && now - list[0].endedAt < MASTERED_DAYS * 86_400_000,
      stuck: list.length >= 2 && list[0].verdict === 'no_effect' && list[1].verdict === 'no_effect',
    }
  }
  return out
}

/** A fundamental is graduated after two "acquired" verdicts in a row on it. */
export function graduatedFundamentals(finished: FinishedExperiment[]): string[] {
  const byFundamental = new Map<string, Verdict[]>()
  for (const f of [...finished].sort((a, b) => b.endedAt - a.endedAt)) {
    if (!f.fundamentalId) continue
    byFundamental.set(f.fundamentalId, [...(byFundamental.get(f.fundamentalId) ?? []), f.verdict])
  }
  return [...byFundamental].filter(([, v]) => v[0] === 'acquired' && v[1] === 'acquired').map(([id]) => id)
}

/**
 * Verdicts count as strong feedback on the rule that prescribed the
 * experiment: acquired = 2 👍, progressing = 1 👍, no effect = 1 👎.
 */
export function outcomeVotes(finished: FinishedExperiment[], votes: Record<string, RuleVotes> = {}): Record<string, RuleVotes> {
  const out: Record<string, RuleVotes> = Object.fromEntries(Object.entries(votes).map(([k, v]) => [k, { ...v }]))
  for (const f of finished) {
    if (!f.ruleId) continue
    const t = (out[f.ruleId] ??= { up: 0, down: 0 })
    if (f.verdict === 'acquired') t.up += 2
    else if (f.verdict === 'progressing') t.up += 1
    else t.down += 1
  }
  return out
}

/** What the renderer gets (and what an AssistantReport carries). */
export interface ExperimentView {
  id: string
  problemId: string
  fundamentalId: string | null
  tagSlug: string | null
  criterion: Criterion
  baseline: Baseline
  windowGames: number
  source: string
  status: 'active' | 'done' | 'abandoned'
  verdict: Verdict | null
  startedAt: number
  endedAt: number | null
  progress: ExperimentProgress
  /** This verdict made the fundamental "graduated" (2 acquired in a row). */
  graduated: boolean
  /** Next fundamental to work on after graduating. */
  nextObjectiveId: string | null
}

export function isKnownProblem(id: string): boolean {
  return problemById(id) != null
}
