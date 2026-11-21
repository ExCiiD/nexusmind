/**
 * Clip mode of the Review player (DECISIONS 21/11 « interface clip user friendly », spec DESIGN_STATE § 19): the
 * selection, in video milliseconds. Default: current time − 10 s → + 20 s; the DURÉE presets (10 s, 30 s, 1 min,
 * 2 min) centred on the current time; I / O set a bound at the current time; the timeline zooms to about ± 2 min
 * around the clip. Pure, tested.
 */

export interface ClipRange { startMs: number; endMs: number }

export const CLIP_PRESETS_SEC = [10, 30, 60, 120] as const
export const MIN_CLIP_MS = 1_000
/** Back-end refuses longer clips (CLIP_TOO_LONG). */
export const MAX_CLIP_MS = 120_000
const DEFAULT_BEFORE_MS = 10_000
const DEFAULT_AFTER_MS = 20_000
const ZOOM_MARGIN_MS = 120_000

function clamp(r: ClipRange, durationMs: number): ClipRange {
  const max = durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY
  let startMs = Math.max(0, Math.min(r.startMs, max))
  let endMs = Math.max(0, Math.min(r.endMs, max))
  if (endMs - startMs > MAX_CLIP_MS) endMs = startMs + MAX_CLIP_MS
  if (endMs - startMs < MIN_CLIP_MS) {
    endMs = Math.min(max, startMs + MIN_CLIP_MS)
    startMs = Math.max(0, endMs - MIN_CLIP_MS)
  }
  return { startMs: Math.round(startMs), endMs: Math.round(endMs) }
}

/** The selection a new clip starts with: current − 10 s → + 20 s. */
export function defaultClipRange(currentMs: number, durationMs: number): ClipRange {
  return clamp({ startMs: currentMs - DEFAULT_BEFORE_MS, endMs: currentMs + DEFAULT_AFTER_MS }, durationMs)
}

/** A DURÉE preset, centred on the current time (shifted to stay inside the video). */
export function presetClipRange(currentMs: number, presetSec: number, durationMs: number): ClipRange {
  const len = presetSec * 1000
  let startMs = currentMs - len / 2
  if (durationMs > 0 && startMs + len > durationMs) startMs = durationMs - len
  startMs = Math.max(0, startMs)
  return clamp({ startMs, endMs: startMs + len }, durationMs)
}

/** I: the start at the current time (the end moves if it would come first). */
export function setClipIn(r: ClipRange, currentMs: number, durationMs: number): ClipRange {
  return clamp({ startMs: currentMs, endMs: Math.max(r.endMs, currentMs + MIN_CLIP_MS) }, durationMs)
}

/** O: the end at the current time (the start moves if it would come after). */
export function setClipOut(r: ClipRange, currentMs: number, durationMs: number): ClipRange {
  return clamp({ startMs: Math.min(r.startMs, currentMs - MIN_CLIP_MS), endMs: currentMs }, durationMs)
}

/** The zoomed timeline in clip mode: about ± 2 min around the clip, inside the video. */
export function clipZoomWindow(r: ClipRange, durationMs: number): { fromMs: number; toMs: number } {
  const fromMs = Math.max(0, r.startMs - ZOOM_MARGIN_MS)
  const toMs = durationMs > 0 ? Math.min(durationMs, r.endMs + ZOOM_MARGIN_MS) : r.endMs + ZOOM_MARGIN_MS
  return { fromMs, toMs }
}

/** A micro-review moment's window (game seconds) as a clip (video ms), with the recording's offset. */
export function clipFromGameWindow(win: { startSec: number; endSec: number }, offsetSec: number, durationMs: number): ClipRange {
  return clamp({ startMs: (win.startSec - offsetSec) * 1000, endMs: (win.endSec - offsetSec) * 1000 }, durationMs)
}

/** Preview loop: back to the start once the end is reached. */
export function loopTarget(nowMs: number, r: ClipRange): number | null {
  return nowMs >= r.endMs || nowMs < r.startMs - 500 ? r.startMs : null
}
