/**
 * Auto-detected mistakes the player deleted from the review's « Erreurs détectées » (21/11/2026): the detection must
 * not create them again. Same game, same tag, within DISMISS_WINDOW_SEC of the deleted one (the detector may date a
 * re-run a few seconds apart, the same window as the deduplication). Pure.
 */
export const DISMISS_WINDOW_SEC = 20

/**
 * Re-check of stored AUTO-detected mistakes (28/11/2026, "Dove tower" on a turret already destroyed): the rows of one tag
 * that the current detector no longer finds, i.e. with no candidate of that tag within `windowSec` (the dedupe window).
 * Pure; the caller passes only rows still marked autoDetected, never the ones the player tagged or confirmed.
 */
export function staleAutoRows<T extends { gameTimeSec: number }>(rows: T[], candidateTimes: number[], windowSec = 3): T[] {
  return rows.filter((r) => !candidateTimes.some((t) => Math.abs(t - r.gameTimeSec) <= windowSec))
}

export function isDismissed(dismissed: Array<{ tagSlug: string; gameTimeSec: number }>, tagSlug: string, gameTimeSec: number): boolean {
  return dismissed.some((d) => d.tagSlug === tagSlug && Math.abs(d.gameTimeSec - gameTimeSec) <= DISMISS_WINDOW_SEC)
}
