/**
 * VOD timing of a micro-review moment. Kept apart from MicroReviewPanel so
 * the coach views (CoachMicroReviews, also on the web app) can read it
 * without pulling the panel and the Codex into their bundle.
 *
 * 20/11/2026 (docs/engine-reports/2026-11-20-lieux-et-extraits-video-des-cartes.md § 3, DECISIONS 20/11): the clip
 * window. Beta.20 (ANALYSIS_VERSION 14): no automatic Erreur · Conséquence · Conclusion markers any more; the player
 * sets precise timestamps on the answer if they want.
 * - A card tied to an objective: from objective − 60 s to objective + 45 s, the header at the objective's time. An
 *   error dated earlier than T − 60 s starts the clip 10 s before it, never before T − 90 s.
 * - A death or late card with no objective: from 45 s before to 30 s after.
 * The Lab bookmarks of an objective error use the same start (bookmarkLeadSec).
 */

/** Before / after an objective. */
export const OBJECTIVE_PRE_SEC = 60
export const OBJECTIVE_POST_SEC = 45
/** An earlier error is shown from 10 s before it, at most 90 s before the objective. */
export const ERROR_LEAD_SEC = 10
export const OBJECTIVE_MAX_PRE_SEC = 90
/** Before / after a death or a late move with no objective. */
export const PLAIN_PRE_SEC = 45
export const PLAIN_POST_SEC = 30
/**
 * Where the engine anchors an absent-objective moment before the objective falls (20 to 25 s), used only while a
 * moment carries no objective time of its own.
 */
export const OBJECTIVE_ANCHOR_LEAD_SEC = 20

/** What the clip needs from a moment (CriticalMoment, or a saved answer). */
export interface ClipMoment {
  trigger: string
  gameTimeSec: number
  facts?: {
    objectiveLost?: string | null
    objectiveLostAfterSec?: number | null
    /** The objective's time, when the engine gives it (absent-objective and objective-linked patterns). */
    objectiveAtSec?: number | null
    /** When the error itself happened (the tower taken, the recall…), when the engine gives it. */
    errorAtSec?: number | null
    /** ANALYSIS_VERSION 12: the objective's fall. */
    killSec?: number | null
  } | null
  /** ANALYSIS_VERSION 12 (Back-end, 20/11): the header time, when the engine gives it. */
  headerSec?: number | null
}

export interface ClipWindow {
  /** Game time the clip starts and ends at (never before 0). */
  startSec: number
  endSec: number
  /** The time the card's header shows: the objective's, or the moment's. */
  headerSec: number
  /** The objective's time, null for a card with no objective. */
  objectiveSec: number | null
}

/** The objective's time of a moment, or null when it is not tied to an objective. */
export function objectiveTimeOf(m: ClipMoment): number | null {
  const f = m.facts ?? {}
  if (typeof f.objectiveAtSec === 'number') return f.objectiveAtSec
  if (typeof f.killSec === 'number') return f.killSec
  if (f.objectiveLost && typeof f.objectiveLostAfterSec === 'number') return m.gameTimeSec + f.objectiveLostAfterSec
  if (m.trigger === 'absent-objective') return m.gameTimeSec + OBJECTIVE_ANCHOR_LEAD_SEC
  return null
}

export function clipWindow(m: ClipMoment): ClipWindow {
  const w = computedWindow(m)
  return typeof m.headerSec === 'number' ? { ...w, headerSec: m.headerSec } : w
}

function computedWindow(m: ClipMoment): ClipWindow {
  const t = objectiveTimeOf(m)
  const errorAt = typeof m.facts?.errorAtSec === 'number' ? m.facts.errorAtSec : null
  if (t != null) {
    let start = t - OBJECTIVE_PRE_SEC
    if (errorAt != null && errorAt < start) start = Math.max(errorAt - ERROR_LEAD_SEC, t - OBJECTIVE_MAX_PRE_SEC)
    start = Math.max(0, start)
    return { startSec: start, endSec: t + OBJECTIVE_POST_SEC, headerSec: t, objectiveSec: t }
  }
  return { startSec: Math.max(0, m.gameTimeSec - PLAIN_PRE_SEC), endSec: m.gameTimeSec + PLAIN_POST_SEC, headerSec: m.gameTimeSec, objectiveSec: null }
}

/** Seconds before a moment a Lab bookmark starts: the clip's start. */
export function bookmarkLeadSec(m: ClipMoment): number {
  return Math.max(0, m.gameTimeSec - clipWindow(m).startSec)
}
