/**
 * AS1 / B4 — "you at your best vs you at your worst": the top 20% and
 * bottom 20% of games by perfIndex, and which indicators differ the most
 * between the two groups (what tends to go right, what tends to go wrong).
 *
 * Pure; mirrors regression.ts's rankWinDrivers in shape so the weekly report
 * can render both the same way.
 */

import { mean, type GameFeatures, type Metric } from './features'

export interface ProfileIndicator {
  metric: Metric
  bestMean: number
  worstMean: number
  /** bestMean - worstMean, sign-adjusted so a positive gap always favours "best". */
  gap: number
}

export interface BestWorstProfile {
  games: number
  bestGames: number
  worstGames: number
  indicators: ProfileIndicator[]
}

export const MIN_GAMES = 10
const GROUP_SHARE = 0.2
const CANDIDATE_METRICS: Metric[] = ['csPerMin', 'visionPerMin', 'kda', 'deaths', 'kp', 'laneScore', 'goldDiff14']
const LOWER_IS_BETTER = new Set<Metric>(['deaths'])
const MAX_INDICATORS = 4

/** Null when there isn't enough perfIndex data to split meaningfully. */
export function computeBestWorstProfile(games: GameFeatures[]): BestWorstProfile | null {
  const withPerf = games.filter((g) => g.values.perfIndex != null)
  if (withPerf.length < MIN_GAMES) return null

  const sorted = [...withPerf].sort((a, b) => (b.values.perfIndex as number) - (a.values.perfIndex as number))
  const groupSize = Math.max(2, Math.round(sorted.length * GROUP_SHARE))
  const best = sorted.slice(0, groupSize)
  const worst = sorted.slice(-groupSize)

  const indicators: ProfileIndicator[] = []
  for (const metric of CANDIDATE_METRICS) {
    const bestValues = best.map((g) => g.values[metric]).filter((v): v is number => v != null)
    const worstValues = worst.map((g) => g.values[metric]).filter((v): v is number => v != null)
    if (bestValues.length < 2 || worstValues.length < 2) continue
    const bestMean = mean(bestValues)!
    const worstMean = mean(worstValues)!
    const raw = bestMean - worstMean
    indicators.push({ metric, bestMean, worstMean, gap: LOWER_IS_BETTER.has(metric) ? -raw : raw })
  }
  indicators.sort((a, b) => b.gap - a.gap)

  return { games: withPerf.length, bestGames: best.length, worstGames: worst.length, indicators: indicators.slice(0, MAX_INDICATORS) }
}
