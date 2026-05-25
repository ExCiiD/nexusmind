/**
 * Maps in-game timeline events (Riot Match-Timeline-V5) onto video player time.
 *
 * The mapping requires a "start offset" — the gap between when the in-game
 * clock starts (00:00 on the in-game HUD) and when our recording file
 * actually begins. Users may start recording mid-loading-screen, in pre-game,
 * or even slightly after game start; the offset captures that delta.
 *
 * Source of truth for the offset, in order of priority:
 *   1. `recording.startOffsetSec` from DB (computed at link time from file birthtime)
 *   2. fallback computed from `recordingCreatedAt` (file birthtime) vs `gameStart`
 *   3. zero (best effort — markers may be misaligned but still better than none)
 */

export interface GameTimeToVideoOpts {
  /** Event time in the in-game clock, in milliseconds. */
  eventGameTimeMs: number
  /** Date the match ended (gameEndAt from the DB). */
  gameEndAt: Date
  /** Match duration in seconds. */
  gameDurationSec: number
  /** Date the recording file started being written (file birthtime, approx). */
  recordingCreatedAt: Date
  /** Video file duration in seconds (from <video>.duration). */
  videoDurationSec: number
  /** Pre-computed offset (preferred over deriving from createdAt if available). */
  startOffsetSec?: number | null
}

/**
 * Convert a game-time event timestamp to a position in the recording.
 * Returns null if the event falls outside the recording's time range.
 */
export function gameTimeToVideoTime(opts: GameTimeToVideoOpts): number | null {
  const gameStartMs = opts.gameEndAt.getTime() - opts.gameDurationSec * 1000
  const offsetSec = typeof opts.startOffsetSec === 'number' && Number.isFinite(opts.startOffsetSec)
    ? opts.startOffsetSec
    : (opts.recordingCreatedAt.getTime() - gameStartMs) / 1000

  // videoT = gameT - offset
  //   if offset > 0 → recording started AFTER game start, so we shift left
  //   if offset < 0 → recording started BEFORE game start (loading screen), shift right
  const videoTime = opts.eventGameTimeMs / 1000 - offsetSec
  if (videoTime < 0 || videoTime > opts.videoDurationSec) return null
  return videoTime
}

/**
 * Map a list of game events to video times, dropping ones that fall outside
 * the video's range. Caller still gets the original gameTimeMs for tooltips.
 */
export function mapEventsToVideoTime<E extends { gameTimeMs: number }>(
  events: E[],
  opts: Omit<GameTimeToVideoOpts, 'eventGameTimeMs'>,
): Array<E & { videoTime: number }> {
  const out: Array<E & { videoTime: number }> = []
  for (const ev of events) {
    const t = gameTimeToVideoTime({ ...opts, eventGameTimeMs: ev.gameTimeMs })
    if (t !== null) out.push({ ...ev, videoTime: t })
  }
  return out
}
