import { describe, it, expect } from 'vitest'
import { nextTuning, applySeverityDelta, DELETIONS_TO_LEARN, LEARNED_SEVERITY_DELTA } from '../../electron/main/mistakeTuning'

describe('nextTuning', () => {
  it('keeps severityDelta at 0 until the threshold is reached', () => {
    expect(nextTuning(0)).toEqual({ deletedCount: 1, severityDelta: 0 })
    expect(nextTuning(1)).toEqual({ deletedCount: 2, severityDelta: 0 })
  })

  it(`applies the learned delta from the ${DELETIONS_TO_LEARN}rd deletion on`, () => {
    expect(nextTuning(DELETIONS_TO_LEARN - 1)).toEqual({ deletedCount: DELETIONS_TO_LEARN, severityDelta: LEARNED_SEVERITY_DELTA })
    expect(nextTuning(DELETIONS_TO_LEARN)).toEqual({ deletedCount: DELETIONS_TO_LEARN + 1, severityDelta: LEARNED_SEVERITY_DELTA })
  })
})

describe('applySeverityDelta', () => {
  it('lowers severity by the delta, clamped to 1-3', () => {
    expect(applySeverityDelta(3, -1)).toBe(2)
    expect(applySeverityDelta(1, -1)).toBe(1) // floor
    expect(applySeverityDelta(2, 0)).toBe(2)
    expect(applySeverityDelta(2, -5)).toBe(1)
  })
})
