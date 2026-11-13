import { describe, it, expect } from 'vitest'
import {
  attachPerfIndex,
  buildPlayerContext,
  computeGameFeatures,
  computeMetricStats,
  kpiAverage,
  laneFromReport,
  playStretchMinutes,
  roleBucket,
  series,
  slope,
  stdDev,
  streak,
} from '../../electron/main/assistant/features'
import { extractTimelineFacts } from '../../electron/main/assistant/timeline'
import { NOW, game, games, session } from './assistantFixtures'

describe('per-game features', () => {
  it('normalises per-minute stats and counts early deaths', () => {
    const f = computeGameFeatures(game({ cs: 240, visionScore: 30, durationSec: 1800, deathTimesSec: [120, 500, 700, 1200] }))
    expect(f.values.csPerMin).toBeCloseTo(8)
    expect(f.values.visionPerMin).toBeCloseTo(1)
    expect(f.values.deathsBefore10).toBe(2)
    expect(f.values.deathsBefore14).toBe(3)
  })

  it('leaves timeline-only metrics null when the timeline is unknown', () => {
    const f = computeGameFeatures(game({ deathTimesSec: null, lane: null, killParticipation: null }))
    expect(f.values.deathsBefore10).toBeNull()
    expect(f.values.csAt10).toBeNull()
    expect(f.values.kp).toBeNull()
  })

  it('averages KPI self-scores, ignoring unset (0) scores', () => {
    expect(kpiAverage({ a: 8, b: 6, c: 0 })).toBe(7)
    expect(kpiAverage({})).toBeNull()
    expect(kpiAverage(null)).toBeNull()
  })

  it('reads CS / gold at 10 and 14 from a lane phase report', () => {
    const lane = laneFromReport({
      grade: 'B+',
      scoreComponents: { numericScore: 64 },
      framesByMinute: [
        { minute: 10, cs: { player: 78 }, gold: { diff: 350 } },
        { minute: 14, cs: { player: 112 }, gold: { diff: -100 } },
      ],
    })
    expect(lane).toEqual({ grade: 'B+', numericScore: 64, csAt10: 78, csAt14: 112, goldDiff10: 350, goldDiff14: -100 })
    expect(laneFromReport(null)).toBeNull()
    const f = computeGameFeatures(game({ lane: { grade: 'C' } }))
    expect(f.values.laneScore).toBe(40) // grade fallback when no numeric score
  })

  it('buckets Riot roles', () => {
    expect(roleBucket('JUNGLE')).toBe('jungle')
    expect(roleBucket('UTILITY')).toBe('support')
    expect(roleBucket('MIDDLE')).toBe('laner')
  })
})

describe('rolling statistics', () => {
  it('computes sd and slope', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3)
    expect(slope([1, 2, 3, 4])).toBeCloseTo(1)
    expect(slope([4, 3, 2, 1])).toBeCloseTo(-1)
    expect(slope([1, 2])).toBeNull()
  })

  it('z-score compares the recent window with the personal baseline', () => {
    const s = computeMetricStats('csPerMin', [7, 7.2, 6.8, 7.1, 6.9, 7, 7.1, 5, 5.2, 4.8, 5.1, 4.9])
    expect(s.recentMean).toBeCloseTo(5)
    expect(s.baselineMean).toBeCloseTo(7.014, 2)
    expect(s.z).toBeLessThan(-3)
    expect(s.trend).toBeLessThan(0)
  })

  it('reports no z-score without enough baseline', () => {
    expect(computeMetricStats('deaths', [1, 2, 3, 4, 5, 6]).z).toBeNull()
  })

  it('series is chronological and skips nulls', () => {
    const fs = [game({ ago: 1, deaths: 9 }), game({ ago: 3, deaths: 1 }), game({ ago: 2, deaths: 5 })].map(computeGameFeatures)
    expect(series(fs, 'deaths')).toEqual([1, 5, 9])
  })

  it('perfIndex is high for a game above the personal average', () => {
    const fs = games(10, (i) => ({ cs: i === 0 ? 300 : 210, deaths: i === 0 ? 1 : 5, kills: i === 0 ? 10 : 3 })).map(computeGameFeatures)
    attachPerfIndex(fs)
    expect(fs[0].values.perfIndex!).toBeGreaterThan(1)
    expect(fs[5].values.perfIndex!).toBeLessThan(0.5)
  })
})

describe('player context', () => {
  it('counts streaks newest first', () => {
    const fs = games(5, (i) => ({ win: i >= 3 })).map(computeGameFeatures)
    expect(streak(fs, false)).toBe(3)
    expect(streak(fs, true)).toBe(0)
  })

  it('measures the current play stretch of the active session', () => {
    // Games of 30 min ending 0.2 / 0.9 / 1.6 / 2.3 h ago: back-to-back.
    const gs = games(4, (i) => ({ ago: 0.2 + i * 0.7, sessionId: 'live', durationSec: 1800 }))
    const ctx = buildPlayerContext({ games: gs, sessions: [session({ id: 'live', status: 'active' })], now: NOW })
    expect(ctx.activeSession?.games).toBe(4)
    expect(ctx.activeSession?.minutes).toBeCloseTo(168)
  })

  it('a long pause ends the play stretch; a stale session counts as rested', () => {
    const H = 3600_000
    const g = (endAgoH: number) => ({ endedAt: NOW - endAgoH * H, durationSec: 1800 })
    expect(playStretchMinutes([g(0.2), g(0.9), g(3), g(3.7)], NOW)).toBeCloseTo(84) // 2nd game started 1.4 h ago
    expect(playStretchMinutes([g(2), g(2.7)], NOW)).toBe(0)
    expect(playStretchMinutes([], NOW)).toBe(0)
  })

  it('detects an objective repeated across sessions and whether it progresses', () => {
    const sessions = [1, 2, 3, 4].map((i) => session({ id: `s${i}`, date: NOW - i * 86400_000, objectiveIds: ['tempo'], selectedKpiIds: ['k'] }))
    const flat = games(8, (i) => ({ sessionId: `s${Math.floor(i / 2) + 1}`, kpiScores: { k: 5 } }))
    const ctx = buildPlayerContext({ games: flat, sessions, now: NOW })
    expect(ctx.objectiveRun).toMatchObject({ objectiveId: 'tempo', sessions: 4, progressing: false })

    // Newest sessions have higher self-scores → progressing.
    const up = games(8, (i) => ({ sessionId: `s${Math.floor(i / 2) + 1}`, kpiScores: { k: 9 - Math.floor(i / 2) * 1.5 } }))
    expect(buildPlayerContext({ games: up, sessions, now: NOW }).objectiveRun?.progressing).toBe(true)
  })
})

describe('timeline extraction', () => {
  const match = {
    info: {
      participants: [
        { participantId: 1, puuid: 'me', championName: 'Ahri', teamId: 100, kills: 3, assists: 5, win: true },
        { participantId: 2, puuid: 'ally', championName: 'Lee', teamId: 100, kills: 7, assists: 2, win: true },
        { participantId: 6, puuid: 'foe', championName: 'Zed', teamId: 200, kills: 4, assists: 0, win: false },
      ],
    },
  }
  const timeline = {
    info: {
      frames: [
        { events: [{ type: 'CHAMPION_KILL', victimId: 1, timestamp: 245_000 }] },
        { events: [{ type: 'CHAMPION_KILL', victimId: 6, timestamp: 400_000 }, { type: 'CHAMPION_KILL', victimId: 1, timestamp: 1_020_000 }] },
      ],
    },
  }

  it('extracts the player death times and kill participation', () => {
    const f = extractTimelineFacts(match, timeline, { puuids: ['me'] })
    expect(f.deathTimesSec).toEqual([245, 1020])
    expect(f.killParticipation).toBeCloseTo(80)
  })

  it('falls back to the champion when the puuid is unknown, and survives bad JSON', () => {
    expect(extractTimelineFacts(JSON.stringify(match), null, { championName: 'ahri' }).killParticipation).toBeCloseTo(80)
    expect(extractTimelineFacts('{bad', null, { puuids: ['me'] })).toEqual({ deathTimesSec: null, killParticipation: null, lane: null })
  })
})
