import { describe, it, expect } from 'vitest'
import { sortAnnouncements } from '../../src/lib/mySpaceView'

// docs/DESIGN_STATE.md § 16.3: the announcement shown first.
describe('announcements', () => {
  it('pinned first, then the newest', () => {
    const list = [
      { id: 'old', pinned: false, createdAt: '2026-11-10T10:00:00Z' },
      { id: 'pin', pinned: true, createdAt: '2026-11-01T10:00:00Z' },
      { id: 'new', pinned: false, createdAt: '2026-11-19T10:00:00Z' },
    ]
    expect(sortAnnouncements(list).map((a) => a.id)).toEqual(['pin', 'new', 'old'])
  })
})
