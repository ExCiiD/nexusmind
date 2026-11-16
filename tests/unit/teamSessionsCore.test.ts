import { describe, it, expect } from 'vitest'
import { countdownState, matchesQueueFilter, queueBucket } from '../../src/lib/teamSessionsCore'

describe('countdownState', () => {
  const now = new Date('2026-01-01T12:00:00.000Z')

  it('is past once the start time has elapsed', () => {
    const state = countdownState('2026-01-01T11:59:00.000Z', now)
    expect(state.isPast).toBe(true)
    expect(state.msRemaining).toBe(0)
    expect(state.label).toBe('Starting now')
  })

  it('formats hours + minutes when more than an hour remains', () => {
    const state = countdownState('2026-01-01T14:30:00.000Z', now)
    expect(state.isPast).toBe(false)
    expect(state.label).toBe('2h 30m')
  })

  it('formats minutes + seconds under an hour', () => {
    const state = countdownState('2026-01-01T12:05:30.000Z', now)
    expect(state.label).toBe('5m 30s')
  })

  it('formats seconds only under a minute', () => {
    const state = countdownState('2026-01-01T12:00:45.000Z', now)
    expect(state.label).toBe('45s')
  })
})

describe('queueBucket', () => {
  it('maps custom queue to scrim regardless of roster overlap', () => {
    expect(queueBucket('custom', 0)).toBe('scrim')
    expect(queueBucket('custom', 5)).toBe('scrim')
  })

  it('maps flex queue to ranked5 only once roster overlap reaches the threshold', () => {
    expect(queueBucket('flex', 0)).toBe('flex')
    expect(queueBucket('flex', 3)).toBe('flex')
    expect(queueBucket('flex', 4)).toBe('ranked5')
    expect(queueBucket('flex', 5)).toBe('ranked5')
  })

  it('maps anything else to other', () => {
    expect(queueBucket('soloq', 5)).toBe('other')
    expect(queueBucket('aram', 0)).toBe('other')
  })
})

describe('matchesQueueFilter', () => {
  it('matches everything when the filter is null or all', () => {
    expect(matchesQueueFilter(null, 'scrim')).toBe(true)
    expect(matchesQueueFilter('all', 'ranked5')).toBe(true)
  })

  it('matches only the exact bucket otherwise', () => {
    expect(matchesQueueFilter('scrim', 'scrim')).toBe(true)
    expect(matchesQueueFilter('scrim', 'flex')).toBe(false)
    expect(matchesQueueFilter('ranked5', 'ranked5')).toBe(true)
    expect(matchesQueueFilter('flex', 'ranked5')).toBe(false)
  })
})
