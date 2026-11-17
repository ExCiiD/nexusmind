/**
 * Calibration flash (docs/PLAN_MICRO_REVIEW.md §D): replaces the long
 * periodic assessment form. Every 15 games the player answers one perception
 * question — "which fundamental cost you the most lately?" — and sees the gap
 * with what their micro-reviews and tagged mistakes actually say.
 * Fundamentals scores keep being computed continuously from stats.
 */

import { FAMILIES, tagFamily, type MistakeFamily } from '../mistakeInsights'

export const CALIBRATION_EVERY = 15
/** Under this many tagged mistakes the "measured" side is too thin to contradict anyone. */
export const MIN_EVIDENCE = 5
/** Perception within this many points of the top family counts as aligned. */
export const ALIGNED_PTS = 10

export const calibrationDue = (gamesSinceLast: number): boolean => gamesSinceLast >= CALIBRATION_EVERY

export interface FamilyShare { family: MistakeFamily; count: number; share: number }

export function measuredDistribution(tags: Array<{ slug: string; category: string }>): FamilyShare[] {
  const counts: Record<MistakeFamily, number> = { deaths: 0, vision: 0, tempo: 0, mechanics: 0 }
  for (const t of tags) counts[tagFamily(t.slug, t.category)]++
  const total = tags.length
  return FAMILIES
    .map((family) => ({ family, count: counts[family], share: total ? Math.round((counts[family] / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count || FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family))
}

export interface CalibrationGap {
  perceived: MistakeFamily
  measuredTop: MistakeFamily | null
  perceivedShare: number
  topShare: number
  /** Points between the measured top family and the perceived one. */
  gapPts: number
  /** null = not enough evidence to say. */
  aligned: boolean | null
  evidence: number
}

export function calibrationGap(perceived: MistakeFamily, dist: FamilyShare[]): CalibrationGap {
  const evidence = dist.reduce((s, d) => s + d.count, 0)
  const top = dist[0] && dist[0].count > 0 ? dist[0] : null
  const perceivedShare = dist.find((d) => d.family === perceived)?.share ?? 0
  const topShare = top?.share ?? 0
  const gapPts = Math.max(0, topShare - perceivedShare)
  return {
    perceived,
    measuredTop: top?.family ?? null,
    perceivedShare,
    topShare,
    gapPts,
    aligned: evidence < MIN_EVIDENCE ? null : gapPts <= ALIGNED_PTS,
    evidence,
  }
}
