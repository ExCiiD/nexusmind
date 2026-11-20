/**
 * Pure part of the MatchCache storage (AUDIT_PERF_2 gain 6, 20/11/2026): timelines are stored gzip-compressed.
 *
 * A timeline weighs 400-700 KB of JSON. Reading those columns from disk after a restart (Windows has not cached the
 * database pages yet) was what made the stats slow when cold: 4.3 s for 40 rows. Gzip divides it by about 11.
 *
 * - Stored form: `gz1:` + base64 of the gzip bytes. The column stays TEXT, so no migration is needed and an older
 *   app version simply sees an unreadable timeline (it fetches it again).
 * - Read form: always the decompressed JSON string, whatever is stored. A plain JSON value (written before this
 *   version) is returned as is, and the caller rewrites it compressed (lazy migration, matchStore.ts).
 */
import { gunzipSync, gzipSync } from 'node:zlib'

export const GZ_PREFIX = 'gz1:'

export function isCompressedTimeline(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(GZ_PREFIX)
}

/** The value to store for a timeline (object or JSON string). */
export function encodeTimeline(timeline: unknown): string {
  const json = typeof timeline === 'string' ? (isCompressedTimeline(timeline) ? null : timeline) : JSON.stringify(timeline)
  if (json === null) return timeline as string // already encoded
  return GZ_PREFIX + gzipSync(Buffer.from(json, 'utf-8'), { level: 6 }).toString('base64')
}

/** The timeline's JSON string, from what is stored. null for null, '' or an unreadable value. */
export function decodeTimeline(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (!isCompressedTimeline(stored)) return stored
  try {
    return gunzipSync(Buffer.from(stored.slice(GZ_PREFIX.length), 'base64')).toString('utf-8')
  } catch {
    return null
  }
}

/** The parsed timeline, or null. */
export function parseStoredTimeline(stored: string | null | undefined): any | null {
  const json = decodeTimeline(stored)
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}
