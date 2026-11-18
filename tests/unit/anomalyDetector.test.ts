import { describe, it, expect } from 'vitest'
import { analyzeGame, pickMoments, deathTimerSec, type CriticalMoment } from '../../src/lib/microReview/anomalyDetector'
import { winProbability, winProbabilityCurve, isGarbageTime, winProbAt, objectiveKindOf } from '../../src/lib/microReview/winProbability'
import { zoneOf, territoryOf, laneOf, nearestPit, toMinimap, BARON_PIT, DRAGON_PIT, OUTER_TURRETS, RIFT_BOUNDS, TURRETS } from '../../src/lib/microReview/geometry'
import { buildGame, at } from './microReviewFixtures'

describe('winProbability', () => {
  it('is 0.5 when even and grows with a per-minute lead', () => {
    expect(winProbability(0, 0, 0, 20)).toBeCloseTo(0.5)
    expect(winProbability(4000, 3000, 0, 20)).toBeGreaterThan(0.75)
    expect(winProbability(-4000, -3000, 0, 20)).toBeLessThan(0.25)
  })
  it('weighs the same lead less late in the game', () => {
    expect(winProbability(3000, 0, 0, 15)).toBeGreaterThan(winProbability(3000, 0, 0, 35))
  })
  it('flags garbage time outside [0.18, 0.85]', () => {
    expect(isGarbageTime(0.1)).toBe(true)
    expect(isGarbageTime(0.9)).toBe(true)
    expect(isGarbageTime(0.5)).toBe(false)
    expect(isGarbageTime(null)).toBe(false)
  })
  it('counts objectives in the curve before the next snapshot', () => {
    const { match, timeline } = buildGame({ minutes: 5, events: [{ type: 'ELITE_MONSTER_KILL', timestamp: at(2, 30), killerId: 7, killerTeamId: 200, monsterType: 'DRAGON' }] })
    const teamOf = (id: number) => match.info.participants.find((p) => p.participantId === id)?.teamId
    const curve = winProbabilityCurve(timeline.info.frames, teamOf, 100)
    expect(curve[2]).toBeCloseTo(0.5)
    expect(curve[3]).toBeLessThan(0.5)
    expect(winProbAt(curve, at(2, 40))).toBe(curve[2])
  })
  it('maps timeline events to objective kinds', () => {
    expect(objectiveKindOf({ type: 'ELITE_MONSTER_KILL', monsterType: 'DRAGON', monsterSubType: 'ELDER_DRAGON' })).toBe('elder')
    expect(objectiveKindOf({ type: 'ELITE_MONSTER_KILL', monsterType: 'HORDE' })).toBe('grubs')
    expect(objectiveKindOf({ type: 'BUILDING_KILL', buildingType: 'INHIBITOR_BUILDING' })).toBe('inhibitor')
    expect(objectiveKindOf({ type: 'CHAMPION_KILL' })).toBeNull()
  })
})

describe('geometry', () => {
  it('classifies territory by x+y and team', () => {
    expect(territoryOf({ x: 3000, y: 3000 }, 100)).toBe('own')
    expect(territoryOf({ x: 3000, y: 3000 }, 200)).toBe('enemy')
    expect(territoryOf({ x: 7500, y: 7500 }, 100)).toBe('river')
  })
  it('names river sides and lanes', () => {
    expect(zoneOf(BARON_PIT, 100)).toBe('top-river')
    expect(zoneOf(DRAGON_PIT, 100)).toBe('bot-river')
    expect(laneOf({ x: 1000, y: 9000 })).toBe('TOP')
    expect(laneOf({ x: 9000, y: 1000 })).toBe('BOT')
    expect(laneOf({ x: 7400, y: 7600 })).toBe('MID')
    expect(laneOf({ x: 4000, y: 7000 })).toBe('JUNGLE')
    expect(zoneOf({ x: 500, y: 500 }, 100)).toBe('own-base')
    expect(zoneOf({ x: 11000, y: 9000 }, 100)).toBe('enemy-jungle')
  })
  it('finds the nearest pit', () => {
    expect(nearestPit({ x: 5500, y: 10000 })).toEqual({ pit: 'baron', distance: expect.any(Number) })
    expect(nearestPit({ x: 9500, y: 4800 }).pit).toBe('dragon')
  })
  it('places game positions on Riot\'s minimap through its bounds', () => {
    // Map corners: (minX, minY) is the bottom-left of the picture, (maxX, maxY) its top-right.
    expect(toMinimap({ x: RIFT_BOUNDS.minX, y: RIFT_BOUNDS.minY })).toEqual({ x: 0, y: 1 })
    expect(toMinimap({ x: RIFT_BOUNDS.maxX, y: RIFT_BOUNDS.maxY })).toEqual({ x: 1, y: 0 })
    // The pits sit in the upper-left and lower-right river basins of the picture.
    const baron = toMinimap(BARON_PIT)
    const dragon = toMinimap(DRAGON_PIT)
    expect(baron.x).toBeCloseTo(0.342, 3)
    expect(baron.y).toBeCloseTo(0.299, 3)
    expect(dragon.x).toBeCloseTo(0.666, 3)
    expect(dragon.y).toBeCloseTo(0.700, 3)
  })
  it('lists 11 turrets per team, the outer ones first in each lane', () => {
    for (const team of [100, 200] as const) {
      expect(TURRETS[team]).toHaveLength(11)
      expect(TURRETS[team]).toContain(OUTER_TURRETS[team].TOP)
      expect(TURRETS[team]).toContain(OUTER_TURRETS[team].MID)
      expect(TURRETS[team]).toContain(OUTER_TURRETS[team].BOT)
      // Every turret is on its own team's half of the map.
      for (const p of TURRETS[team]) expect(territoryOf(p, team)).toBe('own')
    }
  })
})

describe('analyzeGame — critical death', () => {
  const baronDeath = (extra: any[] = []) => buildGame({
    minutes: 30,
    frame: (i, pid) => (i === 25 && pid === 2 ? { currentGold: 1650 } : undefined),
    events: [
      { type: 'WARD_PLACED', timestamp: at(24, 0), creatorId: 2, wardType: 'YELLOW_TRINKET' },
      { type: 'CHAMPION_KILL', timestamp: at(25, 28), victimId: 2, killerId: 7, assistingParticipantIds: [8, 9], position: { x: 5600, y: 10000 } },
      { type: 'ELITE_MONSTER_KILL', timestamp: at(25, 58), killerId: 7, killerTeamId: 200, monsterType: 'BARON_NASHOR', position: BARON_PIT },
      ...extra,
    ],
  })

  it('keeps a death followed by a lost Baron, with its geometry and context', () => {
    const { match, timeline, selector } = baronDeath()
    const a = analyzeGame(match, timeline, selector)!
    expect(a.moments).toHaveLength(1)
    const m = a.moments[0]
    expect(m.trigger).toBe('critical-death')
    expect(m.gameTimeSec).toBe(25 * 60 + 28)
    expect(m.zone).toBe('top-river')
    expect(m.facts).toMatchObject({
      assisters: 2, enemiesInvolved: 3, alliesNearby: 0, goldInPocket: 1650, wardedLast60s: false,
      nearestPit: 'baron', nearObjective: true, objectiveLost: 'baron', objectiveLostAfterSec: 30,
    })
  })

  it('counts nearby allies and a recent ward', () => {
    const { match, timeline, selector } = buildGame({
      minutes: 30,
      frame: (i, pid) => (pid === 3 && (i === 25 || i === 26) ? { position: { x: 5400, y: 9800 } } : undefined),
      events: [
        { type: 'WARD_PLACED', timestamp: at(25, 0), creatorId: 2, wardType: 'CONTROL_WARD' },
        { type: 'CHAMPION_KILL', timestamp: at(25, 28), victimId: 2, killerId: 7, assistingParticipantIds: [], position: { x: 5600, y: 10000 } },
        { type: 'ELITE_MONSTER_KILL', timestamp: at(25, 58), killerId: 7, killerTeamId: 200, monsterType: 'BARON_NASHOR' },
      ],
    })
    const m = analyzeGame(match, timeline, selector)!.moments[0]
    expect(m.facts.alliesNearby).toBe(1)
    expect(m.facts.wardedLast60s).toBe(true)
    expect(m.facts.enemiesInvolved).toBe(1)
  })

  it('records a death right after the player\'s own kill', () => {
    const { match, timeline, selector } = baronDeath([{ type: 'CHAMPION_KILL', timestamp: at(25, 10), victimId: 8, killerId: 2, assistingParticipantIds: [] }])
    const m = analyzeGame(match, timeline, selector)!.moments[0]
    expect(m.facts.secondsSinceOwnPlay).toBe(18)
  })

  it('ignores a death with no consequence', () => {
    const { match, timeline, selector } = buildGame({ events: [{ type: 'CHAMPION_KILL', timestamp: at(12), victimId: 2, killerId: 7, position: { x: 4000, y: 7000 } }] })
    expect(analyzeGame(match, timeline, selector)!.moments).toHaveLength(0)
  })

  it('drops deaths in garbage time', () => {
    const { match, timeline, selector } = baronDeath()
    // Blue team 15k gold ahead from minute 20 → P(win) > 0.85.
    for (const f of timeline.info.frames.slice(20)) for (const id of ['1', '2', '3', '4', '5']) f.participantFrames[id].totalGold += 3000
    const a = analyzeGame(match, timeline, selector)!
    expect(a.moments).toHaveLength(0)
    expect(a.garbageDiscarded).toBeGreaterThan(0)
  })

  it('returns null when the player cannot be resolved', () => {
    const { match, timeline } = baronDeath()
    expect(analyzeGame(match, timeline, { puuids: ['nope'] })).toBeNull()
  })
})

describe('analyzeGame — absent on objective', () => {
  const dragon = (extra: any[] = [], frame?: any) => buildGame({
    minutes: 20,
    frame,
    events: [{ type: 'ELITE_MONSTER_KILL', timestamp: at(15, 30), killerId: 7, killerTeamId: 200, monsterType: 'DRAGON', position: DRAGON_PIT }, ...extra],
  })

  it('flags an enemy dragon without a ward of the player near the pit', () => {
    const { match, timeline, selector } = dragon()
    const a = analyzeGame(match, timeline, selector)!
    expect(a.moments).toHaveLength(1)
    expect(a.moments[0].trigger).toBe('absent-objective')
    expect(a.moments[0].gameTimeSec).toBe(15 * 60 + 10)
    expect(a.moments[0].facts.objective).toBe('dragon')
    expect(a.contested).toEqual([{ gameTimeSec: 930, kind: 'dragon', takenBy: 'enemy', playerWarded: false, accountable: true }])
  })

  it('is satisfied by a ward placed near the pit in the previous 90 s', () => {
    const { match, timeline, selector } = dragon(
      [{ type: 'WARD_PLACED', timestamp: at(15, 0), creatorId: 2, wardType: 'YELLOW_TRINKET' }],
      (i: number, pid: number) => (pid === 2 && (i === 15 || i === 16) ? { position: { x: 9000, y: 5000 } } : undefined),
    )
    const a = analyzeGame(match, timeline, selector)!
    expect(a.moments).toHaveLength(0)
    expect(a.contested[0].playerWarded).toBe(true)
  })

  it('accepts a cross-map trade', () => {
    const { match, timeline, selector } = dragon([{ type: 'BUILDING_KILL', timestamp: at(15, 50), teamId: 200, killerId: 1, buildingType: 'TOWER_BUILDING' }])
    expect(analyzeGame(match, timeline, selector)!.moments).toHaveLength(0)
  })

  it('leaves it to trigger 1 when the player was dead', () => {
    const { match, timeline, selector } = dragon([{ type: 'CHAMPION_KILL', timestamp: at(15, 5), victimId: 2, killerId: 7, position: { x: 9000, y: 5000 } }])
    const a = analyzeGame(match, timeline, selector)!
    expect(a.moments.map((m) => m.trigger)).toEqual(['critical-death'])
  })

  it('merges the three voidgrubs of one pack', () => {
    const grub = (s: number) => ({ type: 'ELITE_MONSTER_KILL', timestamp: at(6, s), killerId: 7, killerTeamId: 200, monsterType: 'HORDE', position: BARON_PIT })
    const { match, timeline, selector } = buildGame({ minutes: 12, events: [grub(0), grub(8), grub(15)] })
    expect(analyzeGame(match, timeline, selector)!.contested).toHaveLength(1)
  })
})

describe('analyzeGame — early deficit', () => {
  const lane = (csGap: number, extra: any[] = []) => buildGame({
    minutes: 15, me: 1,
    frame: (i, pid) => (i === 10 && pid === 1 ? { minionsKilled: 70 + csGap } : undefined),
    events: extra,
  })

  it('flags a CS deficit at 10:00 against the direct opponent', () => {
    const { match, timeline, selector } = lane(-20)
    const m = analyzeGame(match, timeline, selector)!.moments[0]
    expect(m.trigger).toBe('early-deficit')
    expect(m.gameTimeSec).toBe(600)
    expect(m.facts).toMatchObject({ csDiff10: -20, xpDiff10: 0, takedownsBefore10: 0, opponentChampion: 'Champ6' })
  })

  it('accepts kill participation as compensation', () => {
    const kills = [at(4), at(8)].map((ts) => ({ type: 'CHAMPION_KILL', timestamp: ts, victimId: 6, killerId: 2, assistingParticipantIds: [1] }))
    const { match, timeline, selector } = lane(-20, kills)
    expect(analyzeGame(match, timeline, selector)!.moments).toHaveLength(0)
  })

  it('does not apply to junglers', () => {
    const { match, timeline, selector } = buildGame({ minutes: 15, frame: (i, pid) => (i === 10 && pid === 2 ? { minionsKilled: 0 } : undefined) })
    expect(analyzeGame(match, timeline, selector)!.moments).toHaveLength(0)
  })
})

describe('pickMoments', () => {
  const m = (t: number, s: number): CriticalMoment => ({ key: `k${t}`, trigger: 'critical-death', gameTimeSec: t, severity: s, position: null, zone: null, lane: null, territory: null, winProbBefore: 0.5, winProbAfter: 0.4, facts: {} })
  it('keeps the 3 costliest, spaced, in game order', () => {
    const out = pickMoments([m(100, 0.1), m(110, 0.5), m(400, 0.3), m(800, 0.2), m(1200, 0.4)])
    expect(out.map((x) => x.gameTimeSec)).toEqual([110, 400, 1200])
  })
})

describe('deathTimerSec', () => {
  it('grows with level and late game', () => {
    expect(deathTimerSec(1, 3)).toBe(6)
    expect(deathTimerSec(18, 40)).toBeGreaterThan(deathTimerSec(18, 15))
  })
})

describe('performance', () => {
  it('analyses a 40-minute game in under 5 ms', () => {
    const events: any[] = []
    for (let s = 30; s < 40 * 60; s += 7) events.push({ type: 'WARD_PLACED', timestamp: s * 1000, creatorId: (s % 10) + 1, wardType: 'YELLOW_TRINKET' })
    for (let k = 0; k < 30; k++) events.push({ type: 'CHAMPION_KILL', timestamp: at(3 + k), victimId: (k % 10) + 1, killerId: ((k + 5) % 10) + 1, assistingParticipantIds: [], position: { x: 5000, y: 9000 } })
    const { match, timeline, selector } = buildGame({ minutes: 40, events })
    analyzeGame(match, timeline, selector) // warm-up
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) analyzeGame(match, timeline, selector)
    expect((performance.now() - t0) / 20).toBeLessThan(5)
  })
})

describe('analyzeGame — tempo hesitation (cross-map missed)', () => {
  // Blue player walking from mid toward the dragon pit while it falls at 15:30.
  const walk = (frame: (i: number, pid: number) => any, extra: any[] = []) => buildGame({
    minutes: 20, frame,
    events: [{ type: 'ELITE_MONSTER_KILL', timestamp: at(15, 30), killerId: 7, killerTeamId: 200, monsterType: 'DRAGON', position: DRAGON_PIT }, ...extra],
  })
  const late = (i: number, pid: number) => (pid === 2 ? (i === 15 ? { position: { x: 5000, y: 5000 } } : i === 16 ? { position: { x: 8500, y: 5200 } } : undefined) : undefined)

  it('flags a late move toward the pit with no cross-map gain', () => {
    const { match, timeline, selector } = walk(late)
    const m = analyzeGame(match, timeline, selector)!.moments[0]
    expect(m.trigger).toBe('absent-objective')
    expect(m.facts.pattern).toBe('tempo-hesitation')
    expect(m.facts.approachedBy).toBeGreaterThanOrEqual(1200)
    expect(m.gameTimeSec).toBe(15 * 60 + 5)
  })
  it('accepts a real cross-map (tower taken on the other side)', () => {
    const { match, timeline, selector } = walk(late, [{ type: 'BUILDING_KILL', timestamp: at(15, 20), teamId: 200, killerId: 1, buildingType: 'TOWER_BUILDING' }])
    expect(analyzeGame(match, timeline, selector)!.moments.filter((x) => x.facts.pattern === 'tempo-hesitation')).toHaveLength(0)
  })
  it('does not apply when the player was already in the pit at T-30 s', () => {
    const inPit = (i: number, pid: number) => (pid === 2 && (i === 15 || i === 16) ? { position: { x: 9600, y: 4600 } } : undefined)
    const { match, timeline, selector } = walk(inPit)
    expect(analyzeGame(match, timeline, selector)!.moments.some((x) => x.facts.pattern === 'tempo-hesitation')).toBe(false)
  })
})

describe('analyzeGame — jungle cycle', () => {
  it('flags an overchase that ends in a death in enemy ground', () => {
    const { match, timeline, selector } = buildGame({
      minutes: 10,
      frame: (i, pid) => (pid === 2 && (i === 4 || i === 5) ? { position: { x: 10500, y: 8500 } } : undefined),
      events: [{ type: 'CHAMPION_KILL', timestamp: at(4, 40), victimId: 2, killerId: 7, assistingParticipantIds: [], position: { x: 10800, y: 8800 } }],
    })
    const m = analyzeGame(match, timeline, selector)!.moments.find((x) => x.facts.pattern === 'jungle-overchase')!
    expect(m.trigger).toBe('early-deficit')
    expect(m.gameTimeSec).toBe(4 * 60 + 20)
  })
  it('flags a lost XP lead after a chase without camps or kills', () => {
    const { match, timeline, selector } = buildGame({
      minutes: 10,
      frame: (i, pid) => {
        if (pid === 2 && i === 4) return { position: { x: 10500, y: 8500 }, xp: 2100 }
        if (pid === 2 && i === 5) return { xp: 2300 }
        if (pid === 7 && i === 5) return { xp: 2600 }
        return undefined
      },
    })
    expect(analyzeGame(match, timeline, selector)!.moments.some((x) => x.facts.pattern === 'jungle-overchase')).toBe(true)
  })
  it('flags a counter-tempo clear back to the starting quadrant', () => {
    const { match, timeline, selector } = buildGame({
      minutes: 10,
      frame: (i, pid) => {
        if (pid === 2 && i === 2) return { position: { x: 7000, y: 3500 } }
        if (pid === 2 && (i === 3 || i === 4)) return { position: { x: 9000, y: 6000 } }
        if (pid === 2 && i === 5) return { position: { x: 7200, y: 3800 } }
        if (pid === 2 && i === 6) return { xp: 2400 }
        return undefined
      },
    })
    const m = analyzeGame(match, timeline, selector)!.moments.find((x) => x.facts.pattern === 'jungle-counter-tempo')!
    expect(m.facts.xpDiffJungle).toBe(-600)
    expect(m.gameTimeSec).toBe(270)
  })
  it('ignores laners', () => {
    const { match, timeline, selector } = buildGame({ minutes: 10, me: 1, frame: (i, pid) => (pid === 1 && i === 6 ? { xp: 1000 } : undefined) })
    expect(analyzeGame(match, timeline, selector)!.moments.some((x) => x.facts.pattern?.startsWith('jungle'))).toBe(false)
  })
})

describe('analyzeGame — tempo vs tower greed', () => {
  it('flags the player finishing a side-lane tower while the enemy takes the dragon', () => {
    const { match, timeline, selector } = buildGame({
      minutes: 20,
      frame: (i, pid) => (pid === 2 && (i === 15 || i === 16) ? { position: { x: 1200, y: 11500 } } : undefined),
      events: [
        { type: 'BUILDING_KILL', timestamp: at(15, 0), teamId: 200, killerId: 2, assistingParticipantIds: [], buildingType: 'TOWER_BUILDING' },
        { type: 'ELITE_MONSTER_KILL', timestamp: at(15, 30), killerId: 7, killerTeamId: 200, monsterType: 'DRAGON', position: DRAGON_PIT },
      ],
    })
    const m = analyzeGame(match, timeline, selector)!.moments.find((x) => x.facts.pattern === 'tempo-hesitation')!
    expect(m.facts.towerGreed).toBe(true)
  })
})

describe('analyzeGame — jungle passive clear', () => {
  const game = (botLead: number, xp6 = 3000) => buildGame({
    minutes: 10,
    frame: (i, pid) => {
      if (pid === 2 && i <= 4) return { position: { x: 3500, y: 7000 } }
      if (i === 3 && pid === 4) return { totalGold: 1700 + botLead }
      if (pid === 2 && i === 6) return { xp: xp6 }
      return undefined
    },
  })
  it('flags a full clear at home while bot (and mid) had priority', () => {
    const { match, timeline, selector } = game(400)
    const m = analyzeGame(match, timeline, selector)!.moments.find((x) => x.facts.pattern === 'jungle-passive-clear')!
    expect(m).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 195, facts: { botGoldLead: 400 } })
  })
  it('stays quiet without a real bot lead or when the jungler got ahead anyway', () => {
    expect(analyzeGame(...Object.values(game(100)) as [any, any, any])!.moments.some((x) => x.facts.pattern === 'jungle-passive-clear')).toBe(false)
    expect(analyzeGame(...Object.values(game(400, 3400)) as [any, any, any])!.moments.some((x) => x.facts.pattern === 'jungle-passive-clear')).toBe(false)
  })
})

describe('analyzeGame — death under allied Baron', () => {
  it('marks a critical death during the Baron powerplay', () => {
    const { match, timeline, selector } = buildGame({
      minutes: 32,
      events: [
        { type: 'ELITE_MONSTER_KILL', timestamp: at(28, 0), killerId: 2, killerTeamId: 100, monsterType: 'BARON_NASHOR', position: BARON_PIT },
        { type: 'CHAMPION_KILL', timestamp: at(29, 30), victimId: 2, killerId: 7, assistingParticipantIds: [8], position: { x: 11000, y: 9000 } },
        { type: 'BUILDING_KILL', timestamp: at(29, 50), teamId: 100, killerId: 7, buildingType: 'TOWER_BUILDING' },
      ],
    })
    const m = analyzeGame(match, timeline, selector)!.moments.find((x) => x.trigger === 'critical-death')!
    expect(m.facts.alliedBaron).toBe(true)
  })
})

describe('analyzeGame — V3 detectors', () => {
  const find = (g: ReturnType<typeof buildGame>, pattern: string) => analyzeGame(g.match, g.timeline, g.selector)!.moments.find((m) => m.facts.pattern === pattern)

  it('gank timer: laner killed with the enemy jungler at 2:40', () => {
    const g = buildGame({ minutes: 10, me: 1, events: [{ type: 'CHAMPION_KILL', timestamp: at(2, 40), victimId: 1, killerId: 7, assistingParticipantIds: [6], position: { x: 1500, y: 9000 } }] })
    expect(find(g, 'gank-timer')).toMatchObject({ trigger: 'critical-death', facts: { gankWindow: 1 } })
  })
  it('gank timer: window 2 is excused by a deep ward on an enemy camp', () => {
    const g = buildGame({
      minutes: 10, me: 1,
      frame: (i, pid) => (pid === 1 && (i === 1 || i === 2) ? { position: { x: 11000, y: 9000 } } : undefined),
      events: [
        { type: 'WARD_PLACED', timestamp: at(1, 30), creatorId: 1, wardType: 'YELLOW_TRINKET' },
        { type: 'CHAMPION_KILL', timestamp: at(3, 40), victimId: 1, killerId: 7, assistingParticipantIds: [], position: { x: 1500, y: 9000 } },
      ],
    })
    expect(find(g, 'gank-timer')).toBeUndefined()
  })
  it('fed carry dies first in a lost 3v5', () => {
    const g = buildGame({
      minutes: 30, me: 4,
      frame: (i, pid) => (i >= 24 && i <= 27 && pid <= 5 ? { totalGold: pid === 4 ? 14500 : 9000 } : undefined),
      events: [
        ...[20, 21, 22].map((m, k) => ({ type: 'CHAMPION_KILL', timestamp: at(m), victimId: 6 + k, killerId: 4, assistingParticipantIds: [] })),
        { type: 'CHAMPION_KILL', timestamp: at(25, 10), victimId: 4, killerId: 6, assistingParticipantIds: [7, 8], position: { x: 9000, y: 9000 } },
        { type: 'CHAMPION_KILL', timestamp: at(25, 20), victimId: 1, killerId: 7, assistingParticipantIds: [] },
        { type: 'CHAMPION_KILL', timestamp: at(25, 30), victimId: 2, killerId: 8, assistingParticipantIds: [] },
      ],
    })
    expect(find(g, 'fed-carry-first')).toMatchObject({ facts: { killStreak: 3, goldSharePct: 29 } })
  })
  it('front tempo: dies alone high while 3+ allies are home', () => {
    const g = buildGame({ minutes: 25, events: [{ type: 'CHAMPION_KILL', timestamp: at(20, 30), victimId: 2, killerId: 7, assistingParticipantIds: [], position: { x: 11000, y: 11000 } }] })
    expect(find(g, 'tempo-front-isolated')).toMatchObject({ trigger: 'critical-death', facts: { alliesHome: 4 } })
  })
  it('tempo line: team fights high while the player recalled late with gold', () => {
    const g = buildGame({
      minutes: 25,
      frame: (i, pid) => {
        if (pid === 2 && i === 20) return { position: { x: 9000, y: 9000 }, currentGold: 1600 }
        if (pid === 2 && i === 21) return { position: { x: 400, y: 400 } }
        if ([1, 3, 4, 5].includes(pid) && (i === 20 || i === 21)) return { position: { x: 10000, y: 9000 } }
        return undefined
      },
      events: [
        { type: 'CHAMPION_KILL', timestamp: at(20, 55), victimId: 1, killerId: 7, assistingParticipantIds: [], position: { x: 10000, y: 9000 } },
        { type: 'CHAMPION_KILL', timestamp: at(21, 5), victimId: 3, killerId: 8, assistingParticipantIds: [], position: { x: 10000, y: 9000 } },
        { type: 'CHAMPION_KILL', timestamp: at(21, 12), victimId: 4, killerId: 8, assistingParticipantIds: [], position: { x: 9800, y: 9200 } },
      ],
    })
    expect(find(g, 'tempo-late-recall')).toMatchObject({ trigger: 'absent-objective', gameTimeSec: 20 * 60 + 25, facts: { alliesHigh: 3, goldInPocket: 1600 } })
  })
  it('jungle tempo window: the enemy jungler shows far away and nothing is punished', () => {
    const g = buildGame({ minutes: 10, events: [{ type: 'CHAMPION_KILL', timestamp: at(6), victimId: 4, killerId: 7, assistingParticipantIds: [], position: { x: 12000, y: 2000 } }] })
    expect(find(g, 'jungle-window-unpunished')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 360 })
  })
  it('jungle tempo window: used by a takedown on the other side', () => {
    const g = buildGame({ minutes: 10, events: [
      { type: 'CHAMPION_KILL', timestamp: at(6), victimId: 4, killerId: 7, assistingParticipantIds: [], position: { x: 12000, y: 2000 } },
      { type: 'CHAMPION_KILL', timestamp: at(6, 30), victimId: 6, killerId: 2, assistingParticipantIds: [1] },
    ] })
    expect(find(g, 'jungle-window-unpunished')).toBeUndefined()
  })
  it('bad rotation: leaves mid for the jungle, no takedown, loses CS and XP', () => {
    const g = buildGame({
      minutes: 12, me: 3,
      frame: (i, pid) => {
        if (pid === 3 && i === 5) return { position: { x: 7400, y: 7600 } }
        if (pid === 3 && i === 6) return { position: { x: 2600, y: 9000 } }
        if (pid === 3 && i === 7) return { minionsKilled: 39, xp: 3100 }
        return undefined
      },
    })
    expect(find(g, 'bad-rotation')).toMatchObject({ gameTimeSec: 320, facts: { csLost: 10, xpLost: 400 } })
  })
})
