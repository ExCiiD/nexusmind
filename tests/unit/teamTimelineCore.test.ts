/**
 * #40 § 10: team objectives and gold curve from a match-v5 timeline, and the Objectives tab's averages.
 */
import { describe, it, expect } from 'vitest'
import {
  extractTeamTimeline, summarizeTeamObjectives, filterTeamTimelines, isCurrentTimeline, patchOf, GRUBS_PER_GAME,
  TEAM_TIMELINE_VERSION,
} from '../../src/lib/teamTimelineCore'
import { opponentKeyOf, type TeamGameTimeline, type TeamObjectivesFilters } from '../../src/lib/analyst'

const MIN = 60_000

function match(o: { version?: string; blueWin?: boolean; start?: number; duration?: number } = {}) {
  return {
    info: {
      gameVersion: o.version ?? '16.22.734.1234',
      gameStartTimestamp: o.start ?? Date.parse('2026-11-18T19:00:00Z'),
      gameDuration: o.duration ?? 1800,
      teams: [{ teamId: 100, win: o.blueWin ?? true }, { teamId: 200, win: !(o.blueWin ?? true) }],
      participants: Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, teamId: i < 5 ? 100 : 200, win: i < 5 ? (o.blueWin ?? true) : !(o.blueWin ?? true) })),
    },
  }
}

/** Frames of one minute; blue players gain 100 g more per minute each than red ones. */
function timeline(events: any[], minutes = 31) {
  const frames = Array.from({ length: minutes }, (_, m) => {
    const participantFrames: Record<string, any> = {}
    for (let pid = 1; pid <= 10; pid++) participantFrames[pid] = { totalGold: 500 + m * (pid <= 5 ? 400 : 300) }
    return { timestamp: m * MIN, participantFrames, events: events.filter((e) => Math.floor(e.timestamp / MIN) === m) }
  })
  return { info: { frames } }
}

const EVENTS = [
  { type: 'CHAMPION_KILL', timestamp: 3 * MIN + 10_000, killerId: 7, victimId: 2 }, // first blood: red
  { type: 'CHAMPION_KILL', timestamp: 4 * MIN, killerId: 1, victimId: 8 },
  { type: 'ELITE_MONSTER_KILL', timestamp: 5 * MIN + 20_000, killerTeamId: 100, killerId: 2, monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON' },
  { type: 'ELITE_MONSTER_KILL', timestamp: 8 * MIN + 5_000, killerTeamId: 100, killerId: 2, monsterType: 'HORDE' },
  { type: 'ELITE_MONSTER_KILL', timestamp: 8 * MIN + 9_000, killerTeamId: 100, killerId: 2, monsterType: 'HORDE' },
  { type: 'ELITE_MONSTER_KILL', timestamp: 8 * MIN + 14_000, killerTeamId: 200, killerId: 7, monsterType: 'HORDE' },
  { type: 'BUILDING_KILL', timestamp: 12 * MIN, buildingType: 'TOWER_BUILDING', teamId: 200, laneType: 'BOT_LANE', towerType: 'OUTER_TURRET', killerId: 4 },
  { type: 'ELITE_MONSTER_KILL', timestamp: 16 * MIN, killerTeamId: 200, killerId: 7, monsterType: 'RIFTHERALD' },
  { type: 'ELITE_MONSTER_KILL', timestamp: 22 * MIN, killerTeamId: 100, killerId: 2, monsterType: 'BARON_NASHOR' },
  { type: 'ELITE_MONSTER_KILL', timestamp: 29 * MIN, killerTeamId: 100, killerId: 2, monsterType: 'DRAGON', monsterSubType: 'ELDER_DRAGON' },
]

const meta = (ourTeamId: 100 | 200, over: Partial<{ gameId: string; source: 'scrim' | 'tournament' | 'flex' }> = {}) =>
  ({ gameId: over.gameId ?? 'g1', matchId: 'EUW1_1', source: over.source ?? 'scrim', ourTeamId, opponentName: 'Aegis' } as const)

describe('extractTeamTimeline', () => {
  it('reads every objective from our side, and the gold difference per minute', () => {
    const t = extractTeamTimeline(match(), timeline(EVENTS), meta(100))!
    expect(t).toMatchObject({ version: TEAM_TIMELINE_VERSION, side: 'blue', win: true, patch: '16.22', grubsAvailable: 3, durationSec: 1800 })
    expect(t.events.map((e) => [e.kind, e.atSec, e.ours, e.subType ?? null, e.lane ?? null, e.count ?? null])).toEqual([
      ['firstBlood', 190, false, null, null, null],
      ['dragon', 320, true, 'FIRE', null, null],
      ['grubs', 485, true, null, null, 2],
      ['grubs', 494, false, null, null, 1],
      ['tower', 720, true, 'OUTER', 'BOT', null],
      ['herald', 960, false, null, null, null],
      ['baron', 1320, true, null, null, null],
      ['elder', 1740, true, null, null, null],
    ])
    // 5 players × 100 g more per minute.
    expect(t.goldDiffByMinute.slice(0, 3)).toEqual([0, 500, 1000])
  })

  it('from the red side everything flips, and an execution still gives first blood to the other team', () => {
    const t = extractTeamTimeline(match({ blueWin: true }), timeline([{ type: 'CHAMPION_KILL', timestamp: 2 * MIN, killerId: 0, victimId: 3 }, ...EVENTS.slice(2)]), meta(200))!
    expect(t.side).toBe('red')
    expect(t.win).toBe(false)
    expect(t.events[0]).toMatchObject({ kind: 'firstBlood', ours: true })
    expect(t.events.find((e) => e.kind === 'baron')?.ours).toBe(false)
    expect(t.goldDiffByMinute[2]).toBe(-1000)
  })

  it('no frames, no summary; one camp of 3 grubs', () => {
    expect(extractTeamTimeline(match(), { info: { frames: [] } }, meta(100))).toBeNull()
    expect(GRUBS_PER_GAME).toBe(3)
    expect(patchOf('15.24.715.2077')).toBe('15.24')
    expect(patchOf(undefined)).toBe('')
  })

  it('a cached summary of another version is extracted again', () => {
    const t = extractTeamTimeline(match(), timeline(EVENTS), meta(100))!
    expect(isCurrentTimeline(t)).toBe(true)
    expect(isCurrentTimeline({ ...t, version: TEAM_TIMELINE_VERSION - 1 })).toBe(false)
    expect(isCurrentTimeline(null)).toBe(false)
  })
})

describe('summarizeTeamObjectives', () => {
  const day = (d: number) => Date.parse(`2026-11-${String(d).padStart(2, '0')}T19:00:00Z`)
  const games: TeamGameTimeline[] = [
    extractTeamTimeline(match({ start: day(10) }), timeline(EVENTS), meta(100, { gameId: 'a' }))!,
    extractTeamTimeline(match({ start: day(12), blueWin: false }), timeline(EVENTS), meta(200, { gameId: 'b', source: 'tournament' }))!,
    extractTeamTimeline(match({ start: day(14) }), timeline(EVENTS), meta(100, { gameId: 'c', source: 'flex' }))!,
  ]
  const ALL: TeamObjectivesFilters = { sources: ['scrim', 'tournament'], side: 'both' }

  it('filters by source, side and dates, newest first', () => {
    expect(filterTeamTimelines(games, ALL).map((g) => g.gameId)).toEqual(['a', 'b'])
    expect(summarizeTeamObjectives(games, { ...ALL, sources: ['scrim', 'tournament', 'flex'] }).timeline.map((g) => g.gameId)).toEqual(['c', 'b', 'a'])
    expect(filterTeamTimelines(games, { ...ALL, side: 'red' }).map((g) => g.gameId)).toEqual(['b'])
    expect(filterTeamTimelines(games, { ...ALL, from: '2026-11-11', to: '2026-11-12' }).map((g) => g.gameId)).toEqual(['b'])
  })

  it('tiles: shares of the objectives, timings of ours, a low sample under 5 games', () => {
    const s = summarizeTeamObjectives(games, ALL)
    expect(s.games).toBe(2)
    expect(s.lowSample).toBe(true)
    expect(s.patch).toBe('16.22')
    // Game a (blue): dragon, grubs first camp, tower, Baron ours; game b (red): all of those theirs.
    expect(s.tiles.dragons).toEqual({ share: 0.5, firstDragonShare: 0.5, soulsOurs: 0, soulGames: 0 })
    expect(s.tiles.grubs).toEqual({ avgTaken: 1.5, available: 3, firstCampShare: 0.5 }) // 2 in game a, 1 in game b
    expect(s.tiles.herald).toEqual({ share: 0.5, avgAtSec: 960 })
    expect(s.tiles.baron).toEqual({ share: 0.5, baronToWinShare: 1 })
    expect(s.tiles.firstBlood).toEqual({ share: 0.5, avgAtSec: 190 })
    expect(s.tiles.firstTower).toEqual({ share: 0.5, avgAtSec: 720, mostLane: 'BOT' })
  })

  it('gold curve per side, and first-objective timings ours vs theirs', () => {
    const s = summarizeTeamObjectives(games, ALL)
    expect(s.goldCurve.blue[2]).toBe(1000)
    expect(s.goldCurve.red[2]).toBe(-1000)
    expect(s.goldCurve.all[2]).toBe(0)
    expect(s.goldCurve.all).toHaveLength(31)
    expect(s.avgTimings.find((t) => t.kind === 'baron')).toEqual({ kind: 'baron', oursSec: 1320, theirsSec: 1320 })
    expect(s.avgTimings.map((t) => t.kind)).toEqual(['firstBlood', 'tower', 'dragon', 'grubs', 'herald', 'baron', 'elder'])
  })

  it('no games: nulls, not zeros', () => {
    const s = summarizeTeamObjectives([], ALL)
    expect(s.games).toBe(0)
    expect(s.tiles.dragons.share).toBeNull()
    expect(s.goldCurve.all.every((v) => v === null)).toBe(true)
    expect(s.patch).toBeNull()
  })
})

describe('opponentKeyOf', () => {
  it('trims, collapses spaces, lower case', () => {
    expect(opponentKeyOf('  Aegis   Gaming ')).toBe('aegis gaming')
  })
})
