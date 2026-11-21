/**
 * « Review courte » (user decision, 20/11/2026): a game counts as reviewed, with no notes and no fundamentals score,
 * once the player answered one micro-review moment or watched 60 s of its recording in the player. It leaves « À
 * reviewer » (badge, session), shows a « Review courte » label, and brings no score to the charts. A full review is
 * never downgraded. Pure, tested.
 */

/** Seconds of the game's recording to watch in the player. */
export const SHORT_REVIEW_WATCH_SEC = 60
/** A jump bigger than this between two time updates is a seek, not playback. */
const MAX_PLAYBACK_STEP_SEC = 2

/** Watched seconds after a time update: only forward playback counts (seeks and rewinds don't). */
export function addWatched(total: number, prevTime: number | null, nowTime: number): number {
  if (prevTime == null) return total
  const step = nowTime - prevTime
  return step > 0 && step <= MAX_PLAYBACK_STEP_SEC ? total + step : total
}

/** A game reviewed without a review record: the short review. */
export function isShortReview(g: { reviewStatus?: string | null; hasFullReview: boolean }): boolean {
  return !g.hasFullReview && g.reviewStatus === 'reviewed'
}
