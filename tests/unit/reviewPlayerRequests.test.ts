import { describe, it, expect } from 'vitest'
import { useReviewPlayerStore } from '../../src/store/useReviewPlayerStore'

// Beta.20: no resume at an older position — the one-shot requests are cleared when the Review player closes.
describe('review player requests', () => {
  it('clears the last seek, note jump and clip request', () => {
    const s = useReviewPlayerStore.getState()
    s.requestSeek(347)
    s.requestVideoSeek(12_000)
    s.requestClip({ startSec: 300, endSec: 360 })
    useReviewPlayerStore.getState().clearRequests()
    const after = useReviewPlayerStore.getState()
    expect([after.seek, after.videoSeek, after.clipRequest]).toEqual([null, null, null])
  })
})
