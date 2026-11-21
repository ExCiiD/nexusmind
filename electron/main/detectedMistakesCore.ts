/**
 * Auto-detected mistakes the player deleted from the review's « Erreurs détectées » (21/11/2026): the detection must
 * not create them again. Same game, same tag, within DISMISS_WINDOW_SEC of the deleted one (the detector may date a
 * re-run a few seconds apart, the same window as the deduplication). Pure.
 */
export const DISMISS_WINDOW_SEC = 20

export function isDismissed(dismissed: Array<{ tagSlug: string; gameTimeSec: number }>, tagSlug: string, gameTimeSec: number): boolean {
  return dismissed.some((d) => d.tagSlug === tagSlug && Math.abs(d.gameTimeSec - gameTimeSec) <= DISMISS_WINDOW_SEC)
}
