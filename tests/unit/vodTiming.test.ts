import { describe, it, expect } from 'vitest'
import { bookmarkLeadSec, clipWindow, objectiveTimeOf } from '../../src/lib/microReview/vodTiming'

// 20/11: error > consequence > conclusion (docs/engine-reports/2026-11-20-lieux-et-extraits-video-des-cartes.md § 3).
describe('micro-review clip window', () => {
  it('objective card: T − 60 s to T + 45 s, header at the objective', () => {
    const w = clipWindow({ trigger: 'absent-objective', gameTimeSec: 960, facts: { objectiveAtSec: 985 } })
    expect(w).toMatchObject({ startSec: 925, endSec: 1030, headerSec: 985, objectiveSec: 985 })
    expect(w.markers).toEqual({ error: 960, consequence: 985, conclusion: 1000 })
  })

  it('an earlier error starts the clip 10 s before it, never before T − 90 s', () => {
    expect(clipWindow({ trigger: 'absent-objective', gameTimeSec: 960, facts: { objectiveAtSec: 985, errorAtSec: 914 } }).startSec).toBe(904)
    expect(clipWindow({ trigger: 'absent-objective', gameTimeSec: 960, facts: { objectiveAtSec: 985, errorAtSec: 850 } }).startSec).toBe(895)
  })

  it('a death before a lost objective is an objective card', () => {
    const m = { trigger: 'critical-death', gameTimeSec: 1528, facts: { objectiveLost: 'baron', objectiveLostAfterSec: 30 } }
    expect(objectiveTimeOf(m)).toBe(1558)
    expect(clipWindow(m)).toMatchObject({ startSec: 1498, endSec: 1603, headerSec: 1558 })
  })

  it('death or late card with no objective: 45 s before to 30 s after', () => {
    const w = clipWindow({ trigger: 'critical-death', gameTimeSec: 600, facts: { objectiveLost: null } })
    expect(w).toMatchObject({ startSec: 555, endSec: 630, headerSec: 600, objectiveSec: null })
    expect(w.markers).toEqual({ error: 555, consequence: 600, conclusion: 615 })
  })

  it('uses the engine markers and header when the moment has them (ANALYSIS_VERSION 12)', () => {
    const w = clipWindow({ trigger: 'absent-objective', gameTimeSec: 960, facts: { killSec: 985 }, headerSec: 985,
      markers: { errorSec: 914, consequenceSec: 985, conclusionSec: 1030 } })
    expect(w).toMatchObject({ startSec: 904, endSec: 1030, headerSec: 985 })
    expect(w.markers).toEqual({ error: 914, consequence: 985, conclusion: 1030 })
    const d = clipWindow({ trigger: 'critical-death', gameTimeSec: 600, headerSec: 600, markers: { errorSec: 600, consequenceSec: null, conclusionSec: 630 } })
    expect(d.markers).toEqual({ error: 600, consequence: null, conclusion: 630 })
  })

  it('never starts before the game, and the Lab bookmark uses the clip start', () => {
    expect(clipWindow({ trigger: 'early-deficit', gameTimeSec: 20 }).startSec).toBe(0)
    expect(bookmarkLeadSec({ trigger: 'critical-death', gameTimeSec: 600 })).toBe(45)
    expect(bookmarkLeadSec({ trigger: 'absent-objective', gameTimeSec: 960, facts: { objectiveAtSec: 985 } })).toBe(35)
  })
})
