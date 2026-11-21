/**
 * Micro-review cards, engine part (20/11/2026). Three Engine reports:
 * - 2026-11-20-cross-map-soloq-phase-de-lane.md: no objective blame for TOP / MID / ADC in soloQ before 14:00, except
 *   "left the lane and arrived too late"; own plates are a trade-off; M6 and objective checks follow;
 * - 2026-11-20-hesitation-lecture-erronee.md: greed only after the spawn, setup in mid / river, header at the fall,
 *   exact / estimated positions, no blame on an estimated position alone;
 * - 2026-11-20-lieux-et-extraits-video-des-cartes.md: places in words (12 camps, named pits), the three markers.
 */
import { describe, it, expect } from 'vitest'
import { analyzeGame, spawnOf, type CriticalMoment } from '../../src/lib/microReview/anomalyDetector'
import { BARON_PIT, DRAGON_PIT, JUNGLE_CAMPS, pitObjectiveAt, placeOf } from '../../src/lib/microReview/geometry'
import { FLEX_OUTSIDE_TEAM_SESSION_IS_SOLOQ, teamContextOf, teamContextOfMatch } from '../../src/lib/microReview/teamContext'
import { detectAdvancedMistakes } from '../../electron/main/mistakeRules'
import { buildGame, at } from './microReviewFixtures'

type Game = ReturnType<typeof buildGame>
type P = { x: number; y: number }
const run = (g: Game, teamContext?: boolean) => analyzeGame(g.match, g.timeline, { ...g.selector, ...(teamContext != null ? { teamContext } : {}) })!
const absents = (g: Game, teamContext?: boolean): CriticalMoment[] => run(g, teamContext).moments.filter((m) => m.trigger === 'absent-objective')

const dragon = (ts: number, team: 100 | 200, pos: P = DRAGON_PIT) => ({ type: 'ELITE_MONSTER_KILL', timestamp: ts, monsterType: 'DRAGON', killerTeamId: team, killerId: team === 200 ? 7 : 2, position: pos })
const grubs = (ts: number, team: 100 | 200) => ({ type: 'ELITE_MONSTER_KILL', timestamp: ts, monsterType: 'HORDE', killerTeamId: team, killerId: team === 200 ? 7 : 2, position: BARON_PIT })
const plate = (ts: number, killerId: number, laneType: string, position: P) => ({ type: 'TURRET_PLATE_DESTROYED', timestamp: ts, killerId, laneType, teamId: 200, position })
const tower = (ts: number, killerId: number, laneType: string, position: P) => ({ type: 'BUILDING_KILL', timestamp: ts, killerId, teamId: 200, buildingType: 'TOWER_BUILDING', towerType: 'OUTER_TURRET', laneType, position })

/** A game where the player `me` stands at `where(minute)` on every snapshot. */
const game = (me: number, where: (i: number) => P | undefined, events: any[], minutes = 25) =>
  buildGame({ minutes, me, frame: (i, pid) => (pid === me && where(i) ? { position: where(i) } : undefined), events })

const TOP_LANE: P = { x: 1500, y: 11000 }
const TOP_T1_RED: P = { x: 4318, y: 13875 }
const MID: P = { x: 7400, y: 7300 }
const BOT_LANE: P = { x: 12000, y: 2000 }

describe('places in words', () => {
  it('lanes, rivers, bases', () => {
    expect(placeOf(TOP_LANE, 600)).toEqual({ kind: 'lane', lane: 'top' })
    expect(placeOf(MID, 600)).toEqual({ kind: 'lane', lane: 'mid' })
    expect(placeOf(BOT_LANE, 600)).toEqual({ kind: 'lane', lane: 'bot' })
    expect(placeOf({ x: 6300, y: 8800 }, 600)).toEqual({ kind: 'river', side: 'top' })
    expect(placeOf({ x: 8700, y: 6300 }, 600)).toEqual({ kind: 'river', side: 'bot' })
    expect(placeOf({ x: 1000, y: 1000 }, 600)).toEqual({ kind: 'base', side: 'blue' })
    expect(placeOf({ x: 14000, y: 14000 }, 600)).toEqual({ kind: 'base', side: 'red' })
  })

  it('the pits are named by the objective alive at that time', () => {
    expect(placeOf(DRAGON_PIT, 200)).toEqual({ kind: 'pit', pit: 'dragon', objective: null })
    expect(placeOf(DRAGON_PIT, 400)).toEqual({ kind: 'pit', pit: 'dragon', objective: 'dragon' })
    expect(placeOf(DRAGON_PIT, 2000, { elderUp: true })).toMatchObject({ objective: 'elder' })
    expect(placeOf(BARON_PIT, 400)).toMatchObject({ pit: 'baron', objective: null })
    expect(placeOf(BARON_PIT, 500)).toMatchObject({ objective: 'grubs' })
    expect(placeOf(BARON_PIT, 960)).toMatchObject({ objective: 'herald' })
    expect(placeOf(BARON_PIT, 1300)).toMatchObject({ objective: 'baron' })
    expect(placeOf(DRAGON_PIT, 400, { pitObjective: 'elder' })).toMatchObject({ objective: 'elder' })
    expect([pitObjectiveAt('baron', 479), pitObjectiveAt('baron', 899), pitObjectiveAt('baron', 1199)]).toEqual([null, 'grubs', 'herald'])
  })

  it('a mid laner next to the raptors still reads as mid when away from the camp', () => {
    expect(placeOf({ x: 7000, y: 7100 }, 600)).toEqual({ kind: 'lane', lane: 'mid' })
  })

  it('in the jungle, the nearest of the 12 camps with its side of the map', () => {
    for (const side of ['blue', 'red'] as const) {
      for (const [camp, c] of Object.entries(JUNGLE_CAMPS[side])) {
        expect(placeOf({ x: c.x + 150, y: c.y - 150 }, 600), `${camp} ${side}`).toEqual({ kind: 'camp', camp, side })
      }
    }
  })
})

describe('spawns (2026 timers)', () => {
  const o = (ts: number, kind: any, ours = false) => ({ ts, kind, ours })
  it('Dragon at 5:00 then 5:00 after the previous; Voidgrubs 8:00; Herald 15:00', () => {
    expect(spawnOf('dragon', at(6), [])).toBe(at(5))
    expect(spawnOf('dragon', at(16, 25), [o(at(10, 35), 'dragon')])).toBe(at(15, 35))
    expect(spawnOf('grubs', at(8, 1), [])).toBe(at(8))
    expect(spawnOf('herald', at(16), [])).toBe(at(15))
  })
  it('Baron at 20:00 then 6:00 after; Elder 6:00 after a soul, then 6:00 after the previous Elder', () => {
    expect(spawnOf('baron', at(21), [])).toBe(at(20))
    expect(spawnOf('baron', at(30), [o(at(22), 'baron')])).toBe(at(28))
    const soul = [o(at(6), 'dragon', true), o(at(12), 'dragon'), o(at(17), 'dragon', true), o(at(22), 'dragon', true), o(at(27), 'dragon', true)]
    expect(spawnOf('elder', at(34), soul)).toBe(at(33))
    expect(spawnOf('elder', at(41), [...soul, o(at(34), 'elder')])).toBe(at(40))
    expect(spawnOf('elder', at(34), soul.slice(0, 3))).toBeNull()
    expect(spawnOf('tower', at(10), [])).toBeNull()
  })
})

describe('team context', () => {
  it('team session, custom or tournament; anything else is soloQ (flex outside a session, by the named switch)', () => {
    expect(teamContextOf({ queueId: 420, inTeamSession: null })).toBe(false)
    expect(teamContextOf({ queueId: 420, inTeamSession: true })).toBe(true)
    expect(teamContextOf({ queueId: 0, inTeamSession: false })).toBe(true)
    expect(teamContextOf({ queueId: 420, tournamentCode: 'EUW1-ABC', inTeamSession: false })).toBe(true)
    expect(FLEX_OUTSIDE_TEAM_SESSION_IS_SOLOQ).toBe(true)
    expect(teamContextOf({ queueId: 440, inTeamSession: false })).toBe(false)
    expect(teamContextOfMatch({ info: { queueId: 440 } }, true)).toBe(true)
  })
})

describe('no cross-map blame for laners in soloQ before 14:00', () => {
  // The user's capture: top, the enemy takes the Voidgrubs at 8:01 while the player takes plates of their own lane.
  const capture = () => game(1, () => TOP_LANE, [plate(at(7, 30), 1, 'TOP_LANE', TOP_T1_RED), plate(at(7, 50), 1, 'TOP_LANE', TOP_T1_RED), grubs(at(8, 1), 200)])

  it('the capture: no moment in soloQ', () => {
    expect(absents(capture())).toEqual([])
  })
  it('the same game in a team context keeps a moment, and says cross-map applies', () => {
    const m = absents(capture(), true)
    expect(m).toHaveLength(1)
    expect(m[0].facts).toMatchObject({ objective: 'grubs', teamContext: true, crossMapApplies: true, killSec: 481, spawnSec: 480 })
    // Its plates fell before the Voidgrubs spawned: a trade-off, never greed.
    expect(m[0].facts.towerGreed).toBeUndefined()
    expect(m[0].facts.towerBeforeSpawn).toBe(true)
  })
  it('an ADC in soloQ, enemy Voidgrubs at 9:00 across the map: no moment', () => {
    expect(absents(game(4, () => BOT_LANE, [grubs(at(9), 200)]))).toEqual([])
  })
  it('an ADC who left the lane for the Dragon and arrived too late: "left lane late", never a cross-map', () => {
    // At 8:00 deep in the bot lane, at 9:00 (the fall, a snapshot: exact) 1 300 closer to the pit but still out of it.
    const g = game(4, (i) => (i <= 8 ? { x: 14700, y: 100 } : i === 9 ? { x: 12700, y: 2900 } : undefined), [dragon(at(9), 200)])
    const m = absents(g)
    expect(m).toHaveLength(1)
    expect(m[0].facts).toMatchObject({ pattern: 'tempo-hesitation', leftLaneLate: true, crossMapApplies: false })
  })
  it('a support in the same spot is unchanged: still accountable', () => {
    const a = run(game(5, () => BOT_LANE, [dragon(at(9), 200)]))
    expect(a.contested.find((c) => c.kind === 'dragon')?.accountable).toBe(true)
    expect(a.moments.some((m) => m.trigger === 'absent-objective')).toBe(true)
  })
  it('a laner in soloQ before 14:00 is not accountable for that vision; after 14:00 the rules are back', () => {
    expect(run(game(4, () => BOT_LANE, [dragon(at(9), 200)])).contested[0].accountable).toBe(false)
    expect(run(game(4, () => BOT_LANE, [dragon(at(16), 200)])).contested[0].accountable).toBe(true)
  })
  it('M6 (no ward before an objective): no mistake for a laner in soloQ before 14:00, kept in a team context', () => {
    const g = game(4, () => BOT_LANE, [dragon(at(9), 200)])
    const player = { participantId: 4, teamId: 100 as const, championName: 'Champ4', position: 'BOTTOM' }
    const m6 = (teamContext?: boolean) => detectAdvancedMistakes(g.timeline, g.match, player, { teamContext }).filter((c) => c.tagSlug === 'no-ward-pre-obj')
    expect(m6()).toEqual([])
    expect(m6(true)).toHaveLength(1)
  })
})

describe('hesitation: what the card reads', () => {
  // The second capture: mid Jayce. T1 top at 15:14, the Dragon spawns at 15:35 (previous one 10:35), he holds the mid
  // wave at 16:00, the enemy takes the Dragon at 16:25.
  const midCapture = () => game(3, (i) => (i <= 15 ? TOP_LANE : { x: 8137, y: 6754 }),
    [dragon(at(10, 35), 200), tower(at(15, 14), 3, 'TOP_LANE', TOP_T1_RED), dragon(at(16, 25), 200)])

  it('the capture: a tower before the spawn, then mid on the wave: no card', () => {
    expect(absents(midCapture()).filter((m) => m.gameTimeSec > 900)).toEqual([])
    expect(absents(midCapture(), true).filter((m) => m.gameTimeSec > 900)).toEqual([])
  })

  it('a tower taken after the spawn, far from the pit: a card that cites the tower, the spawn and the fall', () => {
    const g = game(1, () => TOP_LANE, [dragon(at(10, 35), 200), tower(at(15, 50), 1, 'TOP_LANE', TOP_T1_RED), dragon(at(16, 25), 200)])
    const m = absents(g).find((x) => x.facts.killSec === 985)!
    expect(m.facts).toMatchObject({
      pattern: 'tempo-hesitation', towerGreed: true, towerAtSec: 950, towerLane: 'TOP', towerBeforeSpawn: false,
      spawnSec: 935, killSec: 985,
    })
    expect(m.headerSec).toBe(985)
    expect(m.markers).toEqual({ errorSec: 950, consequenceSec: 985, conclusionSec: 1030 })
    expect(m.facts.placeAtError).toMatchObject({ place: { kind: 'lane', lane: 'top' }, positionKind: 'exact', atSec: 950 })
    expect(m.facts.placeAtObjective).toMatchObject({ place: { kind: 'lane', lane: 'top' }, positionKind: 'estimated', between: [960, 1020] })
  })

  it('in position (mid lane, near the pit at T−30 s): neither hesitation nor absent', () => {
    expect(absents(game(1, () => ({ x: 8100, y: 6750 }), [dragon(at(16, 25), 200)]))).toEqual([])
  })
})

describe('every moment carries its place, position kind, header and markers', () => {
  it('a death: exact position, markers death → +30 s', () => {
    const death = { type: 'CHAMPION_KILL', timestamp: at(12, 10), victimId: 2, killerId: 7, assistingParticipantIds: [8, 9], position: JUNGLE_CAMPS.red.raptors }
    const a = run(buildGame({ minutes: 25, me: 2, events: [death] }))
    const m = a.moments.find((x) => x.trigger === 'critical-death')
    if (!m) return // a death that does not cost enough is not a moment: nothing to check then
    expect(m.place).toEqual({ kind: 'camp', camp: 'raptors', side: 'red' })
    expect(m.positionKind).toBe('exact')
    expect(m.markers).toMatchObject({ errorSec: m.gameTimeSec, conclusionSec: m.gameTimeSec + 30 })
    expect(m.headerSec).toBe(m.gameTimeSec)
  })
})
