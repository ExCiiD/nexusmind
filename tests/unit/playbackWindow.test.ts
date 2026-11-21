import { describe, it, expect } from 'vitest'
import { mistakePlayFromSec, playbackLeadSec, playbackWindowOf } from '../../src/lib/microReview/playbackWindow'

// 20/11: an error dated from a death plays from death − 45 s to death + 30 s; the stored time does not change.
describe('playback window of an error', () => {
  it('dated from a death: −45 s / +30 s, with the death as second marker', () => {
    expect(playbackWindowOf({ atSec: 600, datedFromDeath: true })).toEqual({ startSec: 555, endSec: 630, deathSec: 600 })
    expect(playbackWindowOf({ atSec: 20, datedFromDeath: true })?.startSec).toBe(0)
  })
  it('a stored mistake replays from 45 s before when the engine dated it from a death', () => {
    expect(mistakePlayFromSec({ gameTimeSec: 600, tagSlug: 'bad-trade', autoDetected: true })).toBe(555)
    expect(mistakePlayFromSec({ gameTimeSec: 600, tagSlug: 'bad-trade', autoDetected: false })).toBe(600) // tagged by hand
    expect(mistakePlayFromSec({ gameTimeSec: 600, tagSlug: 'cs-deficit', autoDetected: true })).toBe(600)
    expect(mistakePlayFromSec({ gameTimeSec: 600, tagSlug: 'cs-deficit', answerTrigger: 'critical-death' })).toBe(555)
  })

  it('other errors and manual tags keep their own behaviour', () => {
    expect(playbackWindowOf({ atSec: 600 })).toBeNull()
    expect(playbackWindowOf({ atSec: 600, datedFromDeath: false })).toBeNull()
    expect(playbackLeadSec({ atSec: 600, datedFromDeath: false }, 15)).toBe(15)
    expect(playbackLeadSec({ atSec: 600, datedFromDeath: true }, 15)).toBe(45)
    expect(playbackLeadSec({ atSec: 10 }, 15)).toBe(10)
  })
})
