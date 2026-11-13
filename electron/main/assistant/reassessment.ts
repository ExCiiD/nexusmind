/**
 * P1 — reminder to redo the self-assessment. The date-based trigger already
 * existed (`user.nextAssessmentAt`); this adds the stats-based one: a
 * fundamental the player last self-rated, whose measured metric has since
 * shifted clearly from the player's own baseline (|z| ≥ 1.5 — the same
 * z-score convention used everywhere else in the assistant), means the
 * rating is probably stale even before the scheduled date.
 *
 * Reuses `regression.ts`'s metric↔fundamental map so "what we can measure"
 * never drifts from "what the win-driver analysis already uses".
 */

import { DRIVER_FEATURES } from './regression'
import { LOWER_IS_BETTER, type Metric, type MetricStats } from './features'

export const Z_THRESHOLD = 1.5
export const MIN_FUNDAMENTALS = 3

export interface FundamentalGap {
  fundamentalId: string
  metric: Metric
  selfScore: number
  /** Sign-adjusted so positive always means "measurably better than baseline". */
  z: number
}

/** `latestScores`: fundamentalId → the player's own 1-5 self-rating (top-level scores only). */
export function statBilanGaps(stats: Partial<Record<Metric, MetricStats>>, latestScores: Record<string, number>): FundamentalGap[] {
  const gaps: FundamentalGap[] = []
  for (const { metric, objectiveId } of DRIVER_FEATURES) {
    const selfScore = latestScores[objectiveId]
    if (selfScore == null) continue
    const s = stats[metric]
    if (s?.z == null) continue
    const z = LOWER_IS_BETTER.has(metric) ? -s.z : s.z
    if (Math.abs(z) >= Z_THRESHOLD) gaps.push({ fundamentalId: objectiveId, metric, selfScore, z: Number(z.toFixed(2)) })
  }
  return gaps
}

export function needsStatDeviationReassessment(gaps: FundamentalGap[]): boolean {
  return gaps.length >= MIN_FUNDAMENTALS
}

export interface SuggestedScore {
  fundamentalId: string
  metric: Metric
  score: number
  previousScore: number
  z: number
}

/** Caps how far one suggestion moves a fundamental from its last rating. */
export const MAX_NUDGE = 2

/**
 * A starting point for the next self-assessment: the player's own previous
 * rating, nudged by how their measured performance has moved since (the
 * same z-score the gap check uses). Never suggests anything for a
 * fundamental with no previous rating — onboarding's first assessment is
 * untouched by this.
 */
export function suggestedScores(stats: Partial<Record<Metric, MetricStats>>, previousScores: Record<string, number>): SuggestedScore[] {
  const out: SuggestedScore[] = []
  for (const { metric, objectiveId } of DRIVER_FEATURES) {
    const previousScore = previousScores[objectiveId]
    if (previousScore == null) continue
    const s = stats[metric]
    if (s?.z == null) continue
    const z = LOWER_IS_BETTER.has(metric) ? -s.z : s.z
    const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, Math.round(z)))
    const score = Math.min(5, Math.max(1, previousScore + nudge))
    if (score !== previousScore) out.push({ fundamentalId: objectiveId, metric, score, previousScore, z: Number(z.toFixed(2)) })
  }
  return out
}
