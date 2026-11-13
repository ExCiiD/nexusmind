import { describe, it, expect } from 'vitest'
import {
  isPlausibleOffset,
  mistakeVideoTimeMs,
  planAutoBookmarks,
  DEDUP_WINDOW_MS,
  LEAD_SEC,
  PLAUSIBILITY_LIMIT_SEC,
  type AutoBookmarkCandidate,
} from '../../electron/main/mistakeBookmarks'

const candidate = (over: Partial<AutoBookmarkCandidate> = {}): AutoBookmarkCandidate => ({
  tagSlug: 'solo-baron-died',
  tagLabel: 'Solo baron death',
  gameTimeSec: 1500, // 25:00
  severity: 3,
  ...over,
})

describe('isPlausibleOffset', () => {
  it('accepts a finite offset within the plausibility window', () => {
    expect(isPlausibleOffset(0)).toBe(true)
    expect(isPlausibleOffset(120)).toBe(true)
    expect(isPlausibleOffset(-PLAUSIBILITY_LIMIT_SEC)).toBe(true)
    expect(isPlausibleOffset(PLAUSIBILITY_LIMIT_SEC)).toBe(true)
  })
  it('rejects anything outside the window, missing, or non-finite', () => {
    expect(isPlausibleOffset(PLAUSIBILITY_LIMIT_SEC + 1)).toBe(false)
    expect(isPlausibleOffset(-PLAUSIBILITY_LIMIT_SEC - 1)).toBe(false)
    expect(isPlausibleOffset(null)).toBe(false)
    expect(isPlausibleOffset(undefined)).toBe(false)
    expect(isPlausibleOffset(NaN)).toBe(false)
    expect(isPlausibleOffset(Infinity)).toBe(false)
  })
})

describe('mistakeVideoTimeMs', () => {
  it('videoT = gameT - offset, clamped to ≥ 0', () => {
    expect(mistakeVideoTimeMs(100, 10)).toBe(90_000)
    expect(mistakeVideoTimeMs(100, -10)).toBe(110_000)
    expect(mistakeVideoTimeMs(5, 100)).toBe(0) // would be negative
  })
})

describe('planAutoBookmarks', () => {
  const base = { startOffsetSec: 10, gameDurationSec: 1800, existingVideoTimesMs: [] as number[] }

  it('bookmarks only severity-3 mistakes, at t - 15s', () => {
    const plan = planAutoBookmarks([candidate({ severity: 3 }), candidate({ severity: 2, gameTimeSec: 300 })], base)
    expect(plan).toHaveLength(1)
    const moment = mistakeVideoTimeMs(1500, 10)
    expect(plan[0]).toEqual({ videoTimeMs: moment - LEAD_SEC * 1000, label: 'Solo baron death' })
  })

  it('creates nothing without a plausible offset', () => {
    expect(planAutoBookmarks([candidate()], { ...base, startOffsetSec: null })).toEqual([])
    expect(planAutoBookmarks([candidate()], { ...base, startOffsetSec: PLAUSIBILITY_LIMIT_SEC + 1 })).toEqual([])
  })

  it('skips a moment far beyond the match duration (bad offset for this clip)', () => {
    const plan = planAutoBookmarks([candidate({ gameTimeSec: 5000 })], { ...base, gameDurationSec: 1800 })
    expect(plan).toEqual([])
  })

  it('never creates two bookmarks within the dedup window, against existing or new ones', () => {
    const near = mistakeVideoTimeMs(1500, 10) - LEAD_SEC * 1000
    const against = planAutoBookmarks([candidate()], { ...base, existingVideoTimesMs: [near + DEDUP_WINDOW_MS / 2] })
    expect(against).toEqual([])

    const twoClose = planAutoBookmarks([candidate({ gameTimeSec: 1500 }), candidate({ gameTimeSec: 1501, tagLabel: 'Other' })], base)
    expect(twoClose).toHaveLength(1)
  })

  it('bookmarks further apart than the window both land', () => {
    const plan = planAutoBookmarks([candidate({ gameTimeSec: 300, tagLabel: 'First' }), candidate({ gameTimeSec: 1500, tagLabel: 'Second' })], base)
    expect(plan.map((p) => p.label)).toEqual(['First', 'Second'])
  })
})
