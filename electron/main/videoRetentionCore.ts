/**
 * Video retention (health check of 28/11/2026): which recordings to delete to keep the recordings folder in check.
 * A game weighs ~0.9 GB at 1080p (24.7 GB for 27 games), and nothing ever deleted one.
 *
 * The player sets a maximum age, a maximum total size, or both (Settings › Recording). The setting is local to this
 * PC (its disk), off by default, and the first purge waits for the player's confirmation of what it will delete.
 *
 * Never deleted, whatever the setting:
 * - a recording with a **clip**, a **bookmark**, or a **mistake the player tagged** (on the video or its game);
 * - a recording whose game has a **review** (written review or micro-review answers);
 * - a recording younger than MIN_KEEP_DAYS (the game may not be reviewed yet), or the one being recorded.
 * Kept recordings still count in the total: when they alone pass the cap, the plan says so (`capUnreachable`).
 * Deleted first: the oldest.
 */

export const MIN_KEEP_DAYS = 2
const DAY_MS = 86_400_000
const GB = 1024 ** 3

export interface VideoRetentionSettings {
  enabled: boolean
  /** Delete recordings older than this many days. null: no age limit. */
  maxAgeDays: number | null
  /** Keep the recordings under this total, in GB. null: no size limit. */
  maxTotalGb: number | null
  /** When the player confirmed the first purge (ISO date); null: nothing is deleted until they do. */
  confirmedAt: string | null
}

export const DEFAULT_VIDEO_RETENTION: VideoRetentionSettings = { enabled: false, maxAgeDays: null, maxTotalGb: null, confirmedAt: null }

/** The limits offered (the UI's choices); the setter clamps anything else into these bounds. */
export const AGE_BOUNDS = { min: 7, max: 365 }
export const SIZE_BOUNDS_GB = { min: 10, max: 2000 }

export type KeepReason = 'clip' | 'bookmark' | 'mistake' | 'review' | 'recent' | 'recording'

export interface RecordingFacts {
  id: string
  filePath: string
  sizeBytes: number
  createdAtMs: number
  clips: number
  bookmarks: number
  /** Mistakes the player tagged (not auto-detected), on this video or its game. */
  manualMistakes: number
  /** Written review or micro-review answers on its game. */
  reviewed: boolean
  /** The file the recorder is writing right now. */
  capturing: boolean
}

export interface PurgePlan {
  remove: Array<{ id: string; filePath: string; sizeBytes: number; why: 'age' | 'size' }>
  removeBytes: number
  totalBytes: number
  /** Every recording with a video file on this PC (kept or not). */
  totalCount: number
  /** Recordings that are kept by a rule, with the first reason that keeps them and their size (the protected part of
   *  the disk bar; kept by the limits = totalBytes - removeBytes - sum of these). */
  kept: Array<{ id: string; reason: KeepReason; sizeBytes: number }>
  /** The size cap cannot be met with what may be deleted. */
  capUnreachable: boolean
}

export function keepReason(r: RecordingFacts, now: number): KeepReason | null {
  if (r.capturing) return 'recording'
  if (r.clips > 0) return 'clip'
  if (r.bookmarks > 0) return 'bookmark'
  if (r.manualMistakes > 0) return 'mistake'
  if (r.reviewed) return 'review'
  if (now - r.createdAtMs < MIN_KEEP_DAYS * DAY_MS) return 'recent'
  return null
}

/** Clamps what the renderer sends into a valid setting (unknown fields dropped). */
export function sanitizeSettings(input: Partial<VideoRetentionSettings>, previous: VideoRetentionSettings): VideoRetentionSettings {
  const clamp = (v: unknown, b: { min: number; max: number }): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(b.max, Math.max(b.min, Math.round(v))) : null
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : previous.enabled,
    maxAgeDays: 'maxAgeDays' in input ? clamp(input.maxAgeDays, AGE_BOUNDS) : previous.maxAgeDays,
    maxTotalGb: 'maxTotalGb' in input ? clamp(input.maxTotalGb, SIZE_BOUNDS_GB) : previous.maxTotalGb,
    confirmedAt: previous.confirmedAt,
  }
}

/** What a purge with these settings would delete now (the oldest first). Nothing when the setting is off. */
export function planVideoPurge(recordings: RecordingFacts[], s: VideoRetentionSettings, now: number): PurgePlan {
  const totalBytes = recordings.reduce((n, r) => n + r.sizeBytes, 0)
  const kept: PurgePlan['kept'] = []
  const deletable: RecordingFacts[] = []
  for (const r of recordings) {
    const reason = keepReason(r, now)
    if (reason) kept.push({ id: r.id, reason, sizeBytes: r.sizeBytes })
    else deletable.push(r)
  }
  const plan: PurgePlan = { remove: [], removeBytes: 0, totalBytes, totalCount: recordings.length, kept, capUnreachable: false }
  if (!s.enabled || (s.maxAgeDays === null && s.maxTotalGb === null)) return plan

  deletable.sort((a, b) => a.createdAtMs - b.createdAtMs)
  const chosen = new Set<string>()
  const take = (r: RecordingFacts, why: 'age' | 'size') => {
    chosen.add(r.id)
    plan.remove.push({ id: r.id, filePath: r.filePath, sizeBytes: r.sizeBytes, why })
    plan.removeBytes += r.sizeBytes
  }
  if (s.maxAgeDays !== null) {
    for (const r of deletable) if (now - r.createdAtMs > s.maxAgeDays * DAY_MS) take(r, 'age')
  }
  if (s.maxTotalGb !== null) {
    const cap = s.maxTotalGb * GB
    for (const r of deletable) {
      if (totalBytes - plan.removeBytes <= cap) break
      if (!chosen.has(r.id)) take(r, 'size')
    }
    plan.capUnreachable = totalBytes - plan.removeBytes > cap
  }
  return plan
}
