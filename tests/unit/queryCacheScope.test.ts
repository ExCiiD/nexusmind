import { beforeEach, describe, expect, it } from 'vitest'
import { clearQueryCache, dropCachedData, getEntry, invalidateCached, scopeChanged, setCached, subscribe } from '../../src/lib/queryCache'
import { groupKey, invalidateGroupCalendar, invalidateGroupTasks, userKey } from '../../src/lib/groupQueries'
import { mistakeOccurrencesKey } from '../../src/lib/pageQueries'

// Perf gain 3: never another profile's, account's or group's data.
describe('cache scope', () => {
  beforeEach(() => clearQueryCache())

  it('drops every entry on a profile or account change, and tells the pages showing them', () => {
    setCached('games:history-100', [1])
    setCached(userKey('u1', 'wellbeing'), { checkins: [] })
    const seen: string[] = []
    subscribe('games:history-100', () => seen.push('history'))
    dropCachedData()
    expect(getEntry('games:history-100')).toBeUndefined()
    expect(getEntry(userKey('u1', 'wellbeing'))).toBeUndefined()
    expect(seen).toEqual(['history'])
    // The listeners stay: the page is told again on the next data.
    setCached('games:history-100', [2])
    expect(seen).toEqual(['history', 'history'])
  })

  it('a first value is not a change; another one, or none, is', () => {
    expect(scopeChanged(null, 'a')).toBe(false)
    expect(scopeChanged(undefined, 'a')).toBe(false)
    expect(scopeChanged('a', 'a')).toBe(false)
    expect(scopeChanged('a', 'b')).toBe(true)
    expect(scopeChanged('a', null)).toBe(true)
  })

  it('keys carry the group, and a group change reaches only that group', () => {
    setCached(groupKey('g1', 'calendar:planning:2026-11-16'), 1)
    setCached(groupKey('g2', 'calendar:planning:2026-11-16'), 1)
    setCached('org:week:g1:2026-11-16', 1)
    setCached(groupKey('g1', 'tasks'), 1)
    setCached('org:tasks:g1', 1)
    invalidateGroupCalendar('g1')
    expect(getEntry(groupKey('g1', 'calendar:planning:2026-11-16'))?.at).toBe(0)
    expect(getEntry('org:week:g1:2026-11-16')?.at).toBe(0)
    expect(getEntry(groupKey('g2', 'calendar:planning:2026-11-16'))?.at).toBeGreaterThan(0)
    expect(getEntry(groupKey('g1', 'tasks'))?.at).toBeGreaterThan(0)
    invalidateGroupTasks('g1')
    expect(getEntry(groupKey('g1', 'tasks'))?.at).toBe(0)
    expect(getEntry('org:tasks:g1')?.at).toBe(0)
  })

  it('the mistakes filter is part of the key, and a game end reaches it', () => {
    const a = mistakeOccurrencesKey({ days: 30, role: null, champion: 'Ahri' })
    expect(a).toBe(mistakeOccurrencesKey({ days: 30, role: null, champion: 'ahri' }))
    expect(a).not.toBe(mistakeOccurrencesKey({ days: 7, role: null, champion: 'ahri' }))
    setCached(a, [])
    invalidateCached('games:')
    expect(getEntry(a)?.at).toBe(0)
  })
})
