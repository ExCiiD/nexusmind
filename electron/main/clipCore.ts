/**
 * Clip mode rules (21/11/2026, DESIGN_STATE § 19 « Mode clip »): a clip is [start, end] of a recording, written in the
 * recordings folder and only ever deleted from there. No length limit (user decision 21/11/2026): a clip may last the
 * whole recording, within its bounds. Pure.
 */
import { resolve, sep } from 'node:path'

export const CLIP_MIN_MS = 1_000
export const CLIP_TITLE_MAX = 100
export const CLIP_NOTE_MAX = 1000

/** A clip may end this much past the recording's known length (rounding of the stored duration, last frame). */
export const CLIP_END_TOLERANCE_MS = 1_000

/**
 * Throws BAD_CLIP_RANGE: start < 0, end ≤ start, shorter than 1 s, or (when the recording's length is known) a start
 * at or past its end, or an end past it.
 */
export function assertClipRange(startMs: number, endMs: number, recordingDurationMs?: number | null): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs - startMs < CLIP_MIN_MS) throw new Error('BAD_CLIP_RANGE')
  if (typeof recordingDurationMs === 'number' && recordingDurationMs > 0) {
    if (startMs >= recordingDurationMs || endMs > recordingDurationMs + CLIP_END_TOLERANCE_MS) throw new Error('BAD_CLIP_RANGE')
  }
}

/** How long ffmpeg may take on a clip: copying stays short, re-encoding scales with the clip (at least the old limits). */
export function clipFfmpegTimeoutMs(clipMs: number, reencode: boolean): number {
  return reencode ? Math.max(300_000, Math.round(clipMs * 1.5)) : Math.max(120_000, Math.round(clipMs / 4))
}

/** Whether `file` lies inside one of `dirs` (resolved; case-insensitive on Windows). */
export function isInsideDirs(file: string, dirs: Array<string | null | undefined>, platform: string = process.platform): boolean {
  const norm = (p: string) => {
    const r = resolve(p)
    return platform === 'win32' ? r.toLowerCase() : r
  }
  const target = norm(file)
  return dirs.some((d) => {
    if (!d) return false
    const root = norm(d)
    return target.startsWith(root.endsWith(sep) ? root : root + sep)
  })
}
