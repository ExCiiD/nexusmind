/**
 * Coaching engine — diagnosis and priority (docs/MOTEUR_REGLES.md §2 ②–③).
 *
 *   rule matches ──► grouped by problem (+ polarity) ──► one diagnosis each
 *
 * score = urgency × combined confidence × learned weight
 *         × impact on winning × persistence × actionability × anti-repetition
 *
 * Pure functions; the IPC layer supplies the advice history.
 */

import { MASTERED_FACTOR, type ProblemOutcome } from './experiments'
import { roleBucket, type GameFeatures, type PlayerContext } from './features'
import { problemForRule, type Problem, type RoleBucket } from './problems'
import type { WinDrivers } from './regression'
import type { Moment, RuleMatch } from './rules'
import { ruleMultiplier, type RuleVotes } from './weights'

export type Polarity = 'negative' | 'positive'

/** How often a problem was already shown before today (from the AdviceLog table). */
export interface AdviceHistory {
  /** Distinct days in the last 7 (today excluded) on which the problem was shown. */
  priorDays: number
  /** Last time it was shown before today, epoch ms. */
  lastShownAt: number
}

export interface ScoredMatch {
  match: RuleMatch
  /** priority × confidence × learned weight (the pre-engine score). */
  base: number
}

export interface Diagnosis {
  problem: Problem
  polarity: Polarity
  lead: ScoredMatch
  support: ScoredMatch[]
  /** Noisy-OR of the confidences of every distinct rule involved. */
  confidence: number
  /** 0–1: share of recent games showing the problem (1 = a current state). */
  persistence: number
  /** 0.7–1.6: how much this problem weighs on winning for this player. */
  impact: number
  /** True when anti-repetition lowered the score. */
  repeated: boolean
  /** Recently acquired in an experiment: stepped aside. */
  mastered: boolean
  /** Two experiments in a row without effect: suggest another angle. */
  stuck: boolean
  score: number
  gameIds: string[]
}

export interface DiagnoseOptions {
  moment: Moment
  votesByRule?: Record<string, RuleVotes>
  drivers?: WinDrivers | null
  history?: Record<string, AdviceHistory>
  /** Verdicts of past experiments, per problem. */
  outcomes?: Record<string, ProblemOutcome>
}

export const MAX_CONFIDENCE = 0.97
/** A problem shown on this many previous days without new evidence is demoted. */
export const REPEAT_DAYS = 3
export const REPEAT_FACTOR = 0.5

export function polarityOf(match: RuleMatch): Polarity {
  return match.rule.tone === 'positive' ? 'positive' : 'negative'
}

/** 1 − Π(1 − cᵢ): independent, concordant evidence reinforces itself. */
export function noisyOr(confidences: number[]): number {
  if (!confidences.length) return 0
  const miss = confidences.reduce((acc, c) => acc * (1 - Math.min(Math.max(c, 0), 1)), 1)
  return Math.min(1 - miss, MAX_CONFIDENCE)
}

/** Share of games behind a match: count conditions give it exactly, trends ≈ 0.8, one game = 0.4. */
export function persistenceOf(match: RuleMatch): number {
  let best: number | null = null
  for (const [i, r] of match.results.entries()) {
    const c = match.rule.when[i]
    if (!c || c.kind === 'role') continue
    let p: number
    if (typeof r.evidence.matched === 'number' && typeof r.evidence.of === 'number' && r.evidence.of > 0) {
      p = r.evidence.matched / r.evidence.of
    } else if (c.kind === 'stat') p = 0.8
    else if (c.kind === 'context') p = 1
    else p = 0.4
    best = best == null ? p : Math.max(best, p)
  }
  return best ?? 0.5
}

export function persistenceFactor(p: number): number {
  return 0.85 + 0.25 * Math.min(Math.max(p, 0), 1)
}

/**
 * Personal impact when the regression has enough games (importance is the
 * metric's share of the model, 1/8 on average), otherwise the role prior.
 */
export function impactOf(problem: Problem, role: RoleBucket, drivers: WinDrivers | null | undefined): number {
  const driver = problem.driverMetric ? drivers?.drivers.find((d) => d.metric === problem.driverMetric) : undefined
  if (driver) return Math.min(Math.max(0.7 + 2.4 * driver.importance, 0.7), 1.6)
  return problem.impactPrior[role]
}

function gamesOf(match: RuleMatch): GameFeatures[] {
  return match.results.flatMap((r) => r.games ?? [])
}

function scoreMatch(match: RuleMatch, votes: Record<string, RuleVotes> | undefined): ScoredMatch {
  const multiplier = match.rule.fixedWeight ? 1 : ruleMultiplier(votes?.[match.rule.id])
  return { match, base: (match.rule.priority / 100) * match.rule.confidence * multiplier }
}

export function diagnose(matches: RuleMatch[], ctx: PlayerContext, opts: DiagnoseOptions): Diagnosis[] {
  const role = roleBucket(ctx.games[0]?.role ?? '')
  const groups = new Map<string, { problem: Problem; polarity: Polarity; items: ScoredMatch[] }>()
  for (const match of matches) {
    const tag = match.results.find((r) => r.tagSlug)?.tagSlug ?? null
    const problem = problemForRule(match.rule.id, tag)
    const polarity = polarityOf(match)
    // Unmapped mistake tags stay separate from each other.
    const key = `${problem.id}${problem.id === 'other-mistakes' && tag ? `:${tag}` : ''}:${polarity}`
    const g = groups.get(key) ?? { problem, polarity, items: [] }
    g.items.push(scoreMatch(match, opts.votesByRule))
    groups.set(key, g)
  }

  const out: Diagnosis[] = []
  for (const { problem, polarity, items } of groups.values()) {
    items.sort((a, b) => b.base - a.base || a.match.rule.id.localeCompare(b.match.rule.id))
    const [lead, ...support] = items
    const byRule = new Map<string, number>()
    for (const it of items) byRule.set(it.match.rule.id, Math.max(byRule.get(it.match.rule.id) ?? 0, it.match.rule.confidence))
    const confidence = noisyOr([...byRule.values()])
    const persistence = Math.max(...items.map((it) => persistenceOf(it.match)))
    const games = items.flatMap((it) => gamesOf(it.match))
    const gameIds = [...new Set(games.map((g) => g.gameId))]
    const impact = problem.unscored ? 1 : impactOf(problem, role, opts.drivers)

    let score: number
    let repeated = false
    const outcome = opts.outcomes?.[problem.id]
    const mastered = !!outcome?.mastered && polarity === 'negative' && !problem.unscored
    const stuck = !!outcome?.stuck && polarity === 'negative'
    if (problem.unscored || lead.match.rule.fixedWeight) {
      score = lead.base
    } else {
      const actionability = polarity === 'negative' && !lead.match.rule.action ? 0.85 : 1
      score = (lead.base / lead.match.rule.confidence) * confidence * impact * persistenceFactor(persistence) * actionability
      const h = opts.history?.[problem.id]
      if (h && opts.moment !== 'post_game' && polarity === 'negative' && h.priorDays >= REPEAT_DAYS) {
        const newest = games.length ? Math.max(...games.map((g) => g.endedAt)) : (ctx.games[0]?.endedAt ?? null)
        if (newest == null || newest <= h.lastShownAt) {
          score *= REPEAT_FACTOR
          repeated = true
        }
      }
      if (mastered) score *= MASTERED_FACTOR
    }
    out.push({ problem, polarity, lead, support, confidence, persistence, impact, repeated, mastered, stuck, score, gameIds })
  }
  // Wellbeing guards (fixed-weight rules, e.g. "take a break") always come first.
  const guard = (d: Diagnosis) => (d.lead.match.rule.fixedWeight ? 1 : 0)
  out.sort((a, b) => guard(b) - guard(a) || b.score - a.score || a.lead.match.rule.id.localeCompare(b.lead.match.rule.id))
  return out
}

/** The focus: best-ranked negative diagnosis that has a fundamental to work on. */
export function pickFocus(diagnoses: Diagnosis[]): Diagnosis | null {
  return diagnoses.find((d) => d.polarity === 'negative' && !d.problem.unscored && d.problem.fundamentalId != null) ?? null
}
