/**
 * Clip mode of the single player (DECISIONS 21/11 « Mode clip, nouvelle interface »): the selection, in video
 * milliseconds, between two handles « Début » / « Fin » above the timeline. Default: current time − 10 s → + 20 s;
 * dragging a handle keeps the clip between 1 s and 2 min; I / O set a bound at the current time. Pure, tested.
 */

export interface ClipRange { startMs: number; endMs: number }

export const MIN_CLIP_MS = 1_000
/** Back-end refuses longer clips (CLIP_TOO_LONG). */
export const MAX_CLIP_MS = 120_000
const DEFAULT_BEFORE_MS = 10_000
const DEFAULT_AFTER_MS = 20_000

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

/**
 * A handle dragged to `ms`: « Début » stays at least 1 s before the end and at most 2 min before it; « Fin » the same
 * after the start; both inside the video. The other handle never moves.
 */
export function dragClipHandle(r: ClipRange, which: 'start' | 'end', ms: number, durationMs: number): ClipRange {
  const max = durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY
  if (which === 'start') {
    const lo = Math.max(0, r.endMs - MAX_CLIP_MS), hi = Math.max(0, r.endMs - MIN_CLIP_MS)
    return { startMs: Math.round(Math.max(lo, Math.min(hi, ms))), endMs: r.endMs }
  }
  const lo = Math.min(max, r.startMs + MIN_CLIP_MS), hi = Math.min(max, r.startMs + MAX_CLIP_MS)
  return { startMs: r.startMs, endMs: Math.round(Math.max(lo, Math.min(hi, ms))) }
}

/** The bracket's label: « 0:30 », « 1:05 ». */
export function clipLengthLabel(r: ClipRange): string {
  const s = Math.round((r.endMs - r.startMs) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** I: the start at the current time (the end moves if it would come first). */
export function setClipIn(r: ClipRange, currentMs: number, durationMs: number): ClipRange {
  return clamp({ startMs: currentMs, endMs: Math.max(r.endMs, currentMs + MIN_CLIP_MS) }, durationMs)
}

/** O: the end at the current time (the start moves if it would come after). */
export function setClipOut(r: ClipRange, currentMs: number, durationMs: number): ClipRange {
  return clamp({ startMs: Math.min(r.startMs, currentMs - MIN_CLIP_MS), endMs: currentMs }, durationMs)
}

/** A micro-review moment's window (game seconds) as a clip (video ms), with the recording's offset. */
export function clipFromGameWindow(win: { startSec: number; endSec: number }, offsetSec: number, durationMs: number): ClipRange {
  return clamp({ startMs: (win.startSec - offsetSec) * 1000, endMs: (win.endSec - offsetSec) * 1000 }, durationMs)
}

/** Preview loop: back to the start once the end is reached. */
export function loopTarget(nowMs: number, r: ClipRange): number | null {
  return nowMs >= r.endMs || nowMs < r.startMs - 500 ? r.startMs : null
}
