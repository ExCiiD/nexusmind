/**
 * Clip mode rules (21/11/2026, DESIGN_STATE § 19 « Mode clip »): a clip is [start, end] of a recording, 2 minutes at
 * most, written in the recordings folder and only ever deleted from there. Pure.
 */
import { resolve, sep } from 'node:path'

export const CLIP_MAX_MS = 120_000
export const CLIP_MIN_MS = 1_000
export const CLIP_TITLE_MAX = 100
export const CLIP_NOTE_MAX = 1000

/** Throws BAD_CLIP_RANGE (start < 0, end ≤ start, shorter than 1 s) or CLIP_TOO_LONG (over 2 min). */
export function assertClipRange(startMs: number, endMs: number): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs - startMs < CLIP_MIN_MS) throw new Error('BAD_CLIP_RANGE')
  if (endMs - startMs > CLIP_MAX_MS) throw new Error('CLIP_TOO_LONG')
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
