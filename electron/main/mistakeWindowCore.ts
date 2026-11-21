/**
 * « Repères de la micro-review » (21/11/2026, DECISIONS): the player may set precise timestamps on a moment, the error
 * (start) and its consequence (end), one or both. The mistake then covers [error − 5 s, consequence + 5 s]; a single
 * one given: ± 5 s around it. Used by the Mistake Lab, the bookmarks and the playback window. Pure.
 */

/** Seconds added before the error and after the consequence. */
export const TIMESTAMP_MARGIN_SEC = 5

export interface MistakeWindow {
  /** The mistake's own time: the error's, else the consequence's. */
  gameTimeSec: number
  startSec: number
  endSec: number
}

/**
 * The window from the player's timestamps, or null when none was given. Throws BAD_TIMESTAMPS when a time is outside
 * the game (0 .. durationSec, when the duration is known) or the consequence comes before the error.
 */
export function mistakeWindow(errorAtSec: number | null | undefined, consequenceAtSec: number | null | undefined, durationSec: number | null | undefined): MistakeWindow | null {
  const e = typeof errorAtSec === 'number' ? errorAtSec : null
  const c = typeof consequenceAtSec === 'number' ? consequenceAtSec : null
  if (e === null && c === null) return null
  const max = typeof durationSec === 'number' && durationSec > 0 ? durationSec : Infinity
  for (const t of [e, c]) {
    if (t !== null && (!Number.isInteger(t) || t < 0 || t > max)) throw new Error('BAD_TIMESTAMPS')
  }
  if (e !== null && c !== null && c < e) throw new Error('BAD_TIMESTAMPS')
  const from = (e ?? c) as number
  const to = (c ?? e) as number
  return {
    gameTimeSec: from,
    startSec: Math.max(0, from - TIMESTAMP_MARGIN_SEC),
    endSec: Math.min(max, to + TIMESTAMP_MARGIN_SEC),
  }
}

/** How far past the game's end a mistake time is still accepted (then set to the last second). */
export const END_SCREEN_TOLERANCE_SEC = 60

/**
 * A mistake's game time as sent by a screen (mistake:create): an integer within the game. When it is missing, the
 * video time and a plausible recording offset give it. Throws BAD_GAME_TIME otherwise (never a silent 0:00).
 */
export function resolveMistakeGameTime(
  gameTimeSec: unknown,
  videoTimeMs: unknown,
  startOffsetSec: number | null,
  durationSec: number | null | undefined,
): number {
  let t: number | null = typeof gameTimeSec === 'number' && Number.isFinite(gameTimeSec) ? Math.round(gameTimeSec) : null
  if (t === null && typeof videoTimeMs === 'number' && Number.isFinite(videoTimeMs) && startOffsetSec !== null) {
    t = Math.round(videoTimeMs / 1000 + startOffsetSec)
  }
  const max = typeof durationSec === 'number' && durationSec > 0 ? durationSec : 36_000
  // A note taken on the end screen (nexus explosion, victory banner) lands a little past the game's duration: it is
  // set to the last second instead of refused, which half-saved the note (bookmark created, mistake failed).
  if (t !== null && t > max && t <= max + END_SCREEN_TOLERANCE_SEC) t = max
  if (t === null || t < 0 || t > max) throw new Error('BAD_GAME_TIME')
  return t
}
