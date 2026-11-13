/**
 * R4 — which unreviewed game to review first (docs/AUDIT_REGLES_METIER.md §3.3).
 *
 * Priority order: close loss (final gold diff < 3k) > ≥ 2 severity-3
 * mistakes > largest deviation from the player's own average > most recent.
 * Only uses data already cached locally (no Riot calls here).
 */

import { mean, stdDev, type GameFeatures } from './features'

export type PriorityReason = 'close_loss' | 'severe_mistakes' | 'deviation' | 'recency'

export interface PriorityGame {
  gameId: string
  reason: PriorityReason
}

export const CLOSE_LOSS_GOLD = 3000
export const SEVERE_MISTAKE_COUNT = 2

function severeMistakeCount(g: GameFeatures): number {
  return g.mistakes.filter((m) => (m.severity ?? 2) >= 3).length
}

/** |perfIndex z-score| vs the player's own games with data; null when not computable. */
function deviationZ(target: GameFeatures, all: GameFeatures[]): number | null {
  const values = all.map((g) => g.values.perfIndex).filter((v): v is number => v != null)
  const v = target.values.perfIndex
  if (v == null || values.length < 3) return null
  const m = mean(values)
  const sd = stdDev(values)
  if (m == null || sd == null || sd < 1e-6) return null
  return Math.abs((v - m) / sd)
}

/**
 * `unreviewed`: candidate games, any order. `all`: the player's games (any
 * review status) used to compute the personal baseline for "deviation".
 */
export function pickPriorityGame(unreviewed: GameFeatures[], all: GameFeatures[] = unreviewed): PriorityGame | null {
  if (unreviewed.length === 0) return null

  const closeLoss = unreviewed.find((g) => g.values.win === 0 && g.finalGoldDiff != null && Math.abs(g.finalGoldDiff) < CLOSE_LOSS_GOLD)
  if (closeLoss) return { gameId: closeLoss.gameId, reason: 'close_loss' }

  const severe = unreviewed.find((g) => severeMistakeCount(g) >= SEVERE_MISTAKE_COUNT)
  if (severe) return { gameId: severe.gameId, reason: 'severe_mistakes' }

  let best: { gameId: string; z: number } | null = null
  for (const g of unreviewed) {
    const z = deviationZ(g, all)
    if (z != null && (!best || z > best.z)) best = { gameId: g.gameId, z }
  }
  if (best) return { gameId: best.gameId, reason: 'deviation' }

  const newest = [...unreviewed].sort((a, b) => b.endedAt - a.endedAt)[0]
  return { gameId: newest.gameId, reason: 'recency' }
}
