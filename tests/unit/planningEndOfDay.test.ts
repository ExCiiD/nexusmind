import { describe, it, expect } from 'vitest'
import { findCommonAvailability, listAvailabilityRules } from '../../src/lib/calendarCore'
import { dayAvailability, windowLabel } from '../../src/lib/planningView'
import { hmToMin, minToHm } from '../../src/components/Planning/TimeSelect'
import type { AvailabilityRule } from '../../src/lib/calendar'

// Beta.23 Planning bug: « 24:00 » is the end of the day. Postgres stores and reads back "24:00:00"; the screens read it
// as the bottom of the day (1440 min, shown « 24:00 »), never as 0:00.
const MON = '2026-11-16'
const rule = (userId: string, startTime: string, endTime: string): AvailabilityRule => ({ id: userId, groupId: 'g', userId, weekday: 1, startTime, endTime })

describe('planning: 24:00 is the end of the day', () => {
  it('reads "24:00:00" from the database as « 24:00 »', async () => {
    const rows = [{ id: 'r', group_id: 'g', user_id: 'u', weekday: 1, start_time: '20:00:00', end_time: '24:00:00' }]
    const q = { select: () => q, eq: () => q, order: () => Promise.resolve({ data: rows, error: null }) }
    const sb = { from: () => q } as never
    expect((await listAvailabilityRules(sb, 'g'))[0]).toMatchObject({ startTime: '20:00', endTime: '24:00' })
  })

  it('keeps the window to the bottom of the day in the grid, the players table and the common slots', () => {
    expect(dayAvailability([rule('u', '20:00', '24:00')], [], 'u', MON)).toEqual({ state: 'free', windows: [{ start: 1200, end: 1440 }] })
    expect(windowLabel({ start: 1200, end: 1440 })).toBe('20:00–24:00')
    const common = findCommonAvailability([rule('a', '20:00', '24:00'), rule('b', '21:00', '24:00')], [], ['a', 'b'], MON)
    expect(common).toContainEqual({ date: MON, startTime: '21:00', endTime: '24:00' })
  })

  it('the time pickers (MySpaceTab, My availability) show and read « 24:00 » as 1440', () => {
    expect(hmToMin('24:00')).toBe(1440)
    expect(minToHm(1440)).toBe('24:00')
  })
})
