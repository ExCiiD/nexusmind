import { describe, it, expect } from 'vitest'
import { SHORT_REVIEW_WATCH_SEC, addWatched, isShortReview } from '../../src/lib/shortReview'

// « Review courte » (20/11): 1 micro-review answer or 60 s of the recording watched.
describe('short review', () => {
  it('counts forward playback only', () => {
    let total = 0
    let prev: number | null = null
    for (let t = 100; t <= 100 + SHORT_REVIEW_WATCH_SEC; t += 0.25) { total = addWatched(total, prev, t); prev = t }
    expect(total).toBeCloseTo(SHORT_REVIEW_WATCH_SEC)
    expect(addWatched(10, 100, 400)).toBe(10) // a seek forward
    expect(addWatched(10, 100, 50)).toBe(10) // a rewind
    expect(addWatched(10, null, 50)).toBe(10) // first update, or paused
  })

  it('a reviewed game with no review record is a short review; a full review never is', () => {
    expect(isShortReview({ reviewStatus: 'reviewed', hasFullReview: false })).toBe(true)
    expect(isShortReview({ reviewStatus: 'reviewed', hasFullReview: true })).toBe(false)
    expect(isShortReview({ reviewStatus: 'pending', hasFullReview: false })).toBe(false)
    expect(isShortReview({ reviewStatus: 'to_be_reviewed', hasFullReview: false })).toBe(false)
  })
})
