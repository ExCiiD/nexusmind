/**
 * Mathematical validation of the AnomalyDetector — part 2: the patterns.
 * Each rule is tested just inside and just outside every threshold it names
 * (seconds, map units, gold, CS, XP), for the blue side and, where the map
 * matters, mirrored for the red side. Part 1 is anomalyDetectorMath.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { analyzeGame, type MomentFacts, type MomentPattern } from '../../src/lib/microReview/anomalyDetector'
import { BARON_PIT, DRAGON_PIT, tempoLineD, zoneOf } from '../../src/lib/microReview/geometry'
import { isControlMage } from '../../src/lib/microReview/championClasses'
import { buildGame, at } from './microReviewFixtures'

type Game = ReturnType<typeof buildGame>
type P = { x: number; y: number }
const run = (g: Game) => analyzeGame(g.match, g.timeline, g.selector)!
const withPattern = (g: Game, pattern: MomentPattern) => run(g).moments.find((m) => m.facts.pattern === pattern)
const patterns = (g: Game) => run(g).moments.map((m) => m.facts.pattern)
const kill = (ts: number, victimId: number, killerId: number, assists: number[] = [], position?: P) =>
  ({ type: 'CHAMPION_KILL', timestamp: ts, victimId, killerId, assistingParticipantIds: assists, ...(position ? { position } : {}) })
const epic = (ts: number, team: 100 | 200, monsterType = 'DRAGON', position: P = DRAGON_PIT) =>
  ({ type: 'ELITE_MONSTER_KILL', timestamp: ts, killerId: team === 200 ? 9 : 4, killerTeamId: team, monsterType, position })
const tower = (ts: number, owner: 100 | 200, killerId: number, assists: number[] = []) =>
  ({ type: 'BUILDING_KILL', timestamp: ts, teamId: owner, killerId, assistingParticipantIds: assists, buildingType: 'TOWER_BUILDING' })
const ward = (ts: number, creatorId: number) => ({ type: 'WARD_PLACED', timestamp: ts, creatorId, wardType: 'YELLOW_TRINKET' })

describe('pattern — tempo hesitation / missed cross-map', () => {
  const T = at(16) // on a frame boundary: the position at T is the 16:00 snapshot
  // The player walks along y = 4414 toward the dragon pit, `step` units per minute, and is 4000 units away when it falls.
  const walk = (step: number, extra: any[] = []) => buildGame({ minutes: 20, me: 1,
    frame: (i, pid) => (pid === 1 ? { position: { x: i >= 16 ? 5866 : 5866 - step, y: 4414 } } : undefined),
    events: [epic(T, 200), ...extra] })
  const still = (pos: P, extra: any[] = []) => buildGame({ minutes: 20, me: 1, frame: (_i, pid) => (pid === 1 ? { position: pos } : undefined), events: [epic(T, 200), ...extra] })
  const plate = (ts: number) => ({ type: 'TURRET_PLATE_DESTROYED', timestamp: ts, killerId: 1, laneType: 'TOP_LANE' })

  it('moving 1200+ units toward the pit in the last 25 s = arriving late', () => {
    // step·25/60 units closer between T−25 s and T: 2916 → 1215 (flagged), 2850 → 1187.5 (not).
    const late = withPattern(walk(2916), 'tempo-hesitation')!
    expect(late).toMatchObject({ trigger: 'absent-objective', gameTimeSec: 16 * 60 - 25, facts: { objective: 'dragon', approachedBy: 1215, playerDistance: 4000, nearestPit: 'dragon' } })
    const slow = run(walk(2850)).moments
    expect(slow.map((m) => m.facts.pattern)).toEqual([undefined])
    expect(slow[0].trigger).toBe('absent-objective') // still an "absent" moment, just not a hesitation
  })
  it('staying in the river, off the lanes and outside the objective zone, also counts', () => {
    // Top river: x+y = 15000, 3800 units off the mid diagonal, 6500 units from the dragon pit.
    expect(withPattern(still({ x: 5600, y: 9400 }), 'tempo-hesitation')!.facts.approachedBy).toBe(0)
    // The same standstill on the player's own side is a plain "absent".
    expect(patterns(still({ x: 6000, y: 5000 }))).toEqual([undefined])
    // A mid laner on the lane is in the river band too, but farming a wave is not hesitating in neutral ground.
    expect(patterns(still({ x: 7000, y: 8000 }))).toEqual([undefined])
    expect(patterns(still({ x: 7500, y: 7500 }))).toEqual([undefined])
  })
  it('"staying" means the whole 25 s: crossing the river on the way elsewhere is not', () => {
    // In the river at T, but still in the own jungle 25 s earlier (and not walking toward the pit).
    const crossing = buildGame({ minutes: 20, me: 1,
      frame: (i, pid) => (pid === 1 ? { position: i >= 16 ? { x: 5600, y: 9400 } : { x: 2600, y: 7000 } } : undefined), events: [epic(T, 200)] })
    expect(patterns(crossing)).toEqual([undefined])
  })
  it('needs the player alive for the whole decision window (T−40 s → T)', () => {
    // Level 18 dying at 36:29: 52.5 s × 1.1665 = 61.2 s of respawn → back at 37:30, inside the last 40 s before the Baron at 38:00
    // (the death itself is 91 s old: too old to be linked to the Baron by trigger 1).
    const lateDeath = (deathMs: number) => buildGame({ minutes: 40, me: 1,
      frame: (_i, pid) => (pid === 1 ? { position: { x: 9200, y: 5900 } } : undefined),
      events: [kill(deathMs, 1, 8, [], { x: 9200, y: 5900 }), epic(at(38), 200, 'BARON_NASHOR', BARON_PIT)] })
    expect(patterns(lateDeath(at(36, 29)))).toEqual([undefined]) // a plain "absent"
    // Dead at 35:30, back at 36:31: seen standing in the river at 37:00 and 38:00 → a hesitation again.
    expect(patterns(lateDeath(at(35, 30)))).toEqual(['tempo-hesitation'])
  })
  it('records that the player did ward the pit (the miss is then a tempo one, not a vision one)', () => {
    // Walking in late along y = 4414: a ward dropped 5 s before T is placed 4243 units from the pit — not "near" (3500).
    const late = withPattern(walk(2916, [ward(T - 5_000, 1)]), 'tempo-hesitation')!
    expect(late.facts.playerWarded).toBeUndefined()
    // Same walk ending 3000 units from the pit: the ward dropped 1 s before T lands 3049 units away.
    const close = buildGame({ minutes: 20, me: 1,
      frame: (i, pid) => (pid === 1 ? { position: { x: i >= 16 ? DRAGON_PIT.x - 3000 : DRAGON_PIT.x - 3000 - 2916, y: 4414 } } : undefined),
      events: [epic(T, 200), ward(T - 1_000, 1)] })
    expect(withPattern(close, 'tempo-hesitation')!.facts).toMatchObject({ playerWarded: true, playerDistance: 3000 })
  })
  it('only when the player was NOT in the objective zone (2800) at T−30 s', () => {
    // Tower greed makes the other conditions true; only the distance at T−30 s varies.
    const greedy = (x: number) => patterns(still({ x, y: DRAGON_PIT.y }, [plate(T - 30_000)]))
    expect(greedy(DRAGON_PIT.x - 2801)).toEqual(['tempo-hesitation'])
    expect(greedy(DRAGON_PIT.x - 2800)).toEqual([undefined])
  })
  it('a team cross-map between T−40 s and T+15 s (inclusive) is a real trade', () => {
    const herald = (ts: number) => epic(ts, 100, 'RIFTHERALD', BARON_PIT)
    expect(run(walk(2916, [herald(T - 40_000)])).moments).toHaveLength(0)
    expect(patterns(walk(2916, [herald(T - 40_001)]))).toEqual(['tempo-hesitation'])
    expect(run(walk(2916, [herald(T + 15_000)])).moments).toHaveLength(0)
    expect(patterns(walk(2916, [herald(T + 15_001)]))).toEqual(['tempo-hesitation'])
    // A tower taken by team-mates without the player is a cross-map too.
    expect(run(walk(2916, [tower(T - 10_000, 200, 3)])).moments).toHaveLength(0)
  })
  it('the player\'s own side-lane tower or plate in the 75 s before is greed, not a cross-map', () => {
    const greed = withPattern(still({ x: 3000, y: 3000 }, [plate(T - 75_000)]), 'tempo-hesitation')!
    expect(greed.facts).toMatchObject({ towerGreed: true, approachedBy: 0 })
    expect(patterns(still({ x: 3000, y: 3000 }, [plate(T - 75_001)]))).toEqual([undefined])
    expect(withPattern(still({ x: 3000, y: 3000 }, [tower(T - 20_000, 200, 1)]), 'tempo-hesitation')!.facts.towerGreed).toBe(true)
  })
  it('applies to dragon, Baron and grubs — not to the Herald', () => {
    // Bot river, off the lanes, 6200 units from the Baron pit.
    const at16 = (monster: string) => patterns(buildGame({ minutes: 20, me: 1, frame: (_i, pid) => (pid === 1 ? { position: { x: 9200, y: 5900 } } : undefined), events: [epic(T, 200, monster, BARON_PIT)] }))
    expect(at16('BARON_NASHOR')).toEqual(['tempo-hesitation'])
    expect(at16('HORDE')).toEqual(['tempo-hesitation'])
    expect(at16('RIFTHERALD')).toEqual([undefined])
  })
})

describe('pattern — jungle overchase (2:30–8:00)', () => {
  const ENEMY_SIDE = { x: 10500, y: 8500 }
  const chase = (deathMs: number, o: { pos?: P; extra?: any[]; frame?: (i: number, pid: number) => any } = {}) => buildGame({ minutes: 12, me: 2,
    frame: o.frame ?? ((_i, pid) => (pid === 2 ? { position: o.pos ?? ENEMY_SIDE } : undefined)),
    events: [kill(deathMs, 2, 8, [], o.pos ?? ENEMY_SIDE), ...(o.extra ?? [])] })

  it('window 150 s – 480 s, inclusive, anchored 20 s before the death', () => {
    expect(patterns(chase(149_999))).toEqual([])
    expect(withPattern(chase(150_000), 'jungle-overchase')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 130 })
    expect(withPattern(chase(480_000), 'jungle-overchase')!.gameTimeSec).toBe(460)
    expect(patterns(chase(480_001))).toEqual([])
  })
  it('needs 20 s on the enemy side or in the river, without a takedown or a camp', () => {
    expect(patterns(chase(300_000, { pos: { x: 3500, y: 7000 } }))).toEqual([]) // own jungle
    expect(patterns(chase(300_000, { extra: [kill(295_000, 6, 2)] }))).toEqual([]) // got a kill during the chase
    const farmed = (i: number, pid: number) => (pid === 2 ? { position: ENEMY_SIDE, jungleMinionsKilled: i * 4 } : undefined)
    // Took camps: not a chase. Dead in the enemy jungle after a camp, it is the V7 invade death instead (microReviewV7.test.ts).
    expect(patterns(chase(300_000, { frame: farmed }))).toEqual(['jungle-invade-death'])
    // On the enemy side for less than 20 s: still home at 4:00, dead at 4:10.
    const justCrossed = (i: number, pid: number) => (pid === 2 ? { position: i <= 4 ? { x: 3500, y: 7000 } : ENEMY_SIDE } : undefined)
    expect(patterns(chase(250_000, { frame: justCrossed }))).toEqual([])
  })
  it('or the XP lead over the enemy jungler lost on the next frame', () => {
    const lead = (here: number, next: number) => buildGame({ minutes: 12, me: 2, frame: (i, pid) => {
      if (pid !== 2) return undefined
      if (i === 4) return { position: ENEMY_SIDE, xp: 2000 + here }
      if (i === 5) return { xp: 2500 + next }
      return undefined
    } })
    expect(withPattern(lead(100, -50), 'jungle-overchase')).toMatchObject({ gameTimeSec: 240, facts: { xpDiffJungle: -50 } })
    expect(patterns(lead(0, -50))).toEqual([]) // no lead to lose
    expect(patterns(lead(100, 0))).toEqual([]) // lead not lost
  })
  it('the chase is read on the way to the death, not toward the fountain where the next snapshot finds the player', () => {
    // 4:00 at (10500, 8500), dead at 4:40 at (10800, 8800), respawned in the fountain for the 5:00 snapshot.
    const frame = (i: number, pid: number) => (pid === 2 ? { position: i === 4 ? { x: 10500, y: 8500 } : { x: 400, y: 450 } } : undefined)
    const m = withPattern(chase(at(4, 40), { pos: { x: 10800, y: 8800 }, frame }), 'jungle-overchase')!
    // 20 s before the death the player is halfway between the 4:00 snapshot and the place of death.
    expect(m).toMatchObject({ gameTimeSec: 260, position: { x: 10650, y: 8650 }, territory: 'enemy' })
  })
  it('20 s away from home: every 5 s of the chase is across the river or in the enemy jungle', () => {
    // Home (3500, 7000) at 4:00; death at 4:30 at (9500, 9000). The straight walk crosses x+y = 14500 two thirds of the way,
    // i.e. at 4:20: the points at 4:10 and 4:15 are still on the player's side.
    const frame = (i: number, pid: number) => (pid === 2 ? { position: { x: 3500, y: 7000 } } : undefined)
    expect(patterns(chase(at(4, 30), { pos: { x: 9500, y: 9000 }, frame }))).toEqual([])
    // Starting from the river bank (6500, 8200), the whole 20 s are away.
    const fromBank = (i: number, pid: number) => (pid === 2 ? { position: { x: 6500, y: 8200 } } : undefined)
    expect(patterns(chase(at(4, 30), { pos: { x: 9500, y: 9000 }, frame: fromBank }))).toEqual(['jungle-overchase'])
  })
  it('the XP variant stays inside 2:30–8:00: frame pairs 3:00→4:00 … 7:00→8:00', () => {
    const lead = (k: number, extra: any[] = []) => buildGame({ minutes: 12, me: 2, events: extra, frame: (i, pid) => {
      if (pid !== 2) return undefined
      if (i === k) return { position: ENEMY_SIDE, xp: k * 500 + 100 }
      if (i === k + 1) return { xp: (k + 1) * 500 - 50 }
      return undefined
    } })
    expect(patterns(lead(2))).toEqual([])
    expect(withPattern(lead(3), 'jungle-overchase')!.gameTimeSec).toBe(180)
    expect(withPattern(lead(7), 'jungle-overchase')!.gameTimeSec).toBe(420)
    expect(patterns(lead(8))).toEqual([])
    // A death during that minute explains the lost lead: it is case A's business (here on the player's own side → nothing).
    expect(patterns(lead(4, [kill(at(4, 30), 2, 8, [], { x: 3500, y: 7000 })]))).toEqual([])
  })
  it('junglers only', () => {
    const laner = buildGame({ minutes: 12, me: 1, frame: (_i, pid) => (pid === 1 ? { position: ENEMY_SIDE } : undefined), events: [kill(300_000, 1, 8, [], ENEMY_SIDE)] })
    expect(patterns(laner)).toEqual([])
  })
})

describe('pattern — jungle counter-tempo and passive clear', () => {
  const counter = (xp6: number, o: { back?: P; river?: P } = {}) => buildGame({ minutes: 10, me: 2, frame: (i, pid) => {
    if (pid !== 2) return undefined
    if (i === 2) return { position: { x: 7000, y: 3500 } }
    if (i === 3 || i === 4) return { position: o.river ?? { x: 9000, y: 6000 } }
    if (i === 5) return { position: o.back ?? { x: 7200, y: 3800 } }
    if (i === 6) return { xp: xp6 }
    return undefined
  } })
  it('counter-tempo: more than 150 XP behind the enemy jungler at 6:00', () => {
    expect(withPattern(counter(3000 - 151), 'jungle-counter-tempo')).toMatchObject({ gameTimeSec: 270, facts: { xpDiffJungle: -151 } })
    expect(patterns(counter(3000 - 150))).toEqual([])
  })
  it('counter-tempo: needs the river play and the return to the SAME quadrant', () => {
    expect(patterns(counter(2000, { river: { x: 7100, y: 3600 } }))).toEqual([]) // never left the jungle
    expect(patterns(counter(2000, { back: { x: 3800, y: 7200 } }))).toEqual([]) // went on to the other quadrant
  })

  const passive = (botLead: number, o: { xp6?: number; midDelta?: number; extra?: any[]; leftAt4?: boolean } = {}) => buildGame({ minutes: 10, me: 2, events: o.extra ?? [], frame: (i, pid) => {
    if (pid === 2 && i <= 4) return { position: o.leftAt4 && i === 4 ? { x: 9000, y: 9000 } : { x: 3500, y: 7000 } }
    if (pid === 2 && i === 6) return { xp: o.xp6 ?? 3000 }
    if (i === 3 && pid === 4) return { totalGold: 1700 + botLead }
    if (i === 3 && pid === 3) return { totalGold: 1700 + (o.midDelta ?? 0) }
    return undefined
  } })
  it('passive clear: bot duo at least 250 g ahead at 3:00', () => {
    expect(withPattern(passive(250), 'jungle-passive-clear')).toMatchObject({ gameTimeSec: 195, facts: { botGoldLead: 250, xpDiffJungle: 0 } })
    expect(patterns(passive(249))).toEqual([])
  })
  it('passive clear: not when mid is behind, the jungler is ahead, got a takedown or left their side', () => {
    expect(patterns(passive(400, { midDelta: -1 }))).toEqual([])
    expect(patterns(passive(400, { xp6: 3001 }))).toEqual([])
    expect(patterns(passive(400, { extra: [kill(at(3, 30), 6, 1, [2])] }))).toEqual([])
    expect(patterns(passive(400, { leftAt4: true }))).toEqual([])
  })
})

describe('pattern — gank on a predictable jungle timer (2:30 and 4:10)', () => {
  const LANE = { x: 1500, y: 9000 }
  const ENEMY_JUNGLE = { x: 11000, y: 9000 }
  const gank = (ms: number, o: { me?: number; killer?: number; assists?: number[]; extra?: any[]; frame?: (i: number, pid: number) => any } = {}) =>
    buildGame({ minutes: 8, me: o.me ?? 1, frame: o.frame, events: [kill(ms, o.me ?? 1, o.killer ?? 7, o.assists ?? [], LANE), ...(o.extra ?? [])] })
  const facts = (g: Game): MomentFacts | undefined => withPattern(g, 'gank-timer')?.facts

  it('window 1 — 2:25 to 3:00 (145 s – 180 s), inclusive: the 3-camp gank', () => {
    expect(facts(gank(144_999))).toBeUndefined()
    expect(facts(gank(145_000))).toMatchObject({ gankWindow: 1 })
    expect(facts(gank(150_000))).toMatchObject({ gankWindow: 1 })
    expect(facts(gank(180_000))).toMatchObject({ gankWindow: 1 })
    expect(facts(gank(180_001))).toBeUndefined()
  })
  it('window 2 — 3:15 to 4:25 (195 s – 265 s), inclusive: end of the first clear', () => {
    expect(facts(gank(194_999))).toBeUndefined()
    expect(facts(gank(195_000))).toMatchObject({ gankWindow: 2, deepWard: false, wardedRecently: false })
    expect(facts(gank(250_000))).toMatchObject({ gankWindow: 2 })
    expect(facts(gank(265_000))).toMatchObject({ gankWindow: 2 })
    expect(facts(gank(265_001))).toBeUndefined()
  })
  it('between the windows, and outside them, the death is an ordinary one', () => {
    for (const ms of [120_000, 187_000, 300_000]) expect(run(gank(ms)).moments).toHaveLength(0)
  })
  it('the enemy jungler must be the killer or an assister', () => {
    expect(facts(gank(150_000, { killer: 6, assists: [7] }))).toMatchObject({ gankWindow: 1 })
    expect(facts(gank(150_000, { killer: 6, assists: [8] }))).toBeUndefined()
    expect(facts(gank(150_000, { killer: 0, assists: [7] }))).toMatchObject({ gankWindow: 1 }) // executed under tower with the jungler's help
  })
  it('laners only (top, mid, bot, support) — a jungler dying there is not a gank', () => {
    for (const me of [1, 3, 4, 5]) expect(facts(gank(150_000, { me }))).toMatchObject({ gankWindow: 1 })
    expect(run(gank(150_000, { me: 2 })).moments).toHaveLength(0)
  })
  it('window 2 is excused by a deep ward placed in the previous 150 s', () => {
    // The player was in the enemy jungle around 1:00–2:00, so a ward placed then is a deep ward.
    const deep = (i: number, pid: number) => (pid === 1 && (i === 1 || i === 2) ? { position: ENEMY_JUNGLE } : undefined)
    expect(zoneOf(ENEMY_JUNGLE, 100)).toBe('enemy-jungle')
    expect(run(gank(240_000, { frame: deep, extra: [ward(240_000 - 150_000, 1)] })).moments).toHaveLength(0)
    // 1 ms older: the ward has expired.
    expect(facts(gank(240_000, { frame: deep, extra: [ward(240_000 - 150_001, 1)] }))).toMatchObject({ gankWindow: 2, deepWard: false, wardedRecently: false })
    // A recent ward on the player's own side is not a deep ward.
    expect(facts(gank(240_000, { extra: [ward(200_000, 1)] }))).toMatchObject({ gankWindow: 2, deepWard: false, wardedRecently: true })
  })
  it('window 1 is flagged even with a deep ward (the 2:30 gank is the universal alert)', () => {
    const deep = (i: number, pid: number) => (pid === 1 && i <= 1 ? { position: ENEMY_JUNGLE } : undefined)
    expect(facts(gank(150_000, { frame: deep, extra: [ward(60_000, 1)] }))).toMatchObject({ gankWindow: 1, deepWard: true, wardedRecently: true })
  })
  it('mirrored for a red-side laner (enemy jungler = participant 2)', () => {
    const g = buildGame({ minutes: 8, me: 6, events: [kill(150_000, 6, 2, [], { x: 13500, y: 6000 })] })
    expect(withPattern(g, 'gank-timer')).toMatchObject({ trigger: 'critical-death', gameTimeSec: 150, facts: { gankWindow: 1 } })
  })
})

describe('pattern — tempo lines (after 15:00)', () => {
  describe('B — alone on the front tempo line', () => {
    const front = (ms: number, pos: P, o: { me?: number; killer?: number; frame?: (i: number, pid: number) => any } = {}) =>
      buildGame({ minutes: 25, me: o.me ?? 1, frame: o.frame, events: [kill(ms, o.me ?? 1, o.killer ?? 8, [], pos)] })

    it('D > 0.65 at the death, strictly', () => {
      expect(tempoLineD({ x: 9750, y: 9750 }, 100)).toBe(0.65)
      expect(patterns(front(at(20), { x: 9750, y: 9750 }))).toEqual([])
      expect(withPattern(front(at(20), { x: 9750, y: 9751 }), 'tempo-front-isolated')).toMatchObject({ trigger: 'critical-death', facts: { alliesHome: 4, alliesNearby: 0 } })
    })
    it('strictly after 15:00', () => {
      expect(patterns(front(900_000, { x: 9750, y: 9751 }))).toEqual([])
      expect(patterns(front(900_001, { x: 9750, y: 9751 }))).toEqual(['tempo-front-isolated'])
    })
    it('3+ allies with D < 0.30, strictly', () => {
      // Two allies exactly on D = 0.30 → only 2 are "home" → not flagged.
      const twoOnTheLine = (y: number) => (_i: number, pid: number) => (pid === 2 || pid === 3 ? { position: { x: 4500, y } } : undefined)
      expect(tempoLineD({ x: 4500, y: 4500 }, 100)).toBe(0.3)
      expect(patterns(front(at(20), { x: 9750, y: 9751 }, { frame: twoOnTheLine(4500) }))).toEqual([])
      expect(patterns(front(at(20), { x: 9750, y: 9751 }, { frame: twoOnTheLine(4499) }))).toEqual(['tempo-front-isolated'])
    })
    it('"alone": no ally within 2500 units', () => {
      const escort = (x: number) => (_i: number, pid: number) => (pid === 3 ? { position: { x, y: 9751 } } : undefined)
      expect(patterns(front(at(20), { x: 9750, y: 9751 }, { frame: escort(9750 + 2500) }))).toEqual([])
      expect(patterns(front(at(20), { x: 9750, y: 9751 }, { frame: escort(9750 + 2501) }))).toEqual(['tempo-front-isolated'])
    })
    it('only living allies are "home": a team-mate who just fell at the front is not', () => {
      // Allies fall at the front 20 s before the player (their snapshots still say (3000, 3000)).
      const withCorpses = (dead: number[]) => buildGame({ minutes: 25, me: 1, events: [
        ...dead.map((id, k) => kill(at(19, 40) + k * 1000, id, 9, [], { x: 9900, y: 9900 })),
        kill(at(20), 1, 8, [], { x: 9750, y: 9751 })] })
      expect(withPattern(withCorpses([3]), 'tempo-front-isolated')!.facts).toMatchObject({ alliesHome: 3, alliesNearby: 0 })
      expect(patterns(withCorpses([3, 4]))).toEqual([]) // 2 alive at home: not the pattern, and no other consequence
    })
    it('mirrored for the red side: D = 1 − (x+y)/30000', () => {
      expect(tempoLineD({ x: 5250, y: 5250 }, 200)).toBeCloseTo(0.65, 12)
      expect(patterns(front(at(20), { x: 5250, y: 5251 }, { me: 6, killer: 3 }))).toEqual([])
      expect(patterns(front(at(20), { x: 5250, y: 5249 }, { me: 6, killer: 3 }))).toEqual(['tempo-front-isolated'])
    })
  })

  describe('A — the forward group dies while the player recalled late', () => {
    // The player is out on the map at M−1:00 with `gold`, and at `base` at M:00, when 3 allies die forward.
    const recall = (o: { minute?: number; offset?: number; gold?: number; base?: P; out?: P; deaths?: number[]; deathPos?: P; extra?: any[] } = {}) => {
      const M = o.minute ?? 21
      const ts = M * 60_000 + (o.offset ?? 0)
      return buildGame({ minutes: 26, me: 1,
        frame: (i, pid) => {
          if (pid !== 1) return undefined
          if (i === M - 1) return { position: o.out ?? { x: 9000, y: 9000 }, currentGold: o.gold ?? 1501 }
          if (i === M) return { position: o.base ?? { x: 400, y: 400 } }
          return undefined
        },
        events: [...(o.deaths ?? [0, 5_000, 10_000]).map((d, k) => kill(ts + d, 3 + k, 8, [], o.deathPos ?? { x: 10000, y: 9000 })), ...(o.extra ?? [])] })
    }
    it('flags it 30 s before the fight, with the facts', () => {
      expect(withPattern(recall(), 'tempo-late-recall')).toMatchObject({ trigger: 'absent-objective', gameTimeSec: 21 * 60 - 30, facts: { alliesHigh: 3, goldInPocket: 1501 } })
    })
    it('more than 1500 gold in pocket 30 s earlier, strictly', () => {
      expect(patterns(recall({ gold: 1500 }))).toEqual([])
      expect(patterns(recall({ gold: 1501 }))).toEqual(['tempo-late-recall'])
    })
    it('3+ allies dying forward, within 30 s', () => {
      expect(patterns(recall({ deaths: [0, 5_000] }))).toEqual([])
      expect(patterns(recall({ deaths: [0, 5_000, 30_000] }))).toEqual(['tempo-late-recall'])
      expect(patterns(recall({ deaths: [0, 5_000, 30_001] }))).toEqual([])
    })
    it('forward = D > 0.55 at the death position, strictly', () => {
      expect(tempoLineD({ x: 8250, y: 8250 }, 100)).toBe(0.55)
      expect(patterns(recall({ deathPos: { x: 8250, y: 8250 } }))).toEqual([])
      expect(patterns(recall({ deathPos: { x: 8250, y: 8251 } }))).toEqual(['tempo-late-recall'])
    })
    it('the player is in base at the fight: D < 0.15, strictly', () => {
      expect(tempoLineD({ x: 2250, y: 2250 }, 100)).toBe(0.15)
      expect(patterns(recall({ base: { x: 2250, y: 2250 } }))).toEqual([])
      expect(patterns(recall({ base: { x: 2250, y: 2249 } }))).toEqual(['tempo-late-recall'])
      expect(patterns(recall({ base: { x: 9000, y: 9000 } }))).toEqual([]) // still out with the team
    })
    it('…and was still out 30 s earlier (a recall, not a long stay in base)', () => {
      expect(patterns(recall({ out: { x: 400, y: 400 } }))).toEqual([])
    })
    it('in base because of a death is not a late recall', () => {
      // Dead at 20:02 (level 11: back at 20:38.6), fight at 21:10: 30 s before, the player had just respawned.
      const respawned = recall({ offset: 10_000, extra: [kill(at(20, 2), 1, 9, [], { x: 9000, y: 9000 })] })
      expect(patterns(respawned)).toEqual([])
      // Dead two minutes earlier, long back on the map: the recall is the player's choice again.
      expect(patterns(recall({ extra: [kill(at(19), 1, 9, [], { x: 9000, y: 9000 })] }))).toEqual(['tempo-late-recall'])
    })
    it('strictly after 15:00, and not when the player died around the fight', () => {
      expect(patterns(recall({ minute: 15 }))).toEqual([])
      expect(patterns(recall({ minute: 15, offset: 1 }))).toEqual(['tempo-late-recall'])
      expect(withPattern(recall({ extra: [kill(at(21) - 30_000, 1, 9, [], { x: 9000, y: 9000 })] }), 'tempo-late-recall')).toBeUndefined()
    })
  })
})

describe('pattern — the fed carry dies first', () => {
  const DEATH = at(25, 10)
  const base = (i: number) => 500 + 400 * i
  const carry = (o: { delta?: number; richAlly?: number; before?: any[]; assists?: number[]; after?: any[]; frame?: (i: number, pid: number) => any } = {}) => buildGame({ minutes: 30, me: 4,
    frame: (i, pid) => {
      if (i >= 24 && pid === 4) return { totalGold: base(i) + (o.delta ?? 100) }
      if (i >= 24 && pid === 3 && o.richAlly) return { totalGold: base(i) + o.richAlly }
      return o.frame?.(i, pid)
    },
    events: [...(o.before ?? [kill(at(20), 6, 4), kill(at(21), 7, 4)]), kill(DEATH, 4, 6, o.assists ?? [7, 8], { x: 9000, y: 9000 }), ...(o.after ?? [])] })
  const pattern = (g: Game) => run(g).moments.find((m) => m.gameTimeSec === 25 * 60 + 10)?.facts.pattern
  const fourAssists = [kill(at(21), 7, 3, [4]), kill(at(21, 30), 8, 3, [4]), kill(at(22), 9, 3, [4]), kill(at(22, 30), 10, 3, [4])]

  it('bounty branch: a 2-kill streak (450 g) with the highest gold of the team', () => {
    const m = withPattern(carry(), 'fed-carry-first')!
    expect(m.facts).toMatchObject({ killStreak: 2, bountyGold: 450, goldSharePct: 20, enemiesInvolved: 3 })
    expect(pattern(carry({ before: [kill(at(20), 6, 4)] }))).toBeUndefined() // 1 kill → 300 g, KDA 1
  })
  it('KDA branch: KDA > 4.0 AND more than 25 % of the team\'s gold, both strict', () => {
    const kda5 = [kill(at(20), 6, 4), ...fourAssists] // 1 kill + 4 assists, no death → 5.0
    // delta 3500 → 14000 / 56000 = exactly 25 %.
    expect(pattern(carry({ before: kda5, delta: 3500 }))).toBeUndefined()
    expect(withPattern(carry({ before: kda5, delta: 3501 }), 'fed-carry-first')!.facts).toMatchObject({ killStreak: 1, bountyGold: 300, goldSharePct: 25 })
    const kda4 = [kill(at(20), 6, 4), ...fourAssists.slice(0, 3)] // 1 + 3 → exactly 4.0
    expect(pattern(carry({ before: kda4, delta: 5000 }))).toBeUndefined()
  })
  it('must hold the highest gold of the team', () => {
    expect(pattern(carry({ richAlly: 200 }))).toBeUndefined()
    expect(pattern(carry({ richAlly: 100 }))).toBe('fed-carry-first') // a tie still counts
  })
  it('first death of the fight: no kill at all in the 10 s before', () => {
    const streak = [kill(at(20), 6, 4), kill(at(21), 7, 4)]
    expect(pattern(carry({ before: [...streak, kill(DEATH - 10_000, 3, 9)] }))).toBeUndefined()
    expect(pattern(carry({ before: [...streak, kill(DEATH - 10_001, 3, 9)] }))).toBe('fed-carry-first')
    expect(pattern(carry({ before: [...streak, kill(DEATH - 5_000, 9, 3)] }))).toBeUndefined() // an enemy fell first
  })
  it('3+ enemies present: credited on the kill, or within 2500 units', () => {
    expect(pattern(carry({ assists: [7] }))).toBeUndefined()
    const lurker = (x: number) => (i: number, pid: number) => (pid === 9 && i >= 25 ? { position: { x, y: 9000 } } : undefined)
    expect(pattern(carry({ assists: [7], frame: lurker(9000 + 2500) }))).toBe('fed-carry-first')
    expect(pattern(carry({ assists: [7], frame: lurker(9000 + 2501) }))).toBeUndefined()
  })
  it('the fight is lost: more deaths than the enemy in the next 60 s, or an objective lost', () => {
    const traded = [kill(DEATH + 30_000, 6, 3)] // 1 for 1
    expect(pattern(carry({ after: traded }))).toBeUndefined()
    expect(pattern(carry({ after: [...traded, kill(DEATH + 40_000, 5, 7)] }))).toBe('fed-carry-first') // 2 for 1
    expect(pattern(carry({ after: [...traded, tower(DEATH + 60_000, 100, 7)] }))).toBe('fed-carry-first')
    expect(pattern(carry({ after: [...traded, tower(DEATH + 60_001, 100, 7)] }))).toBeUndefined()
  })
})

describe('pattern — jungle tempo window not punished (before 12:00)', () => {
  const show = (o: { ms?: number; pos?: P; extra?: any[]; frame?: (i: number, pid: number) => any; me?: number; killer?: number; assists?: number[] } = {}) => buildGame({ minutes: 14, me: o.me ?? 2, frame: o.frame,
    events: [kill(o.ms ?? at(6), 4, o.killer ?? 7, o.assists ?? [], o.pos ?? { x: 11001, y: 3000 }), ...(o.extra ?? [])] })

  it('the enemy jungler shows more than 8000 units away, strictly', () => {
    // The player stands at (3000, 3000).
    expect(withPattern(show(), 'jungle-window-unpunished')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 360, facts: { playerDistance: 8001 } })
    expect(patterns(show({ pos: { x: 11000, y: 3000 } }))).toEqual([])
  })
  it('from 2:30, strictly before 12:00', () => {
    expect(patterns(show({ ms: 149_999 }))).toEqual([]) // a level-1 skirmish is not a tempo window
    expect(patterns(show({ ms: 150_000 }))).toEqual(['jungle-window-unpunished'])
    expect(patterns(show({ ms: 719_999 }))).toEqual(['jungle-window-unpunished'])
    expect(patterns(show({ ms: 720_000 }))).toEqual([])
  })
  it('no window for a player who is dead or back for less than 20 s', () => {
    // Level 3 dying at 5:50: 8 s of respawn → back at 5:58, available again at 6:18.
    const afterDeath = (ms: number) => patterns(show({ ms, extra: [kill(at(5, 50), 2, 8, [], { x: 3000, y: 3000 })] }))
    expect(afterDeath(at(6, 5))).toEqual([])
    expect(afterDeath(at(6, 18) - 1)).toEqual([])
    expect(afterDeath(at(6, 18))).toEqual(['jungle-window-unpunished'])
    // Dying during the 45 s is not "farming passively" either.
    expect(patterns(show({ extra: [kill(at(6, 30), 2, 8, [], { x: 3000, y: 3000 })] }))).toEqual([])
  })
  it('an enemy epic already reported by the objective trigger is one moment, not two', () => {
    // The enemy jungler takes the dragon at 10:00, 8645 units from a jungler who just took a plate (tower greed):
    // the missed cross-map is the moment; the same kill is not reported again as an unpunished window 25 s later.
    const T = at(10)
    const g = buildGame({ minutes: 14, me: 2, frame: (_i, pid) => (pid === 2 ? { position: { x: 2000, y: 8000 } } : undefined), events: [
      { type: 'TURRET_PLATE_DESTROYED', timestamp: T - 30_000, killerId: 2, laneType: 'TOP_LANE' },
      { type: 'ELITE_MONSTER_KILL', timestamp: T, killerId: 7, killerTeamId: 200, monsterType: 'DRAGON', position: DRAGON_PIT }] })
    expect(patterns(g)).toEqual(['tempo-hesitation'])
    // A kill by the enemy jungler at the same place is still a window of its own.
    const k = buildGame({ minutes: 14, me: 2, frame: (_i, pid) => (pid === 2 ? { position: { x: 2000, y: 8000 } } : undefined), events: [kill(T, 4, 7, [], DRAGON_PIT)] })
    expect(patterns(k)).toEqual(['jungle-window-unpunished'])
  })
  it('counts the enemy jungler as killer or assister, nobody else', () => {
    expect(patterns(show({ killer: 8, assists: [7] }))).toEqual(['jungle-window-unpunished'])
    expect(patterns(show({ killer: 8, assists: [9] }))).toEqual([])
  })
  it('the window is used by a takedown, tower, plate or objective within 45 s, inclusive', () => {
    expect(patterns(show({ extra: [kill(at(6) + 45_000, 6, 2)] }))).toEqual([])
    expect(patterns(show({ extra: [kill(at(6) + 45_001, 6, 2)] }))).toEqual(['jungle-window-unpunished'])
    expect(patterns(show({ extra: [kill(at(6, 20), 6, 1, [2])] }))).toEqual([])
    expect(patterns(show({ extra: [tower(at(6, 20), 200, 1, [2])] }))).toEqual([])
    expect(patterns(show({ extra: [{ type: 'TURRET_PLATE_DESTROYED', timestamp: at(6, 20), killerId: 2 }] }))).toEqual([])
    // A neutral objective taken by the team with the player standing next to it.
    expect(patterns(show({ extra: [epic(at(6, 20), 100, 'RIFTHERALD', { x: 3500, y: 3500 })] }))).toEqual([])
  })
  it('leaving their own side during the window counts as acting on it', () => {
    const crossed = (i: number, pid: number) => (pid === 2 && i >= 7 ? { position: { x: 9000, y: 9000 } } : undefined)
    expect(patterns(show({ frame: crossed }))).toEqual([])
  })
  it('junglers only', () => {
    expect(patterns(show({ me: 1 }))).toEqual([])
  })
})

describe('pattern — bad rotation (laners, before 14:00)', () => {
  const roam = (o: { k?: number; me?: number; from?: P; to?: P; cs?: number; xp?: number; extra?: any[] } = {}) => {
    const k = o.k ?? 5
    const me = o.me ?? 3
    // A ward at 1:00 keeps the support's V6 "no ward by 1:45" moment (microReviewV6.test.ts) out of these cases.
    return buildGame({ minutes: 18, me, events: [ward(60_000, me), ...(o.extra ?? [])],
      frame: (i, pid) => {
        if (pid !== me) return undefined
        if (i === k) return { position: o.from ?? { x: 7400, y: 7600 } }
        if (i === k + 1) return { position: o.to ?? { x: 2600, y: 9000 } }
        if (i === k + 2) return { minionsKilled: (k + 2) * 7 - (o.cs ?? 9), xp: (k + 2) * 500 - (o.xp ?? 351) }
        return undefined
      } })
  }
  it('more than 8 CS AND more than 350 XP lost on the lane opponent, both strict', () => {
    expect(withPattern(roam(), 'bad-rotation')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 5 * 60 + 20, facts: { csLost: 9, xpLost: 351 } })
    expect(patterns(roam({ cs: 8 }))).toEqual([])
    expect(patterns(roam({ xp: 350 }))).toEqual([])
  })
  it('a takedown during the roam makes it worth it', () => {
    expect(patterns(roam({ extra: [kill(at(6, 10), 7, 2, [3])] }))).toEqual([])
  })
  it('strictly before 14:00', () => {
    expect(patterns(roam({ k: 13 }))).toEqual(['bad-rotation'])
    expect(patterns(roam({ k: 14 }))).toEqual([])
  })
  it('a recall is not a roam', () => {
    expect(patterns(roam({ to: { x: 400, y: 400 } }))).toEqual([])
  })
  it('walking around the corner of a side lane is not leaving it', () => {
    // Top lane is L-shaped: (1200, 9000) → (4500, 13000) stays in the lane, although the straight line between the two snapshots cuts through the jungle.
    expect(patterns(roam({ me: 1, from: { x: 1200, y: 9000 }, to: { x: 4500, y: 13000 } }))).toEqual([])
    // Ending the minute in the river is a rotation.
    expect(patterns(roam({ me: 1, from: { x: 1200, y: 9000 }, to: { x: 4500, y: 10000 } }))).toEqual(['bad-rotation'])
  })
  it('walking back from a death is not a rotation', () => {
    const fromDeath = { me: 1, from: { x: 2100, y: 12600 }, to: { x: 3200, y: 6500 } }
    expect(patterns(roam(fromDeath))).toEqual(['bad-rotation'])
    // The same path after dying in lane at 5:10: the CS and XP were lost to the death.
    expect(patterns(roam({ ...fromDeath, extra: [kill(at(5, 10), 1, 6, [], { x: 2100, y: 12600 })] }))).toEqual([])
    // Up to 45 s before the minute starts (4:15 → 5:00), a death still explains the walk.
    expect(patterns(roam({ ...fromDeath, extra: [kill(at(4, 15), 1, 6, [], { x: 2100, y: 12600 })] }))).toEqual([])
    expect(patterns(roam({ ...fromDeath, extra: [kill(at(4, 15) - 1, 1, 6, [], { x: 2100, y: 12600 })] }))).toEqual(['bad-rotation'])
  })
  it('top and bot laners too, never the support or the jungler', () => {
    expect(patterns(roam({ me: 1, from: { x: 1200, y: 9000 }, to: { x: 5000, y: 9500 } }))).toEqual(['bad-rotation'])
    expect(patterns(roam({ me: 4, from: { x: 9000, y: 1200 }, to: { x: 9500, y: 5000 } }))).toEqual(['bad-rotation'])
    expect(patterns(roam({ me: 5, from: { x: 9000, y: 1200 }, to: { x: 9500, y: 5000 } }))).toEqual([])
    expect(patterns(roam({ me: 2 }))).toEqual([])
  })
})

describe('pattern — mid roam that costs plates (before 14:00)', () => {
  const BLUE_MID_OUTER = { x: 5846, y: 6396 }
  const RED_MID_OUTER = { x: 9164, y: 8609 }
  const plate = (ms: number, o: { killerId?: number; pos?: P | null; lane?: string } = {}) =>
    ({ type: 'TURRET_PLATE_DESTROYED', timestamp: ms, killerId: o.killerId ?? 8, laneType: o.lane ?? 'MID_LANE', ...(o.pos === null ? {} : { position: o.pos ?? BLUE_MID_OUTER }) })
  const midRoam = (o: { k?: number; me?: number; from?: P; to?: P; cs?: number; xp?: number; plates?: any[]; extra?: any[] } = {}) => {
    const k = o.k ?? 5
    const me = o.me ?? 3
    return buildGame({ minutes: 18, me, events: [...(o.plates ?? [plate(k * 60_000 + 40_000)]), ...(o.extra ?? [])],
      frame: (i, pid) => {
        if (pid !== me) return undefined
        if (i === k) return { position: o.from ?? { x: 7400, y: 7600 } }
        if (i === k + 1) return { position: o.to ?? { x: 10500, y: 4000 } }
        if (i === k + 2) return { minionsKilled: (k + 2) * 7 - (o.cs ?? 10), xp: (k + 2) * 500 - (o.xp ?? 0) }
        return undefined
      } })
  }
  it('1+ mid plate lost and 10+ CS lost during the roam', () => {
    expect(withPattern(midRoam(), 'mid-roam-plates')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 5 * 60 + 30, facts: { platesLost: 1, csLost: 10, xpLost: 0, roamSide: 'bot' } })
    expect(patterns(midRoam({ cs: 9 }))).toEqual([])
    expect(patterns(midRoam({ plates: [] }))).toEqual([])
    expect(withPattern(midRoam({ plates: [plate(at(5, 40)), plate(at(6, 30))] }), 'mid-roam-plates')!.facts.platesLost).toBe(2)
  })
  it('the plate must fall between the two snapshots around the roam, inclusive', () => {
    expect(patterns(midRoam({ plates: [plate(at(5) - 1)] }))).toEqual([])
    expect(patterns(midRoam({ plates: [plate(at(5))] }))).toEqual(['mid-roam-plates'])
    expect(patterns(midRoam({ plates: [plate(at(7))] }))).toEqual(['mid-roam-plates'])
    expect(patterns(midRoam({ plates: [plate(at(7) + 1)] }))).toEqual([])
  })
  it('only the player\'s own mid plates count', () => {
    expect(patterns(midRoam({ plates: [plate(at(5, 40), { pos: RED_MID_OUTER, killerId: 3 })] }))).toEqual([]) // the enemy's plate
    expect(patterns(midRoam({ plates: [plate(at(5, 40), { pos: { x: 981, y: 10441 } })] }))).toEqual([]) // top lane plate
    // Without coordinates: a MID_LANE plate taken by an enemy champion.
    expect(patterns(midRoam({ plates: [plate(at(5, 40), { pos: null })] }))).toEqual(['mid-roam-plates'])
    expect(patterns(midRoam({ plates: [plate(at(5, 40), { pos: null, killerId: 3 })] }))).toEqual([])
    expect(patterns(midRoam({ plates: [plate(at(5, 40), { pos: null, lane: 'TOP_LANE' })] }))).toEqual([])
  })
  it('no kill or assist, a real roam (not a recall, not still on the lane)', () => {
    expect(patterns(midRoam({ extra: [kill(at(6, 20), 9, 4, [3])] }))).toEqual([])
    expect(patterns(midRoam({ to: { x: 400, y: 400 } }))).toEqual([])
    expect(patterns(midRoam({ to: { x: 7000, y: 7200 } }))).toEqual([])
  })
  it('a real excursion: 2600+ units off the mid diagonal (|x − y|), not a step into the brush next to the lane', () => {
    expect(patterns(midRoam({ to: { x: 8800, y: 6200 } }))).toEqual(['mid-roam-plates'])
    expect(patterns(midRoam({ to: { x: 8800, y: 6201 } }))).toEqual([])
    expect(patterns(midRoam({ to: { x: 6300, y: 8200 } }))).toEqual([]) // 200 units outside the lane band
  })
  it('the player left the lane alive: plates lost to a death are not a roam', () => {
    expect(patterns(midRoam({ extra: [kill(at(5, 10), 3, 8, [], { x: 7400, y: 7600 })] }))).toEqual([])
  })
  it('records the side of the roam and the enemy Voidgrubs', () => {
    expect(withPattern(midRoam({ to: { x: 4000, y: 10500 } }), 'mid-roam-plates')!.facts.roamSide).toBe('top')
    expect(withPattern(midRoam(), 'mid-roam-plates')!.facts.enemyGrubs).toBeUndefined()
    const grubs = midRoam({ extra: [epic(at(5, 10), 200, 'HORDE', BARON_PIT)] })
    expect(withPattern(grubs, 'mid-roam-plates')!.facts.enemyGrubs).toBe(true)
  })
  it('strictly before 14:00, mid laners only', () => {
    expect(patterns(midRoam({ k: 13 }))).toEqual(['mid-roam-plates'])
    expect(patterns(midRoam({ k: 14 }))).toEqual([])
    expect(patterns(midRoam({ me: 1 }))).toEqual([])
  })
  it('replaces the generic bad-rotation moment for the same roam', () => {
    expect(patterns(midRoam({ cs: 12, xp: 500 }))).toEqual(['mid-roam-plates'])
  })
  it('mirrored for a red mid laner', () => {
    const g = midRoam({ me: 8, from: { x: 7600, y: 7400 }, to: { x: 4000, y: 10500 }, plates: [plate(at(5, 40), { pos: RED_MID_OUTER, killerId: 3 })] })
    expect(withPattern(g, 'mid-roam-plates')!.facts).toMatchObject({ platesLost: 1, roamSide: 'top' })
    // The blue outer turret is the ENEMY's plate for a red player.
    expect(patterns(midRoam({ me: 8, from: { x: 7600, y: 7400 }, to: { x: 4000, y: 10500 }, plates: [plate(at(5, 40), { killerId: 8 })] }))).toEqual([])
  })
})

describe('pattern — choke points: in the pit instead of zoning (from 14:00)', () => {
  // Two allies die near the pit at M:00 and M:00 + gap; the player stands `playerDist` from the pit centre from M−1:00 to M+1:00.
  const pitFight = (o: { me?: number; pit?: P; minute?: number; offset?: number; playerDist?: number; fightDist?: number; gap?: number; champions?: Record<number, string>; events?: (t0: number, near: P) => any[]; frame?: (i: number, pid: number) => any } = {}) => {
    const me = o.me ?? 5
    const pit = o.pit ?? BARON_PIT
    const M = o.minute ?? 26
    const t0 = M * 60_000 + (o.offset ?? 0)
    const near = { x: pit.x + (o.fightDist ?? 2999), y: pit.y }
    // Two team-mates of the player (never the player: dying 2999 units away would contradict "standing in the pit").
    const allies = (me <= 5 ? [1, 2, 3, 4, 5] : [6, 7, 8, 9, 10]).filter((id) => id !== me).slice(2, 4)
    const foes = me <= 5 ? [7, 8] : [3, 4]
    return buildGame({ minutes: 30, me, champions: o.champions,
      frame: o.frame ?? ((i, pid) => (pid === me && i >= M - 1 && i <= M + 1 ? { position: { x: pit.x + (o.playerDist ?? 899), y: pit.y } } : undefined)),
      // The player wards at 1:00: the support's V6 "no ward by 1:45" moment (microReviewV6.test.ts) is not what is tested here.
      events: [ward(60_000, me), ...(o.events?.(t0, near) ?? [kill(t0, allies[0], foes[0], [], near), kill(t0 + (o.gap ?? 10_000), allies[1], foes[1], [], near)])] })
  }
  it('a support inside the pit (d < 900) when a lost fight breaks out within 3000 units', () => {
    expect(withPattern(pitFight(), 'pit-chokepoint')).toMatchObject({
      trigger: 'absent-objective', gameTimeSec: 26 * 60 - 15, facts: { alliesDown: 2, nearestPit: 'baron', pitDistance: 899, nearObjective: true },
    })
  })
  it('inside the pit = strictly less than 900 units from its centre', () => {
    expect(patterns(pitFight({ playerDist: 899 }))).toEqual(['pit-chokepoint'])
    expect(patterns(pitFight({ playerDist: 900 }))).toEqual([])
  })
  it('the fight is around the pit = kills strictly within 3000 units', () => {
    expect(patterns(pitFight({ fightDist: 2999 }))).toEqual(['pit-chokepoint'])
    expect(patterns(pitFight({ fightDist: 3000 }))).toEqual([])
  })
  it('a fight is 2+ kills at most 20 s apart', () => {
    expect(patterns(pitFight({ gap: 20_000 }))).toEqual(['pit-chokepoint'])
    expect(patterns(pitFight({ gap: 20_001 }))).toEqual([])
  })
  it('from 14:00', () => {
    expect(patterns(pitFight({ minute: 14 }))).toEqual(['pit-chokepoint'])
    expect(patterns(pitFight({ minute: 14, offset: -1 }))).toEqual([])
  })
  it('the player must have been in the pit for the whole 15 s before the fight', () => {
    // Walking in: 3000 units out at 25:00, inside at 26:00 → still outside at 25:45.
    const walkingIn = (i: number, pid: number) => (pid === 5 ? (i === 25 ? { position: { x: BARON_PIT.x + 3000, y: BARON_PIT.y } } : i >= 26 && i <= 27 ? { position: { x: BARON_PIT.x + 899, y: BARON_PIT.y } } : undefined) : undefined)
    expect(patterns(pitFight({ frame: walkingIn }))).toEqual([])
  })
  it('supports and mid-lane control mages only', () => {
    expect(patterns(pitFight({ me: 5 }))).toEqual(['pit-chokepoint'])
    expect(isControlMage('Orianna')).toBe(true)
    expect(isControlMage('Zed')).toBe(false)
    expect(patterns(pitFight({ me: 3, champions: { 3: 'Orianna' } }))).toEqual(['pit-chokepoint'])
    expect(patterns(pitFight({ me: 3, champions: { 3: 'Zed' } }))).toEqual([])
    for (const me of [1, 2, 4]) expect(patterns(pitFight({ me, champions: { [me]: 'Orianna' } }))).toEqual([])
  })
  it('a fight that is won costs nothing — unless the objective is lost anyway', () => {
    const won = (t0: number, near: P) => [kill(t0, 7, 3, [], near), kill(t0 + 5_000, 8, 4, [], near), kill(t0 + 9_000, 3, 9, [], near)]
    expect(patterns(pitFight({ events: won }))).toEqual([])
    const stolen = (t0: number, near: P) => [...won(t0, near), epic(t0 + 40_000, 200, 'BARON_NASHOR', BARON_PIT)]
    expect(patterns(pitFight({ events: stolen }))).toContain('pit-chokepoint')
  })
  it('when the player dies in that fight, the pattern is carried by the death', () => {
    const died = (t0: number, near: P) => [kill(t0, 5, 7, [8], { x: BARON_PIT.x + 899, y: BARON_PIT.y }), kill(t0 + 5_000, 3, 8, [], near)]
    const m = withPattern(pitFight({ events: died }), 'pit-chokepoint')!
    expect(m).toMatchObject({ trigger: 'critical-death', gameTimeSec: 26 * 60, facts: { alliesDown: 2, nearestPit: 'baron', nearObjective: true } })
    expect(patterns(pitFight({ events: died }))).toEqual(['pit-chokepoint']) // one moment, not two
  })
  it('a support who dies in the pit is read on the way to that death, wherever the next snapshot finds them', () => {
    // In the pit at 26:00, a team-mate falls at 26:30, the support at 26:35 — and is in the fountain for the 27:00 snapshot.
    const inPit = { x: BARON_PIT.x + 500, y: BARON_PIT.y }
    const frame = (i: number, pid: number) => (pid === 5 ? { position: i === 25 || i === 26 ? inPit : { x: 400, y: 450 } } : undefined)
    const events = (t0: number, near: P) => [kill(t0, 3, 7, [], near), kill(t0 + 5_000, 5, 8, [7], inPit)]
    expect(withPattern(pitFight({ offset: 30_000, frame, events }), 'pit-chokepoint')).toMatchObject({ trigger: 'critical-death', gameTimeSec: 26 * 60 + 35, facts: { alliesDown: 2 } })
  })
  it('a death far from the pit while the fight goes on is not part of it', () => {
    // In the pit when the fight starts at 26:00; three team-mates fall around it; the support dies at 26:30, 4000 units away.
    const far = (t0: number, near: P) => [kill(t0, 3, 7, [], near), kill(t0 + 15_000, 4, 8, [], near),
      kill(t0 + 30_000, 5, 9, [], { x: BARON_PIT.x, y: BARON_PIT.y - 4000 }), kill(t0 + 35_000, 2, 7, [], near)]
    const moments = run(pitFight({ events: far })).moments
    // The pit moment is the fight itself (15 s before it), not that death.
    expect(moments.map((m) => [m.trigger, m.gameTimeSec, m.facts.pattern])).toEqual([['absent-objective', 26 * 60 - 15, 'pit-chokepoint']])
    expect(moments[0].facts.alliesDown).toBe(3)
  })
  it('the dragon pit follows the same geometry', () => {
    expect(withPattern(pitFight({ pit: DRAGON_PIT }), 'pit-chokepoint')!.facts).toMatchObject({ nearestPit: 'dragon', pitDistance: 899 })
    expect(patterns(pitFight({ pit: DRAGON_PIT, playerDist: 900 }))).toEqual([])
  })
  it('mirrored for a red-side support', () => {
    expect(patterns(pitFight({ me: 10 }))).toEqual(['pit-chokepoint'])
  })
})

describe('precedence and limits', () => {
  it('a gank-timer death never also raises another death pattern', () => {
    const g = buildGame({ minutes: 8, me: 1, events: [kill(150_000, 1, 7, [8, 9], { x: 1500, y: 9000 })] })
    expect(patterns(g)).toEqual(['gank-timer'])
  })
  it('every moment carries a win probability and its geometry', () => {
    const g = buildGame({ minutes: 25, me: 1, events: [kill(at(20), 1, 8, [], { x: 9750, y: 9751 })] })
    const m = run(g).moments[0]
    expect(m.winProbBefore).toBe(0.5)
    expect(m.position).toEqual({ x: 9750, y: 9751 })
    expect(m.territory).toBe('enemy')
    expect(m.key).toBe('critical-death@1200')
  })
  it('analyses a 40-minute game with every detector armed in under 5 ms', () => {
    const events: any[] = []
    for (let s = 30; s < 40 * 60; s += 7) events.push(ward(s * 1000, (s % 10) + 1))
    for (let k = 0; k < 40; k++) events.push(kill(at(2 + k) - 500, (k % 10) + 1, ((k + 5) % 10) + 1, [((k + 6) % 10) + 1], { x: 5000 + 100 * k, y: 9000 }))
    for (let m = 6; m < 40; m += 5) events.push(epic(at(m, 20), m % 2 ? 100 : 200, m > 22 ? 'BARON_NASHOR' : 'DRAGON', m > 22 ? BARON_PIT : DRAGON_PIT))
    for (let m = 5; m < 14; m += 2) events.push({ type: 'TURRET_PLATE_DESTROYED', timestamp: at(m, 30), killerId: 8, laneType: 'MID_LANE', position: { x: 5846, y: 6396 } })
    for (const me of [2, 3, 5, 8]) {
      const g = buildGame({ minutes: 40, me, events, champions: { 3: 'Orianna', 8: 'Syndra' } })
      run(g) // warm-up
      const t0 = performance.now()
      for (let i = 0; i < 20; i++) run(g)
      expect((performance.now() - t0) / 20).toBeLessThan(5)
    }
  })
})
