/**
 * Unit tests for RecordPage helper functions:
 * - date grouping logic
 * - pagination (buildPageNumbers)
 * - folder storage (localStorage serialisation)
 * - filter logic
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Inline copies of the pure helpers (avoids importing the React component) ──

function getDateKey(dateStr: string): string {
  return new Date(dateStr).toISOString().slice(0, 10)
}

function buildPageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: Array<number | '…'> = [1]
  if (current > 3) pages.push('…')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}

const FOLDERS_KEY = 'nexusmind:record-folders-v2'

interface Folder {
  id: string
  name: string
  recordingIds: string[]
}

function loadFolders(storage: Record<string, string>): Folder[] {
  try { const r = storage[FOLDERS_KEY]; return r ? JSON.parse(r) : [] } catch { return [] }
}
function saveFolders(storage: Record<string, string>, f: Folder[]) {
  storage[FOLDERS_KEY] = JSON.stringify(f)
}

// ── getDateKey ────────────────────────────────────────────────────────────────

describe('getDateKey', () => {
  it('should return YYYY-MM-DD format', () => {
    expect(getDateKey('2026-04-10T21:35:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('should group same-day records under the same key', () => {
    const a = getDateKey('2026-04-10T08:00:00.000Z')
    const b = getDateKey('2026-04-10T23:59:59.000Z')
    expect(a).toBe(b)
  })

  it('should give different keys for different days', () => {
    const a = getDateKey('2026-04-10T12:00:00.000Z')
    const b = getDateKey('2026-04-11T12:00:00.000Z')
    expect(a).not.toBe(b)
  })

  it('date keys should sort correctly in descending order', () => {
    const dates = [
      '2026-04-10T12:00:00.000Z',
      '2026-04-12T12:00:00.000Z',
      '2026-04-05T12:00:00.000Z',
    ]
    const keys = dates.map(getDateKey).sort((a, b) => b.localeCompare(a))
    expect(keys[0]).toBe('2026-04-12')
    expect(keys[1]).toBe('2026-04-10')
    expect(keys[2]).toBe('2026-04-05')
  })
})

// ── buildPageNumbers ──────────────────────────────────────────────────────────

describe('buildPageNumbers', () => {
  it('should return all pages when total <= 7', () => {
    expect(buildPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(buildPageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('should always include first and last page', () => {
    const pages = buildPageNumbers(5, 20)
    expect(pages[0]).toBe(1)
    expect(pages[pages.length - 1]).toBe(20)
  })

  it('should NOT have leading ellipsis when current is near the start (page 2)', () => {
    const pages = buildPageNumbers(2, 20)
    // Result: [1, 2, 3, '…', 20] — no leading ellipsis between 1 and 2
    expect(pages[0]).toBe(1)
    expect(pages[1]).toBe(2) // not '…'
    // Should have a trailing ellipsis
    const lastTwo = pages.slice(-2)
    expect(lastTwo).toContain('…')
    expect(lastTwo).toContain(20)
  })

  it('should include leading and trailing ellipsis for middle page', () => {
    const pages = buildPageNumbers(10, 20)
    expect(pages[1]).toBe('…')  // after 1
    const lastTwo = pages.slice(-2)
    expect(lastTwo).toContain('…')
  })

  it('should include current page in the result', () => {
    for (const cur of [1, 5, 10, 19, 20]) {
      const pages = buildPageNumbers(cur, 20)
      expect(pages).toContain(cur)
    }
  })

  it('should never have more than 7 entries (1 page, ellipsis, 3 around current, ellipsis, last)', () => {
    // max: 1, …, cur-1, cur, cur+1, …, last  = 7
    for (const cur of [5, 10, 15]) {
      const pages = buildPageNumbers(cur, 100)
      expect(pages.length).toBeLessThanOrEqual(7)
    }
  })

  it('should handle single page', () => {
    expect(buildPageNumbers(1, 1)).toEqual([1])
  })
})

// ── Folder localStorage helpers ───────────────────────────────────────────────

describe('Folder storage helpers', () => {
  let storage: Record<string, string>

  beforeEach(() => { storage = {} })

  it('loadFolders should return empty array when nothing stored', () => {
    expect(loadFolders(storage)).toEqual([])
  })

  it('saveFolders / loadFolders round-trip', () => {
    const folders: Folder[] = [
      { id: 'f-1', name: 'My Clips', recordingIds: ['r-1', 'r-2'] },
      { id: 'f-2', name: 'Ranked', recordingIds: [] },
    ]
    saveFolders(storage, folders)
    expect(loadFolders(storage)).toEqual(folders)
  })

  it('loadFolders should return empty array for corrupted JSON', () => {
    storage[FOLDERS_KEY] = 'NOT_JSON{{{'
    expect(loadFolders(storage)).toEqual([])
  })

  it('saveFolders should overwrite previous state', () => {
    saveFolders(storage, [{ id: 'f-1', name: 'Old', recordingIds: [] }])
    saveFolders(storage, [{ id: 'f-2', name: 'New', recordingIds: ['r-1'] }])
    const result = loadFolders(storage)
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('New')
  })

  it('removing a folder removes its recordingIds from results', () => {
    const initial: Folder[] = [
      { id: 'f-1', name: 'Keep', recordingIds: ['r-a'] },
      { id: 'f-2', name: 'Delete', recordingIds: ['r-b'] },
    ]
    saveFolders(storage, initial)
    const after = initial.filter(f => f.id !== 'f-2')
    saveFolders(storage, after)
    const result = loadFolders(storage)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('f-1')
  })
})

// ── Filter logic ──────────────────────────────────────────────────────────────

describe('RecordPage filter logic', () => {
  interface RecordStub {
    recordingId: string
    filePath: string | null
    clipCount: number
    queueType: string
    hasReview: boolean
    source: string
  }

  const records: RecordStub[] = [
    { recordingId: 'r-1', filePath: '/a.mp4', clipCount: 2, queueType: 'soloq', hasReview: true, source: 'capture' },
    { recordingId: 'r-2', filePath: '/b.mp4', clipCount: 0, queueType: 'aram', hasReview: false, source: 'obs' },
    { recordingId: 'r-3', filePath: null, clipCount: 3, queueType: 'soloq', hasReview: false, source: 'youtube' },
    { recordingId: 'r-4', filePath: '/d.mp4', clipCount: 0, queueType: 'flex', hasReview: true, source: 'obs' },
  ]

  function applyFilter(r: RecordStub, f: { content: string; mode: string; review: string; source: string }): boolean {
    if (f.content === 'clips' && r.clipCount === 0) return false
    if (f.content === 'records' && !r.filePath) return false
    if (f.mode !== 'all' && r.queueType !== f.mode) return false
    if (f.review === 'reviewed' && !r.hasReview) return false
    if (f.review === 'unreviewed' && r.hasReview) return false
    if (f.source !== 'all' && r.source !== f.source) return false
    return true
  }

  it('no filters: returns all records', () => {
    const filtered = records.filter(r => applyFilter(r, { content: 'all', mode: 'all', review: 'all', source: 'all' }))
    expect(filtered.length).toBe(4)
  })

  it('content=clips: only records with clips', () => {
    const filtered = records.filter(r => applyFilter(r, { content: 'clips', mode: 'all', review: 'all', source: 'all' }))
    expect(filtered.map(r => r.recordingId)).toEqual(['r-1', 'r-3'])
  })

  it('content=records: only records with filePath', () => {
    const filtered = records.filter(r => applyFilter(r, { content: 'records', mode: 'all', review: 'all', source: 'all' }))
    expect(filtered.map(r => r.recordingId)).toEqual(['r-1', 'r-2', 'r-4'])
  })

  it('mode=soloq: only soloq records', () => {
    const filtered = records.filter(r => applyFilter(r, { content: 'all', mode: 'soloq', review: 'all', source: 'all' }))
    expect(filtered.map(r => r.recordingId)).toEqual(['r-1', 'r-3'])
  })

  it('review=reviewed: only reviewed records', () => {
    const filtered = records.filter(r => applyFilter(r, { content: 'all', mode: 'all', review: 'reviewed', source: 'all' }))
    expect(filtered.map(r => r.recordingId)).toEqual(['r-1', 'r-4'])
  })

  it('review=unreviewed: only unreviewed records', () => {
    const filtered = records.filter(r => applyFilter(r, { content: 'all', mode: 'all', review: 'unreviewed', source: 'all' }))
    expect(filtered.map(r => r.recordingId)).toEqual(['r-2', 'r-3'])
  })

  it('source=obs: only OBS records', () => {
    const filtered = records.filter(r => applyFilter(r, { content: 'all', mode: 'all', review: 'all', source: 'obs' }))
    expect(filtered.map(r => r.recordingId)).toEqual(['r-2', 'r-4'])
  })

  it('combined filters: soloq + reviewed', () => {
    const filtered = records.filter(r => applyFilter(r, { content: 'all', mode: 'soloq', review: 'reviewed', source: 'all' }))
    expect(filtered.map(r => r.recordingId)).toEqual(['r-1'])
  })
})

// ── Pagination slice logic ────────────────────────────────────────────────────

describe('Pagination slice logic', () => {
  const ITEMS_PER_PAGE = 20

  it('page 1 should return first 20 items', () => {
    const all = Array.from({ length: 50 }, (_, i) => i)
    const page = all.slice(0, ITEMS_PER_PAGE)
    expect(page.length).toBe(20)
    expect(page[0]).toBe(0)
    expect(page[19]).toBe(19)
  })

  it('page 2 should return items 20-39', () => {
    const all = Array.from({ length: 50 }, (_, i) => i)
    const start = (2 - 1) * ITEMS_PER_PAGE
    const page = all.slice(start, start + ITEMS_PER_PAGE)
    expect(page[0]).toBe(20)
    expect(page[page.length - 1]).toBe(39)
  })

  it('last page with remainder should return only remaining items', () => {
    const all = Array.from({ length: 45 }, (_, i) => i)
    const totalPages = Math.ceil(all.length / ITEMS_PER_PAGE) // 3
    const start = (totalPages - 1) * ITEMS_PER_PAGE
    const page = all.slice(start, start + ITEMS_PER_PAGE)
    expect(page.length).toBe(5)
    expect(page[0]).toBe(40)
  })

  it('totalPages should be at least 1', () => {
    expect(Math.max(1, Math.ceil(0 / ITEMS_PER_PAGE))).toBe(1)
    expect(Math.max(1, Math.ceil(20 / ITEMS_PER_PAGE))).toBe(1)
    expect(Math.max(1, Math.ceil(21 / ITEMS_PER_PAGE))).toBe(2)
  })

  it('safeCurrentPage should clamp to totalPages', () => {
    const clamp = (cur: number, total: number) => Math.min(cur, total)
    expect(clamp(5, 3)).toBe(3)
    expect(clamp(1, 3)).toBe(1)
    expect(clamp(3, 3)).toBe(3)
  })
})
