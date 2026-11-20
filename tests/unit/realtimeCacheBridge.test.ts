import { beforeEach, describe, expect, it } from 'vitest'
import { invalidateForRealtime } from '../../src/components/RealtimeCacheBridge'
import { clearQueryCache, getEntry, setCached } from '../../src/lib/queryCache'
import { groupKey } from '../../src/lib/groupQueries'

const fresh = (key: string) => (getEntry(key)?.at ?? 0) > 0

describe('Realtime → page cache', () => {
  beforeEach(() => {
    clearQueryCache()
    setCached(groupKey('g1', 'calendar:planning:2026-11-16'), 1)
    setCached('org:week:g1:2026-11-16', 1)
    setCached(groupKey('g1', 'sessions:all:month'), 1)
    setCached(groupKey('g1', 'announcements'), 1)
    setCached(groupKey('g2', 'calendar:planning:2026-11-16'), 1)
    setCached(groupKey('g1', 'tasks'), 1)
  })

  it('a calendar change of a group refreshes that group\'s calendar keys only', () => {
    invalidateForRealtime({ topic: 'calendar', groupId: 'g1' }, ['g1', 'g2'])
    expect(fresh(groupKey('g1', 'calendar:planning:2026-11-16'))).toBe(false)
    expect(fresh('org:week:g1:2026-11-16')).toBe(false)
    expect(fresh(groupKey('g2', 'calendar:planning:2026-11-16'))).toBe(true)
    expect(fresh(groupKey('g1', 'tasks'))).toBe(true)
  })

  it('an event without a group (rls table) refreshes the topic in every group of mine', () => {
    invalidateForRealtime({ topic: 'calendar', groupId: null }, ['g1', 'g2'])
    expect(fresh(groupKey('g1', 'calendar:planning:2026-11-16'))).toBe(false)
    expect(fresh(groupKey('g2', 'calendar:planning:2026-11-16'))).toBe(false)
  })

  it('team sessions, reviews and announcements reach their keys; notifications touch nothing', () => {
    invalidateForRealtime({ topic: 'team_session_reviews', groupId: null }, ['g1'])
    expect(fresh(groupKey('g1', 'sessions:all:month'))).toBe(false)
    invalidateForRealtime({ topic: 'announcements', groupId: 'g1' }, ['g1'])
    expect(fresh(groupKey('g1', 'announcements'))).toBe(false)
    invalidateForRealtime({ topic: 'notifications', groupId: null }, ['g1'])
    expect(fresh(groupKey('g1', 'tasks'))).toBe(true)
  })
})
