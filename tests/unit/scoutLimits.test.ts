import { describe, it, expect } from 'vitest'
import { registerScout, releaseScout, assertScoutMemberCount, MAX_ACTIVE_SCOUTS, MAX_SCOUT_MEMBERS } from '../../src/lib/scoutEngine'

describe('scout limits (security audit 27/11)', () => {
  it('F1: refuses a scout above MAX_ACTIVE_SCOUTS with TOO_MANY_SCOUTS, and accepts one again once a slot is freed', () => {
    const active = new Map<string, { cancelled: boolean }>()
    const flags = Array.from({ length: MAX_ACTIVE_SCOUTS }, (_, i) => registerScout(active, `scout-${i}`))
    expect(() => registerScout(active, 'scout-extra')).toThrow(/TOO_MANY_SCOUTS/)
    releaseScout(active, 'scout-0', flags[0])
    expect(() => registerScout(active, 'scout-extra')).not.toThrow()
  })

  it('F3: refuses an id already active, and a finished scout only frees its own flag', () => {
    const active = new Map<string, { cancelled: boolean }>()
    const first = registerScout(active, 'same-id')
    expect(() => registerScout(active, 'same-id')).toThrow(/already running/)
    // A stale flag (another scout's) must not remove the live one.
    releaseScout(active, 'same-id', { cancelled: false })
    expect(active.get('same-id')).toBe(first)
    releaseScout(active, 'same-id', first)
    expect(active.has('same-id')).toBe(false)
  })

  it('a cancel that arrived early starts the scout cancelled', () => {
    expect(registerScout(new Map(), 'early-cancel', true).cancelled).toBe(true)
  })

  it('F4: 1 to MAX_SCOUT_MEMBERS members', () => {
    expect(() => assertScoutMemberCount(MAX_SCOUT_MEMBERS)).not.toThrow()
    expect(() => assertScoutMemberCount(MAX_SCOUT_MEMBERS + 1)).toThrow(/1 to 20/)
    expect(() => assertScoutMemberCount(0)).toThrow()
  })
})
