/**
 * The current season's clock (patch 26.1, game version 16.x): minions 0:30, camps 0:55, Scuttle 2:55, and the wiki
 * respawn timers. Every early-game threshold is checked on both sides of its boundary. Games of an older season (15.x)
 * are not analysed (user's decision, 20/11/2026).
 */
import { describe, it, expect } from 'vitest'
import { analyzeGame, DETECTOR_SPEC, type CriticalMoment, type MomentFacts, type MomentPattern } from '../../src/lib/microReview/anomalyDetector'
import { BASE_RESPAWN_SEC, CLOCK_TIMES, seasonOf } from '../../src/lib/microReview/gameClock'
import { buildQcm } from '../../src/lib/microReview/smartQcm'
import { OUTER_TURRETS } from '../../src/lib/microReview/geometry'
import { detectMistakes } from '../../electron/main/mistakeDetector'
import { buildGame, at, type FixtureOptions } from './microReviewFixtures'

type Game = ReturnType<typeof buildGame>
type P = { x: number; y: number }
const run = (g: Game) => analyzeGame(g.match, g.timeline, g.selector)!
const withPattern = (g: Game, pattern: MomentPattern) => run(g).moments.find((m) => m.facts.pattern === pattern)
const kill = (ts: number, victimId: number, killerId: number, assists: number[] = [], position?: P) =>
  ({ type: 'CHAMPION_KILL', timestamp: ts, victimId, killerId, assistingParticipantIds: assists, ...(position ? { position } : {}) })
const levelUp = (ts: number, participantId: number, level: number) => ({ type: 'LEVEL_UP', timestamp: ts, participantId, level })
const buy = (ts: number, participantId: number) => ({ type: 'ITEM_PURCHASED', timestamp: ts, participantId, itemId: 1036 })
const ward = (ts: number, creatorId: number) => ({ type: 'WARD_PLACED', timestamp: ts, creatorId, wardType: 'YELLOW_TRINKET' })
const hp = (pct: number) => ({ championStats: { health: pct * 10, healthMax: 1000 } })
const TOP_LANE: P = { x: 1500, y: 9000 }
const BOT_OWN: P = { x: 10500, y: 1500 }
const BOT_RIVER: P = { x: 9500, y: 5000 }
const ENEMY_SIDE: P = { x: 10500, y: 8500 }
const S = DETECTOR_SPEC
const game = (o: FixtureOptions) => buildGame(o)

describe('season of a game (Match-V5 gameVersion)', () => {
  const season = (gameVersion?: unknown) => seasonOf({ info: gameVersion === undefined ? {} : { gameVersion } })
  it('16.x and later are the current season, 15.x and earlier are not supported', () => {
    expect(season('16.1.732.4020')).toBe('current')
    expect(season('16.22.1')).toBe('current')
    expect(season('17.1')).toBe('current')
    expect(season('15.24.715.2077')).toBe('unsupported')
    expect(season('15.1.1')).toBe('unsupported')
    expect(season('14.23.1')).toBe('unsupported')
  })
  it('an unknown version is read as a current game', () => {
    expect(season()).toBe('current')
    expect(season('')).toBe('current')
    expect(season('beta')).toBe('current')
    expect(seasonOf(null)).toBe('current')
    expect(seasonOf(buildGame({ gameVersion: null }).match)).toBe('current')
  })
  it('the fixtures are current games', () => {
    expect(seasonOf(buildGame().match)).toBe('current')
  })
})

describe('a 15.x game is not analysed', () => {
  // A gank-timer death at 2:00 and an early death: both would be read on a 16.x game.
  const events = [kill(at(2, 0), 1, 7, [], TOP_LANE)]
  it('the micro-review finds no moment', () => {
    const old = buildGame({ minutes: 20, me: 1, events, gameVersion: '15.24.715.2077' })
    expect(analyzeGame(old.match, old.timeline, old.selector)).toBeNull()
    const current = buildGame({ minutes: 20, me: 1, events })
    expect(withPattern(current, 'gank-timer')).toBeDefined()
  })
  it('the auto-detector finds no mistake', () => {
    const old = buildGame({ minutes: 20, me: 1, events, gameVersion: '15.24.715.2077' })
    expect(detectMistakes(old.timeline, old.match, old.selector)).toEqual([])
    const current = buildGame({ minutes: 20, me: 1, events })
    expect(detectMistakes(current.timeline, current.match, current.selector).length).toBeGreaterThan(0)
  })
})

describe('respawn timers', () => {
  it('the wiki base wait (10 s at level 1 … 52.5 s at 18)', () => {
    expect(BASE_RESPAWN_SEC).toEqual([10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5])
  })
  // The respawn moves the player's availability: a level-3 jungler dead at 5:50 is back at 6:02, and a tempo window
  // opens 20 s after that (DETECTOR_SPEC.tempoWindow.respawnGraceSec).
  it('no tempo window until 20 s after the respawn', () => {
    const back = at(6, 2)
    const show = (ms: number) => buildGame({ minutes: 14, me: 2,
      events: [kill(at(5, 50), 2, 8, [], { x: 3000, y: 3000 }), kill(ms, 4, 7, [], { x: 11001, y: 3000 })] })
    expect(withPattern(show(back + 20_000 - 1), 'jungle-window-unpunished')).toBeUndefined()
    expect(withPattern(show(back + 20_000), 'jungle-window-unpunished')).toBeDefined()
  })
})

describe('the current numbers', () => {
  it('early-game timings on minions at 0:30', () => {
    expect([S.gank.window1, S.gank.window2]).toEqual([[110, 145], [160, 230]]) // 1:50–2:25, 2:40–3:50
    expect([S.supportScuttle.fromSec, S.supportScuttle.untilSec]).toEqual([170, 195]) // 2:50–3:15, Scuttle at 2:55
    expect(S.jungleFirstBack.bySec).toBe(210) // 3:30
    expect(S.supportEarly).toEqual({ wardBySec: 70, deathFromSec: 90, deathToSec: 125 })
    expect(S.levelSpike.untilSec).toBe(235)
    expect([S.cheaterRecall.visitSec, S.cheaterRecall.anchorSec]).toEqual([[120, 160], 120])
    expect([S.jungle.fromSec, S.tempoWindow.fromSec]).toEqual([115, 115])
  })
  it('the times the cards quote are the detector\'s', () => {
    expect([CLOCK_TIMES.gank1, CLOCK_TIMES.gank2]).toEqual([S.gank.window1, S.gank.window2])
    expect(CLOCK_TIMES.supportWardBy).toBe(S.supportEarly.wardBySec)
    expect(CLOCK_TIMES.jungleFirstBack).toBe(S.jungleFirstBack.bySec)
    expect(CLOCK_TIMES.cheaterBack).toEqual(S.cheaterRecall.visitSec)
  })
})

describe('re-timed thresholds, both sides of each boundary', () => {
  it('gank on a predictable timer: window 1 (3-camp transition), inclusive', () => {
    const gank = (ms: number) => withPattern(game({ minutes: 8, me: 1, events: [kill(ms, 1, 7, [], TOP_LANE)] }), 'gank-timer')?.facts
    const [from, to] = S.gank.window1
    expect(gank(from * 1000 - 1)).toBeUndefined()
    expect(gank(from * 1000)).toMatchObject({ gankWindow: 1 })
    expect(gank(to * 1000)).toMatchObject({ gankWindow: 1 })
    expect(gank(to * 1000 + 1)).toBeUndefined()
  })
  it('gank on a predictable timer: window 2 (end of the first clear), inclusive', () => {
    const gank = (ms: number) => withPattern(game({ minutes: 8, me: 1, events: [kill(ms, 1, 7, [], TOP_LANE)] }), 'gank-timer')?.facts
    const [from, to] = S.gank.window2
    expect(gank(from * 1000 - 1)).toBeUndefined()
    expect(gank(from * 1000)).toMatchObject({ gankWindow: 2, deepWard: false })
    expect(gank(to * 1000)).toMatchObject({ gankWindow: 2 })
    expect(gank(to * 1000 + 1)).toBeUndefined()
  })

  it('support missing at the first Scuttle: our jungler dead in the bot river inside the window', () => {
    const scuttle = (ms: number) => withPattern(game({ minutes: 8, me: 5, events: [ward(60_000, 5), kill(ms, 2, 7, [10], BOT_RIVER)] }), 'support-absent-scuttle')
    const { fromSec, untilSec } = S.supportScuttle
    expect(scuttle(fromSec * 1000 - 1)).toBeUndefined()
    expect(scuttle(fromSec * 1000)).toMatchObject({ trigger: 'absent-objective', gameTimeSec: fromSec - 10 })
    expect(scuttle(untilSec * 1000)).toBeDefined()
    expect(scuttle(untilSec * 1000 + 1)).toBeUndefined()
  })

  it('jungler first back: a back at the limit is in time, one after it is late', () => {
    const late = (back: number) => withPattern(game({ minutes: 8, me: 2, events: [buy(10_000, 2), buy(back, 2)] }), 'jungle-late-first-recall')
    const by = S.jungleFirstBack.bySec
    expect(late(by * 1000)).toBeUndefined()
    expect(late(by * 1000 + 1)).toMatchObject({ gameTimeSec: by, facts: { firstBackSec: by } })
  })

  it('support without a ward of their own by the limit', () => {
    const lane = (events: any[] = []) => withPattern(game({ minutes: 6, me: 5, events }), 'support-no-early-ward')
    const by = S.supportEarly.wardBySec
    expect(lane()).toMatchObject({ gameTimeSec: by })
    expect(lane([ward(by * 1000, 5)])).toBeUndefined()
    expect(lane([ward(by * 1000 + 1, 5)])).toBeDefined()
  })

  it('support level-2 fight lost: inside the death window only', () => {
    const fight = (deathAt: number) => withPattern(game({ minutes: 8, me: 5,
      events: [levelUp(deathAt - 5000, 9, 2), kill(deathAt, 5, 9, [10], BOT_OWN)] }), 'support-level2-allin')
    const { deathFromSec, deathToSec } = S.supportEarly
    expect(fight(deathFromSec * 1000 - 1)).toBeUndefined()
    expect(fight(deathFromSec * 1000)).toMatchObject({ facts: { myLevel: 1, enemyLevel: 2 } })
    expect(fight(deathToSec * 1000)).toBeDefined()
    expect(fight(deathToSec * 1000 + 1)).toBeUndefined()
  })

  it('killed on the lane opponent\'s level 2: until the limit, inclusive', () => {
    const spike = (deathAt: number) => withPattern(game({ minutes: 8, me: 1, events: [levelUp(deathAt - 5000, 6, 2), kill(deathAt, 1, 6, [], TOP_LANE)] }), 'level-up-spike')
    expect(spike(S.levelSpike.untilSec * 1000)).toMatchObject({ facts: { spikeLevel: 2 } })
    expect(spike(S.levelSpike.untilSec * 1000 + 1000)).toBeUndefined()
  })

  it('jungle overchase: from the end of the first clear, anchored 20 s before the death', () => {
    const chase = (ms: number) => withPattern(game({ minutes: 12, me: 2, frame: (_i, pid) => (pid === 2 ? { position: ENEMY_SIDE } : undefined),
      events: [kill(ms, 2, 8, [], ENEMY_SIDE)] }), 'jungle-overchase')
    expect(chase(S.jungle.fromSec * 1000 - 1)).toBeUndefined()
    expect(chase(S.jungle.fromSec * 1000)).toMatchObject({ gameTimeSec: S.jungle.fromSec - 20 })
  })

  it('tempo window not punished: from the end of the first clear', () => {
    const show = (ms: number) => withPattern(game({ minutes: 14, me: 2, events: [kill(ms, 4, 7, [], { x: 11001, y: 3000 })] }), 'jungle-window-unpunished')
    expect(show(S.tempoWindow.fromSec * 1000 - 1)).toBeUndefined()
    expect(show(S.tempoWindow.fromSec * 1000)).toBeDefined()
  })

  it('passive clear: read at the anchor; a takedown until the quiet limit cancels it', () => {
    const passive = (extra: any[] = []) => withPattern(game({ minutes: 10, me: 2, events: extra, frame: (i, pid) => {
      if (pid === 2 && i <= 4) return { position: { x: 3500, y: 7000 } }
      if (pid === 2 && i === 6) return { xp: 3000 }
      if (i === 3 && pid === 4) return { totalGold: 1700 + 300 }
      return undefined
    } }), 'jungle-passive-clear')
    expect(passive()).toMatchObject({ gameTimeSec: S.jungle.passiveAtSec, facts: { botGoldLead: 300 } })
    expect(passive([kill(S.jungle.quietUntilSec * 1000, 6, 1, [2])])).toBeUndefined()
    expect(passive([kill(S.jungle.quietUntilSec * 1000 + 1, 6, 1, [2])])).toBeDefined()
  })

  it('counter-tempo: a river play, back to the starting quadrant, read at the anchor', () => {
    // Snapshots: in the bot-side quadrant of our jungle, except in the river at 3:00.
    const QUAD: P = { x: 7000, y: 3500 }
    const counter = (river: P) => withPattern(game({ minutes: 10, me: 2, frame: (i, pid) => {
      if (pid !== 2) return undefined
      if (i === 3) return { position: river }
      if (i === 6) return { xp: 3000 - 151, position: QUAD }
      return { position: QUAD }
    } }), 'jungle-counter-tempo')
    expect(counter({ x: 9000, y: 6000 })).toMatchObject({ gameTimeSec: S.jungle.counterTempoAtSec, facts: { xpDiffJungle: -151 } })
    expect(counter({ x: 7100, y: 3600 })).toBeUndefined() // never left the jungle
  })

  it('cheater recall: a back inside the window from high HP, a level behind at 4:00', () => {
    const recall = (o: { visit?: number; inBaseAt3?: boolean; pct?: number }) => withPattern(game({ minutes: 12, me: 1,
      events: [buy(10_000, 1), ...(o.visit != null ? [buy(o.visit, 1)] : [])],
      frame: (i, pid) => {
        if (pid === 1 && i === 2) return hp(o.pct ?? 88)
        if (pid === 1 && i === 3) return { position: o.inBaseAt3 ? { x: 1000, y: 1000 } : TOP_LANE }
        if (i === 4 && pid === 1) return { level: 3 }
        if (i === 4 && pid === 6) return { level: 4 }
        return undefined
      } }), 'cheater-recall')
    const [from, to] = S.cheaterRecall.visitSec
    expect(recall({ visit: from * 1000 - 1 })).toBeUndefined()
    expect(recall({ visit: from * 1000 })).toMatchObject({ gameTimeSec: S.cheaterRecall.anchorSec, facts: { recallHpPct: 88, levelsBehind: 1 } })
    expect(recall({ visit: to * 1000 })).toBeDefined()
    expect(recall({ visit: to * 1000 + 1 })).toBeUndefined()
    expect(recall({ visit: from * 1000, pct: S.cheaterRecall.hpPct })).toBeUndefined()
    // Standing in base on the 3:00 snapshot is a normal back (four waves in), not a cheater recall.
    expect(recall({ inBaseAt3: true })).toBeUndefined()
  })

  // Plates stay up until the tower falls: the plate-bound rules run to 20:00.
  it('1-for-1 tower dive: until 20:00', () => {
    const near: P = { x: OUTER_TURRETS[200].TOP.x, y: OUTER_TURRETS[200].TOP.y - 600 }
    const dive = (killMs: number) => withPattern(game({ minutes: 25, me: 1, events: [
      kill(killMs, 6, 1, [], near),
      { ...kill(killMs + 2000, 1, 0, [], near), victimDamageReceived: [{ participantId: 0, type: 'TOWER' }] },
    ] }), 'tower-dive-one-for-one')
    expect(S.dive.untilSec).toBe(1200)
    expect(dive(S.dive.untilSec * 1000 - 3000)).toBeDefined()
    expect(dive(S.dive.untilSec * 1000)).toBeUndefined()
    expect(dive(at(15, 0))).toBeDefined()
  })

  it('jungler last-hits a side-lane T1 once a tower fell: any time before 20:00', () => {
    const tower = (ts: number, lane: string, killerId: number) => ({ type: 'BUILDING_KILL', timestamp: ts, buildingType: 'TOWER_BUILDING',
      towerType: 'OUTER_TURRET', laneType: lane, teamId: 200, killerId, position: { x: 4318, y: 13875 } })
    const side = (ts: number) => withPattern(game({ minutes: 25, me: 2,
      events: [tower(600_000, 'MID_LANE', 3), tower(ts, 'TOP_LANE', 2)] }), 'jungle-side-t1-destroyed')
    expect(S.sideTower).toEqual({ fromSec: 0, untilSec: 1200 })
    // 12:00, plates still on: the laner's gold.
    expect(side(at(12, 0))).toBeDefined()
    expect(side(S.sideTower.untilSec * 1000)).toBeDefined()
    expect(side(S.sideTower.untilSec * 1000 + 1)).toBeUndefined()
  })

  it('mid roam paid in plates: the window ends at 20:00', () => {
    expect(S.midRoam.untilSec).toBe(1200)
  })
})

describe('cards quote the current times', () => {
  const moment = (facts: MomentFacts): CriticalMoment => ({
    key: 'critical-death@200', trigger: 'critical-death', gameTimeSec: 200, severity: 0.3, position: null, zone: null, lane: null, territory: null,
    winProbBefore: 0.5, winProbAfter: 0.45, facts,
  })
  const head = (facts: MomentFacts) => buildQcm(moment(facts)).summary.head
  it('every card on the current clock', () => {
    expect(head({ pattern: 'gank-timer', gankWindow: 1 })).toEqual({ key: 'gankTimer1', params: { from: '1:50', to: '2:25' } })
    expect(head({ pattern: 'gank-timer', gankWindow: 2 })).toEqual({ key: 'gankTimer2', params: { from: '2:40', to: '3:50' } })
    expect(head({ pattern: 'cheater-recall', recallHpPct: 88 })).toEqual({ key: 'cheaterRecall', params: { pct: 88, from: '2:00', to: '2:40' } })
    expect(head({ pattern: 'support-no-early-ward' })).toEqual({ key: 'supportNoWard', params: { clock: '1:10' } })
    expect(head({ pattern: 'jungle-late-first-recall' })).toEqual({ key: 'lateFirstRecall', params: { clock: '3:30' } })
  })
})
