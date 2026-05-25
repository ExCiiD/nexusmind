import { describe, it, expect } from 'vitest'
import { gameTimeToVideoTime, mapEventsToVideoTime } from '../../src/lib/eventSync'

describe('gameTimeToVideoTime', () => {
  // Scenario: a 30-minute game that ended at 12:30:00. Recording started at
  // 12:00:30 (30s INTO the game's loading screen, so offset = +30s).
  const baseOpts = {
    gameEndAt: new Date('2026-01-01T12:30:00Z'),
    gameDurationSec: 1800, // 30 min
    recordingCreatedAt: new Date('2026-01-01T12:00:30Z'),
    videoDurationSec: 1800,
  }

  it('returns the right video time when offset is +30s', () => {
    // event at in-game 5:00 → real time 12:05:00 → video time 12:05:00 - 12:00:30 = 4:30
    const t = gameTimeToVideoTime({ ...baseOpts, eventGameTimeMs: 300_000 })
    expect(t).toBeCloseTo(270, 0)
  })

  it('returns null for events before recording started', () => {
    // event at 0:10 in-game → real 12:00:10 → before 12:00:30 recording start
    const t = gameTimeToVideoTime({ ...baseOpts, eventGameTimeMs: 10_000 })
    expect(t).toBeNull()
  })

  it('returns null for events after video ends', () => {
    // event at in-game 30:00 → real 12:30:00 → video time 29:30; recording is 30 min so this fits.
    // But event at 60min would be way past.
    const t = gameTimeToVideoTime({ ...baseOpts, eventGameTimeMs: 60 * 60_000 })
    expect(t).toBeNull()
  })

  it('respects pre-computed startOffsetSec over birthtime derivation', () => {
    // birthtime suggests offset = -90s (started 90s BEFORE game), but DB says 60s.
    const t = gameTimeToVideoTime({
      ...baseOpts,
      recordingCreatedAt: new Date('2026-01-01T11:58:30Z'), // would yield -90s offset
      startOffsetSec: 60,
      eventGameTimeMs: 120_000, // 2:00 in-game
    })
    // With offset=60: videoT = 120 - 60 = 60
    expect(t).toBeCloseTo(60, 0)
  })

  it('handles recording started BEFORE game start (negative offset)', () => {
    const t = gameTimeToVideoTime({
      ...baseOpts,
      recordingCreatedAt: new Date('2026-01-01T11:59:30Z'), // 30s before game start
      eventGameTimeMs: 60_000,
    })
    // offset = -30s → videoT = 60 - (-30) = 90
    expect(t).toBeCloseTo(90, 0)
  })
})

describe('mapEventsToVideoTime', () => {
  it('drops events outside the video range and preserves original fields', () => {
    const events = [
      { gameTimeMs: 10_000, label: 'too early' },
      { gameTimeMs: 60_000, label: 'in range' },
      { gameTimeMs: 999_999_999, label: 'too late' },
    ]
    const out = mapEventsToVideoTime(events, {
      gameEndAt: new Date('2026-01-01T12:30:00Z'),
      gameDurationSec: 1800,
      recordingCreatedAt: new Date('2026-01-01T12:00:30Z'),
      videoDurationSec: 1800,
    })
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('in range')
    expect(out[0].videoTime).toBeCloseTo(30, 0)
  })
})
