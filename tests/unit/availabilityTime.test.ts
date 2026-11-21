/** 21/11/2026 Planning bug: "24:00" (end of the day, the bottom of the grid) is a valid END time, never a start. */
import { describe, it, expect } from 'vitest'
import { availabilityExceptionInput, availabilityRuleInput, endTimeOnly, startTimeOnly } from '../../electron/main/availabilityTime'

describe('availability times', () => {
  it('a rule may end at 24:00', () => {
    expect(availabilityRuleInput.parse({ weekday: 1, startTime: '18:00', endTime: '24:00' })).toEqual({ weekday: 1, startTime: '18:00', endTime: '24:00' })
  })
  it('an exception dragged down to the bottom of the grid, too', () => {
    expect(availabilityExceptionInput.safeParse({ date: '2026-11-21', available: true, startTime: '20:30', endTime: '24:00' }).success).toBe(true)
    expect(availabilityExceptionInput.safeParse({ date: '2026-11-21', available: false }).success).toBe(true)
  })
  it('24:00 is never a start; other bad times and an end before the start are refused', () => {
    expect(startTimeOnly.safeParse('24:00').success).toBe(false)
    expect(availabilityRuleInput.safeParse({ weekday: 1, startTime: '24:00', endTime: '24:00' }).success).toBe(false)
    expect(endTimeOnly.safeParse('24:30').success).toBe(false)
    expect(endTimeOnly.safeParse('25:00').success).toBe(false)
    expect(endTimeOnly.safeParse('23:59').success).toBe(true)
    expect(availabilityRuleInput.safeParse({ weekday: 1, startTime: '20:00', endTime: '19:00' }).success).toBe(false)
    expect(availabilityExceptionInput.safeParse({ date: '2026-11-21', available: true, startTime: '22:00', endTime: '22:00' }).success).toBe(false)
  })
})
