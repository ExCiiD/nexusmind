/**
 * VOD timing of a micro-review moment. Kept apart from MicroReviewPanel so
 * the coach views (CoachMicroReviews, also on the web app) can read it
 * without pulling the panel and the Codex into their bundle.
 */

/** Seconds of video played before a moment, so the lead-up is visible. */
export const PRE_ROLL_SEC = 12
/** Length of the excerpt shown inline for a moment. */
export const EXCERPT_SEC = 15
