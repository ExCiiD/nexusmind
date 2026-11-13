import { describe, it, expect } from 'vitest'
import { isIdleEnough, buildAutoConclusion, IDLE_MINUTES } from '../../electron/main/sessionAutoClose'

const MIN = 60_000

describe('isIdleEnough', () => {
  it('uses the last game end when there is one', () => {
    const now = 1_000_000
    expect(isIdleEnough({ date: 0, lastGameEndAt: now - IDLE_MINUTES * MIN }, now)).toBe(true)
    expect(isIdleEnough({ date: 0, lastGameEndAt: now - (IDLE_MINUTES * MIN - 1) }, now)).toBe(false)
  })

  it('falls back to the session start when no game was played', () => {
    const now = 1_000_000
    expect(isIdleEnough({ date: now - IDLE_MINUTES * MIN, lastGameEndAt: null }, now)).toBe(true)
    expect(isIdleEnough({ date: now - MIN, lastGameEndAt: null }, now)).toBe(false)
  })

  it('a recent game keeps the session active even if it started long ago', () => {
    const now = 1_000_000
    expect(isIdleEnough({ date: now - 10 * IDLE_MINUTES * MIN, lastGameEndAt: now - MIN }, now)).toBe(false)
  })
})

describe('buildAutoConclusion', () => {
  it('mentions the record when games were played', () => {
    expect(buildAutoConclusion({ gamesPlayed: 4, wins: 3 })).toBe(
      'Session closed automatically after 45 minutes of inactivity — 4 game(s) (3W-1L).',
    )
  })
  it('has a distinct message with no games played', () => {
    expect(buildAutoConclusion({ gamesPlayed: 0, wins: 0 })).toBe('Session closed automatically after 45 minutes with no game played.')
  })
})
