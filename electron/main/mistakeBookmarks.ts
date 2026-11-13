/**
 * MX5 — auto-bookmark severity-3 mistakes with a linked recording, at
 * `t − 15s` so the clip includes the lead-up, not just the moment itself.
 *
 * Pure planning logic only (no IO): `autoDetectMistakesSilently` in
 * stats.ipc.ts calls `planAutoBookmarks` with the newly-created mistakes and
 * turns the plan into `Bookmark` rows.
 *
 * Trust gate: we only know a mistake's position in the VIDEO when
 * `Recording.startOffsetSec` is set and plausible (same ±600s window used
 * everywhere else offsets are derived, see src/lib/eventSync.ts) — a wrong
 * offset would silently bookmark the wrong moment.
 */

export const LEAD_SEC = 15
/** Same plausibility window as src/lib/eventSync.ts (PLAUSIBILITY_LIMIT_SEC). */
export const PLAUSIBILITY_LIMIT_SEC = 600
/** Never create two auto-bookmarks within this many ms of each other. */
export const DEDUP_WINDOW_MS = 10_000

export function isPlausibleOffset(offsetSec: number | null | undefined): offsetSec is number {
  return typeof offsetSec === 'number' && Number.isFinite(offsetSec) && Math.abs(offsetSec) <= PLAUSIBILITY_LIMIT_SEC
}

/** videoT = gameT − offset (same convention as src/lib/eventSync.ts), clamped to ≥ 0. */
export function mistakeVideoTimeMs(gameTimeSec: number, startOffsetSec: number): number {
  return Math.max(0, Math.round((gameTimeSec - startOffsetSec) * 1000))
}

export interface AutoBookmarkCandidate {
  tagSlug: string
  tagLabel: string
  gameTimeSec: number
  severity: number
}

export interface AutoBookmarkPlan {
  videoTimeMs: number
  label: string
}

export interface PlanAutoBookmarksOptions {
  startOffsetSec: number | null | undefined
  /** Match duration, used as a sanity bound against a corrupted offset. */
  gameDurationSec: number
  /** Existing bookmarks on this recording (videoTimeMs), for de-duplication. */
  existingVideoTimesMs: number[]
}

/** Only severity-3 mistakes, only with a trustworthy offset, never near an existing bookmark. */
export function planAutoBookmarks(candidates: AutoBookmarkCandidate[], opts: PlanAutoBookmarksOptions): AutoBookmarkPlan[] {
  if (!isPlausibleOffset(opts.startOffsetSec)) return []
  const offset = opts.startOffsetSec
  const taken = [...opts.existingVideoTimesMs]
  const out: AutoBookmarkPlan[] = []
  for (const c of candidates) {
    if (c.severity < 3) continue
    const momentMs = mistakeVideoTimeMs(c.gameTimeSec, offset)
    // A moment far beyond the game's own duration means the offset is bad for this clip.
    if (momentMs > (opts.gameDurationSec + LEAD_SEC) * 1000) continue
    const at = Math.max(0, momentMs - LEAD_SEC * 1000)
    if (taken.some((t) => Math.abs(t - at) <= DEDUP_WINDOW_MS)) continue
    out.push({ videoTimeMs: at, label: c.tagLabel })
    taken.push(at)
  }
  return out
}
