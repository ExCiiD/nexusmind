/**
 * Q (TE-4 / T1): the Record page's pure helpers, moved out of src/pages/Record/RecordPage.tsx so the tests check the
 * code the page runs (tests/unit/recordPage.test.ts used to test its own copies, with a UTC getDateKey while the
 * page groups by local day).
 */

/** Local calendar day (not UTC) as YYYY-MM-DD: a game at 00:30 belongs to that night's day group. */
export function getDateKey(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Page numbers with '…' markers: first, last, and the pages around the current one (at most 7 entries). */
export function buildPageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: Array<number | '…'> = [1]
  if (current > 3) pages.push('…')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}

export interface RecordFilters {
  content: string
  mode: string
  review: string
  source: string
}

/** Whether a recording passes the page's filters (content, queue, review state, source). */
export function matchesRecordFilters(
  r: { clipCount: number; filePath: string | null; queueType: string; hasReview: boolean; source: string },
  f: RecordFilters,
): boolean {
  if (f.content === 'clips' && r.clipCount === 0) return false
  if (f.content === 'records' && !r.filePath) return false
  if (f.mode !== 'all' && r.queueType !== f.mode) return false
  if (f.review === 'reviewed' && !r.hasReview) return false
  if (f.review === 'unreviewed' && r.hasReview) return false
  if (f.source !== 'all' && r.source !== f.source) return false
  return true
}

/** The saved folders (localStorage text), [] when missing or corrupted. */
export function parseStoredFolders<T>(raw: string | null): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}
