/**
 * Matches a video file birth time to a game's end time for scan / retro-linking.
 * Pure — unit-tested without DB.
 */

/**
 * A recording that starts near game load has createdAt ≈ gameEndAt - gameDuration.
 */
export function matchRecordingToGame(
  recordingCreatedAt: Date,
  gameEndAt: Date,
  gameDurationSec: number,
  bufferMs = 5 * 60 * 1000,
): boolean {
  const diff = recordingCreatedAt.getTime() - gameEndAt.getTime()
  const durMs = Math.max(gameDurationSec, 1) * 1000
  const minDiff = -durMs - bufferMs
  const maxDiff = bufferMs
  return diff >= minDiff && diff <= maxDiff
}
