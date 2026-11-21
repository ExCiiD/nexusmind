/**
 * A game's stored analysis from an older ANALYSIS_VERSION, used when the recompute is impossible (21/11/2026, audit P3:
 * timeline purged, Riot offline): the game keeps its cards instead of losing them. Fields added by later versions are
 * optional (extraMoments, places, markers…) and read as absent; a payload that does not look like an analysis is refused.
 * The recompute is tried again later (RETRY_AFTER_MS), not on every read.
 */
import type { GameAnalysis } from '../../src/lib/microReview/anomalyDetector'

/** After a failed recompute, the stored analysis is served without trying again for this long. */
export const RETRY_AFTER_MS = 10 * 60 * 1000

/**
 * Failures where the old analysis must NOT stand in: another map or mode, an older season (current season only), a game
 * that no longer exists. Every other failure (match or timeline fetch failed, empty or purged timeline, not cached,
 * player not resolved, no active user) falls back to the stored analysis.
 */
export const NO_FALLBACK_REASONS = new Set(['unsupported-mode', 'previous-season', 'no-game'])

export function mayFallBack(reason: string | undefined): boolean {
  return !NO_FALLBACK_REASONS.has(reason ?? '')
}

/** The stored payload as an analysis readable by the current screens, or null. */
export function readStoredAnalysis(payload: string | null | undefined): GameAnalysis | null {
  if (!payload) return null
  let v: unknown
  try { v = JSON.parse(payload) } catch { return null }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.moments) || typeof o.participantId !== 'number') return null
  return {
    ...(o as unknown as GameAnalysis),
    winProb: Array.isArray(o.winProb) ? (o.winProb as number[]) : [],
    contested: Array.isArray(o.contested) ? (o.contested as GameAnalysis['contested']) : [],
    garbageDiscarded: typeof o.garbageDiscarded === 'number' ? o.garbageDiscarded : 0,
    laneAt10: o.laneAt10 && typeof o.laneAt10 === 'object' ? (o.laneAt10 as GameAnalysis['laneAt10']) : null,
    position: typeof o.position === 'string' ? o.position : '',
  }
}

/** Whether a recompute should be tried now (none failed for this game in the last RETRY_AFTER_MS). */
export function shouldRetry(lastFailureAt: number | undefined, now: number): boolean {
  return lastFailureAt === undefined || now - lastFailureAt >= RETRY_AFTER_MS
}
