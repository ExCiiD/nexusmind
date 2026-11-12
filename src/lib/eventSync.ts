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
 *   2. `recordingCreatedAt` vs `gameStart`, ONLY if the resulting offset is
 *       plausible (|offset| < 10 min) — this is unreliable for old recordings
 *       where `recording.createdAt` is the DB insertion time rather than the
 *       file birthtime.
 *   3. duration-based estimate: assumes the recording ended near game end,
 *       so `offset ≈ gameDurationSec - videoDurationSec`. Works for any
 *       recording stopped right after the game ended (the common case).
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
  const offsetSec = deriveOffsetSec(opts)

  // videoT = gameT - offset
  //   if offset > 0 → recording started AFTER game start, so we shift left
  //   if offset < 0 → recording started BEFORE game start (loading screen), shift right
  const videoTime = opts.eventGameTimeMs / 1000 - offsetSec
  if (videoTime < 0 || videoTime > opts.videoDurationSec) return null
  return videoTime
}

/**
 * Picks the best offset estimate, in priority order. Exposed for tests and
 * for callers who want to inspect / display the derived value.
 */
export function deriveOffsetSec(opts: Omit<GameTimeToVideoOpts, 'eventGameTimeMs'>): number {
  // Plausibility window applied to ALL sources — see below. Real video
  // recordings overlap the game by a few minutes at most, so an offset
  // with magnitude > 10 min always indicates a bad measurement (most
  // common cause: the WGC backend remuxes .webm → .mp4 at game end, and
  // the .mp4's birthtime is the remux completion time ≈ gameEnd, which
  // pushes the persisted `startOffsetSec` to ~+gameDurationSec).
  const PLAUSIBILITY_LIMIT_SEC = 600

  // Priority 1: pre-computed offset from DB, but only if plausible.
  // Without this gate, a single corrupted row would permanently push
  // every event off-screen until manually refreshed.
  if (typeof opts.startOffsetSec === 'number' && Number.isFinite(opts.startOffsetSec)
      && Math.abs(opts.startOffsetSec) <= PLAUSIBILITY_LIMIT_SEC) {
    return opts.startOffsetSec
  }
  // Priority 2: birthtime-derived offset, same plausibility window.
  const gameStartMs = opts.gameEndAt.getTime() - opts.gameDurationSec * 1000
  const fromBirth = (opts.recordingCreatedAt.getTime() - gameStartMs) / 1000
  if (Number.isFinite(fromBirth) && Math.abs(fromBirth) <= PLAUSIBILITY_LIMIT_SEC) {
    return fromBirth
  }
  // Final fallback. Most users stop recording right at end-of-game so the
  // recording ends ~at gameEnd; rearranging recordingEnd = recordingStart +
  // videoDur gives offset ≈ gameDur - videoDur (negative when the recording
  // is longer than the game, meaning it started before game start).
  return opts.gameDurationSec - opts.videoDurationSec
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
