import { describe, it, expect, vi } from 'vitest'
import {
  listEvents, createEvent, deleteEvent, listAvailabilityRules, setAvailabilityRule,
  listAvailabilityExceptions, setAvailabilityException, findCommonAvailability, isUserAvailable,
  getCalendarSubscription, createCalendarSubscription, revokeCalendarSubscription,
} from '../../src/lib/calendarCore'
import type { AvailabilityException, AvailabilityRule } from '../../src/lib/calendar'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'lt', 'lte', 'order', 'maybeSingle']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('listEvents', () => {
  it('maps rows to CalendarEvent', async () => {
    const sb = { from: vi.fn(() => chain({
      data: [{ id: 'e1', group_id: 'g1', kind: 'rest', title: 'Day off', starts_at: '2026-11-16T00:00:00Z', ends_at: '2026-11-17T00:00:00Z', notes: null, created_by: 'u1', created_at: 't', updated_at: 't' }],
      error: null,
    })) } as never
    const out = await listEvents(sb, 'g1', '2026-11-16T00:00:00Z', '2026-11-23T00:00:00Z')
    expect(out).toEqual([{ id: 'e1', groupId: 'g1', kind: 'rest', title: 'Day off', startsAt: '2026-11-16T00:00:00Z', endsAt: '2026-11-17T00:00:00Z', notes: null, createdBy: 'u1', createdAt: 't', updatedAt: 't' }])
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(listEvents(sb, 'g1', 'a', 'b')).rejects.toThrow('boom')
  })
})

describe('createEvent / deleteEvent', () => {
  it('createEvent inserts and returns the new id', async () => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'e1' }, error: null }) }) }))
    const sb = { from: vi.fn(() => ({ insert })) } as never
    const id = await createEvent(sb, 'g1', { kind: 'tournament', title: 'LAN', startsAt: 'a', endsAt: 'b' })
    expect(id).toBe('e1')
    expect(insert).toHaveBeenCalledWith({ group_id: 'g1', kind: 'tournament', title: 'LAN', starts_at: 'a', ends_at: 'b', notes: null })
  })

  it('deleteEvent deletes by id', async () => {
    const del = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ delete: del })) } as never
    await deleteEvent(sb, 'e1')
    expect(del).toHaveBeenCalled()
  })
})

describe('availability rules / exceptions', () => {
  it('listAvailabilityRules maps rows and trims seconds from time', async () => {
    const sb = { from: vi.fn(() => chain({ data: [{ id: 'r1', group_id: 'g1', user_id: 'u1', weekday: 1, start_time: '18:00:00', end_time: '22:00:00' }], error: null })) } as never
    const out = await listAvailabilityRules(sb, 'g1')
    expect(out).toEqual([{ id: 'r1', groupId: 'g1', userId: 'u1', weekday: 1, startTime: '18:00', endTime: '22:00' }])
  })

  it('setAvailabilityRule inserts with the given fields', async () => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'r1' }, error: null }) }) }))
    const sb = { from: vi.fn(() => ({ insert })) } as never
    const id = await setAvailabilityRule(sb, 'g1', { weekday: 2, startTime: '19:00', endTime: '21:00' })
    expect(id).toBe('r1')
    expect(insert).toHaveBeenCalledWith({ group_id: 'g1', weekday: 2, start_time: '19:00', end_time: '21:00' })
  })

  it('listAvailabilityExceptions maps rows', async () => {
    const sb = { from: vi.fn(() => chain({ data: [{ id: 'x1', group_id: 'g1', user_id: 'u1', date: '2026-11-18', available: false, start_time: null, end_time: null, note: 'exam' }], error: null })) } as never
    const out = await listAvailabilityExceptions(sb, 'g1', '2026-11-16', '2026-11-23')
    expect(out).toEqual([{ id: 'x1', groupId: 'g1', userId: 'u1', date: '2026-11-18', available: false, startTime: null, endTime: null, note: 'exam' }])
  })

  it('setAvailabilityException upserts on the (group, user, date) key', async () => {
    const upsert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'x1' }, error: null }) }) }))
    const sb = { from: vi.fn(() => ({ upsert })) } as never
    const id = await setAvailabilityException(sb, 'g1', { date: '2026-11-18', available: false })
    expect(id).toBe('x1')
    expect(upsert).toHaveBeenCalledWith(
      { group_id: 'g1', date: '2026-11-18', available: false, start_time: null, end_time: null, note: null },
      { onConflict: 'group_id,user_id,date' },
    )
  })
})

describe('findCommonAvailability', () => {
  // 2026-11-16 is a Monday (getUTCDay() === 1), matching weekday: 1 below.
  const rules: AvailabilityRule[] = [
    { id: 'r1', groupId: 'g1', userId: 'u1', weekday: 1, startTime: '18:00', endTime: '22:00' },
    { id: 'r2', groupId: 'g1', userId: 'u2', weekday: 1, startTime: '19:00', endTime: '23:00' },
  ]

  it('intersects two users\' rules into the overlapping window', () => {
    const out = findCommonAvailability(rules, [], ['u1', 'u2'], '2026-11-16')
    expect(out).toEqual([{ date: '2026-11-16', startTime: '19:00', endTime: '22:00' }])
  })

  it('an exception marking a user unavailable removes that day entirely', () => {
    const exceptions: AvailabilityException[] = [{ id: 'x1', groupId: 'g1', userId: 'u1', date: '2026-11-16', available: false, startTime: null, endTime: null, note: null }]
    const out = findCommonAvailability(rules, exceptions, ['u1', 'u2'], '2026-11-16')
    expect(out).toEqual([])
  })

  it('a user with no rule for that weekday contributes no availability', () => {
    const out = findCommonAvailability(rules, [], ['u1', 'u3'], '2026-11-16')
    expect(out).toEqual([])
  })
})

describe('isUserAvailable (E11: Discord bot sub-finding)', () => {
  // 2026-11-16 is a Monday (getUTCDay() === 1).
  const rules: AvailabilityRule[] = [{ id: 'r1', groupId: 'g1', userId: 'u1', weekday: 1, startTime: '18:00', endTime: '22:00' }]

  it('is true when a recurring rule covers that weekday and there is no exception', () => {
    expect(isUserAvailable(rules, [], 'u1', '2026-11-16')).toBe(true)
  })

  it('is false when there is no rule for that weekday and no exception', () => {
    expect(isUserAvailable(rules, [], 'u1', '2026-11-17')).toBe(false) // Tuesday, no rule
  })

  it('an unavailable exception overrides a matching rule', () => {
    const exceptions: AvailabilityException[] = [{ id: 'x1', groupId: 'g1', userId: 'u1', date: '2026-11-16', available: false, startTime: null, endTime: null, note: null }]
    expect(isUserAvailable(rules, exceptions, 'u1', '2026-11-16')).toBe(false)
  })

  it('an available exception overrides the lack of a rule', () => {
    const exceptions: AvailabilityException[] = [{ id: 'x1', groupId: 'g1', userId: 'u1', date: '2026-11-17', available: true, startTime: null, endTime: null, note: null }]
    expect(isUserAvailable(rules, exceptions, 'u1', '2026-11-17')).toBe(true)
  })

  it('is false for a user with neither a rule nor an exception', () => {
    expect(isUserAvailable([], [], 'u2', '2026-11-16')).toBe(false)
  })
})

describe('calendar subscription (E4 v2 — live iCal)', () => {
  it('getCalendarSubscription maps a row and computes the ics URL from the token', async () => {
    const sb = { from: vi.fn(() => chain({ data: { id: 's1', group_id: 'g1', token: 'deadbeef', created_by: 'u1', created_at: 't' }, error: null })) } as never
    const out = await getCalendarSubscription(sb, 'g1', 'https://proj.supabase.co')
    expect(out).toEqual({
      id: 's1', groupId: 'g1', token: 'deadbeef', createdBy: 'u1', createdAt: 't',
      icsUrl: 'https://proj.supabase.co/functions/v1/team-calendar-ics/deadbeef.ics',
    })
  })

  it('getCalendarSubscription returns null when none exists yet', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: null })) } as never
    expect(await getCalendarSubscription(sb, 'g1', 'https://proj.supabase.co')).toBeNull()
  })

  it('createCalendarSubscription inserts a fresh random token and returns the computed URL', async () => {
    const insert = vi.fn((row: { group_id: string; token: string }) => ({
      select: () => ({ single: () => Promise.resolve({ data: { id: 's1', group_id: row.group_id, token: row.token, created_by: 'u1', created_at: 't' }, error: null }) }),
    }))
    const sb = { from: vi.fn(() => ({ insert })) } as never
    const out = await createCalendarSubscription(sb, 'g1', 'https://proj.supabase.co')
    expect(out.groupId).toBe('g1')
    expect(out.token).toMatch(/^[a-f0-9]{40}$/)
    expect(out.icsUrl).toBe(`https://proj.supabase.co/functions/v1/team-calendar-ics/${out.token}.ics`)
  })

  it('revokeCalendarSubscription deletes by id', async () => {
    const del = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ delete: del })) } as never
    await revokeCalendarSubscription(sb, 's1')
    expect(del).toHaveBeenCalled()
  })
})
