/**
 * Season-2026 clock (patch 26.1, game version 16.x): minions 0:30, camps 0:55, Scuttle 2:55, i.e. every early-game
 * timing 35 s earlier than in 2025, and the wiki respawn timers. Every re-timed threshold is checked on both sides of its
 * boundary, on a 16.x game and on a 15.x game (which keeps the 2025 clock). The other suites build 15.x games by default.
 */
import { describe, it, expect } from 'vitest'
import { analyzeGame, CLOCK_2025, DETECTOR_SPEC, detectorSpecFor, type CriticalMoment, type MomentFacts, type MomentPattern } from '../../src/lib/microReview/anomalyDetector'
import { BASE_RESPAWN_SEC, CLOCK_TIMES, deathTimerSec, gameClockOf, type GameClock } from '../../src/lib/microReview/gameClock'
import { buildQcm } from '../../src/lib/microReview/smartQcm'
import { buildGame, at, type FixtureOptions } from './microReviewFixtures'

type Game = ReturnType<typeof buildGame>
type P = { x: number; y: number }
const VERSION: Record<GameClock, string> = { 2025: '15.24.715.2077', 2026: '16.1.732.4020' }
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

describe('season of a game (Match-V5 gameVersion)', () => {
  const clock = (gameVersion?: unknown) => gameClockOf({ info: gameVersion === undefined ? {} : { gameVersion } })
  it('16.x and later on the 2026 clock, 15.x and earlier on the 2025 clock', () => {
    expect(clock('16.1.732.4020')).toBe(2026)
    expect(clock('16.22.1')).toBe(2026)
    expect(clock('17.1')).toBe(2026)
    expect(clock('15.24.715.2077')).toBe(2025)
    expect(clock('15.1.1')).toBe(2025)
    expect(clock('14.23.1')).toBe(2025)
  })
  it('an unknown version is read as a current game', () => {
    expect(clock()).toBe(2026)
    expect(clock('')).toBe(2026)
    expect(clock('beta')).toBe(2026)
    expect(gameClockOf(null)).toBe(2026)
    expect(gameClockOf(buildGame({ gameVersion: null }).match)).toBe(2026)
  })
  it('the fixtures of the other suites are 15.x games', () => {
    expect(gameClockOf(buildGame().match)).toBe(2025)
  })
})

describe('respawn timers by season', () => {
  it('16.x: the wiki base wait (10 s at level 1 … 52.5 s at 18); 15.x: the former table, equal from level 10', () => {
    expect(BASE_RESPAWN_SEC[2026]).toEqual([10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5])
    expect(BASE_RESPAWN_SEC[2025].slice(9)).toEqual(BASE_RESPAWN_SEC[2026].slice(9))
    expect(deathTimerSec(3, 5, 2026) - deathTimerSec(3, 5, 2025)).toBe(4)
  })
  // The respawn moves the player's availability: a level-3 jungler dead at 5:50 is back at 5:58 on 15.x, 6:02 on 16.x,
  // and a tempo window opens 20 s after that (DETECTOR_SPEC.tempoWindow.respawnGraceSec).
  for (const [season, back] of [[2025, at(5, 58)], [2026, at(6, 2)]] as const) {
    it(`${season}: no tempo window until 20 s after the respawn`, () => {
      const show = (ms: number) => buildGame({ minutes: 14, me: 2, gameVersion: VERSION[season],
        events: [kill(at(5, 50), 2, 8, [], { x: 3000, y: 3000 }), kill(ms, 4, 7, [], { x: 11001, y: 3000 })] })
      expect(withPattern(show(back + 20_000 - 1), 'jungle-window-unpunished')).toBeUndefined()
      expect(withPattern(show(back + 20_000), 'jungle-window-unpunished')).toBeDefined()
    })
  }
})

describe('the 2026 numbers', () => {
  it('every early timing of the 2025 clock, 35 s earlier', () => {
    const S = DETECTOR_SPEC
    expect([S.gank.window1, S.gank.window2]).toEqual([[110, 145], [160, 230]]) // 1:50–2:25, 2:40–3:50
    expect([S.supportScuttle.fromSec, S.supportScuttle.untilSec]).toEqual([170, 195]) // 2:50–3:15, Scuttle at 2:55
    expect(S.jungleFirstBack.bySec).toBe(210) // 3:30
    expect(S.supportEarly).toEqual({ wardBySec: 70, deathFromSec: 90, deathToSec: 125 })
    expect(S.levelSpike.untilSec).toBe(235)
    expect([S.cheaterRecall.atSec, S.cheaterRecall.visitSec, S.cheaterRecall.anchorSec]).toEqual([null, [120, 160], 120])
    expect([S.jungle.fromSec, S.tempoWindow.fromSec]).toEqual([115, 115])
  })
  it('the times the cards quote are the detector\'s', () => {
    for (const season of [2025, 2026] as const) {
      const S = detectorSpecFor(season)
      const C = CLOCK_TIMES[season]
      expect([C.gank1, C.gank2], `${season}`).toEqual([S.gank.window1, S.gank.window2])
      expect(C.supportWardBy).toBe(S.supportEarly.wardBySec)
      expect(C.jungleFirstBack).toBe(S.jungleFirstBack.bySec)
      expect(C.cheaterBack).toEqual([S.cheaterRecall.anchorSec, S.cheaterRecall.anchorSec + 40])
    }
    expect(CLOCK_TIMES[2026].cheaterBack).toEqual(DETECTOR_SPEC.cheaterRecall.visitSec)
  })
})

describe.each([2025, 2026] as const)('season %i — re-timed thresholds, both sides of each boundary', (season) => {
  const S = detectorSpecFor(season)
  const other: GameClock = season === 2025 ? 2026 : 2025
  const game = (o: FixtureOptions, clock: GameClock = season) => buildGame({ ...o, gameVersion: VERSION[clock] })

  it('gank on a predictable timer: window 1 (3-camp transition), inclusive', () => {
    const gank = (ms: number, clock?: GameClock) => withPattern(game({ minutes: 8, me: 1, events: [kill(ms, 1, 7, [], TOP_LANE)] }, clock), 'gank-timer')?.facts
    const [from, to] = S.gank.window1
    expect(gank(from * 1000 - 1)).toBeUndefined()
    expect(gank(from * 1000)).toMatchObject({ gankWindow: 1, season })
    expect(gank(to * 1000)).toMatchObject({ gankWindow: 1, season })
    expect(gank(to * 1000 + 1)).toBeUndefined()
    // 5 s into this season's window is outside the other season's (the two windows 1 only share 2:25).
    expect(gank(from * 1000 + 5000, other)).toBeUndefined()
  })
  it('gank on a predictable timer: window 2 (end of the first clear), inclusive', () => {
    const gank = (ms: number) => withPattern(game({ minutes: 8, me: 1, events: [kill(ms, 1, 7, [], TOP_LANE)] }), 'gank-timer')?.facts
    const [from, to] = S.gank.window2
    expect(gank(from * 1000 - 1)).toBeUndefined()
    expect(gank(from * 1000)).toMatchObject({ gankWindow: 2, season, deepWard: false })
    expect(gank(to * 1000)).toMatchObject({ gankWindow: 2 })
    expect(gank(to * 1000 + 1)).toBeUndefined()
  })

  it('support missing at the first Scuttle: our jungler dead in the bot river inside the window', () => {
    const scuttle = (ms: number, clock?: GameClock) => withPattern(game({ minutes: 8, me: 5, events: [ward(60_000, 5), kill(ms, 2, 7, [10], BOT_RIVER)] }, clock), 'support-absent-scuttle')
    const { fromSec, untilSec } = S.supportScuttle
    expect(scuttle(fromSec * 1000 - 1)).toBeUndefined()
    expect(scuttle(fromSec * 1000)).toMatchObject({ trigger: 'absent-objective', gameTimeSec: fromSec - 10, facts: { season } })
    expect(scuttle(untilSec * 1000)).toBeDefined()
    expect(scuttle(untilSec * 1000 + 1)).toBeUndefined()
    expect(scuttle(fromSec * 1000, other)).toBeUndefined()
  })

  it('jungler first back: a back at the limit is in time, one after it is late', () => {
    const late = (back: number, clock?: GameClock) => withPattern(game({ minutes: 8, me: 2, events: [buy(10_000, 2), buy(back, 2)] }, clock), 'jungle-late-first-recall')
    const by = S.jungleFirstBack.bySec
    expect(late(by * 1000)).toBeUndefined()
    expect(late(by * 1000 + 1)).toMatchObject({ gameTimeSec: by, facts: { season, firstBackSec: by } })
    if (season === 2026) expect(late(by * 1000 + 1, 2025)).toBeUndefined() // 3:30 is still in time in 2025 (4:05)
    else expect(late(by * 1000 + 1, 2026)).toBeDefined()
  })

  it('support without a ward of their own by the limit', () => {
    const lane = (events: any[] = [], clock?: GameClock) => withPattern(game({ minutes: 6, me: 5, events }, clock), 'support-no-early-ward')
    const by = S.supportEarly.wardBySec
    expect(lane()).toMatchObject({ gameTimeSec: by, facts: { season } })
    expect(lane([ward(by * 1000, 5)])).toBeUndefined()
    expect(lane([ward(by * 1000 + 1, 5)])).toBeDefined()
    if (season === 2026) expect(lane([ward(by * 1000 + 1, 5)], 2025)).toBeUndefined() // 1:10 is early enough in 2025
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

  it('passive clear: read at the season\'s anchor; a takedown until the quiet limit cancels it', () => {
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

  it('counter-tempo: a river play, back to the starting quadrant, read at the season\'s anchor', () => {
    // Snapshots: in the bot-side quadrant of our jungle, except in the river at 3:00 (and 4:00 on the 2025 clock, whose
    // samples run 3:15–4:15).
    const riverAt = season === 2025 ? [3, 4] : [3]
    const QUAD: P = { x: 7000, y: 3500 }
    const counter = (river: P) => withPattern(game({ minutes: 10, me: 2, frame: (i, pid) => {
      if (pid !== 2) return undefined
      if (riverAt.includes(i)) return { position: river }
      if (i === 6) return { xp: 3000 - 151, position: QUAD }
      return { position: QUAD }
    } }), 'jungle-counter-tempo')
    expect(counter({ x: 9000, y: 6000 })).toMatchObject({ gameTimeSec: S.jungle.counterTempoAtSec, facts: { xpDiffJungle: -151 } })
    expect(counter({ x: 7100, y: 3600 })).toBeUndefined() // never left the jungle
  })

  it('cheater recall: a back inside the season\'s window from high HP, a level behind at 4:00', () => {
    const BASE: P = { x: 1000, y: 1000 }
    const recall = (o: { visit?: number; inBaseAt3?: boolean; pct?: number }) => withPattern(game({ minutes: 12, me: 1,
      events: [buy(10_000, 1), ...(o.visit != null ? [buy(o.visit, 1)] : [])],
      frame: (i, pid) => {
        if (pid === 1 && i === 2) return hp(o.pct ?? 88)
        if (pid === 1 && i === 3) return { position: o.inBaseAt3 ? BASE : TOP_LANE }
        if (i === 4 && pid === 1) return { level: 3 }
        if (i === 4 && pid === 6) return { level: 4 }
        return undefined
      } }), 'cheater-recall')
    if (season === 2026) {
      const [from, to] = S.cheaterRecall.visitSec!
      expect(recall({ visit: from * 1000 - 1 })).toBeUndefined()
      expect(recall({ visit: from * 1000 })).toMatchObject({ gameTimeSec: S.cheaterRecall.anchorSec, facts: { season, recallHpPct: 88, levelsBehind: 1 } })
      expect(recall({ visit: to * 1000 })).toBeDefined()
      expect(recall({ visit: to * 1000 + 1 })).toBeUndefined()
      expect(recall({ visit: from * 1000, pct: S.cheaterRecall.hpPct })).toBeUndefined()
      // Standing in base on the 3:00 snapshot is a normal back in 2026 (four waves in), not a cheater recall.
      expect(recall({ inBaseAt3: true })).toBeUndefined()
    } else {
      expect(recall({ inBaseAt3: true })).toMatchObject({ gameTimeSec: CLOCK_2025.cheaterRecall.anchorSec, facts: { season } })
      // A purchase at 2:10 without the 3:00 snapshot in base: the 2025 rule reads the snapshot only.
      expect(recall({ visit: at(2, 10) })).toBeUndefined()
    }
  })
})

describe('cards quote the times of the game\'s season', () => {
  const moment = (facts: MomentFacts): CriticalMoment => ({
    key: 'critical-death@200', trigger: 'critical-death', gameTimeSec: 200, severity: 0.3, position: null, zone: null, lane: null, territory: null,
    winProbBefore: 0.5, winProbAfter: 0.45, facts,
  })
  const head = (facts: MomentFacts) => buildQcm(moment(facts)).summary.head
  it('2026 games', () => {
    expect(head({ pattern: 'gank-timer', gankWindow: 1, season: 2026 })).toEqual({ key: 'gankTimer1', params: { from: '1:50', to: '2:25' } })
    expect(head({ pattern: 'gank-timer', gankWindow: 2, season: 2026 })).toEqual({ key: 'gankTimer2', params: { from: '2:40', to: '3:50' } })
    expect(head({ pattern: 'cheater-recall', recallHpPct: 88, season: 2026 })).toEqual({ key: 'cheaterRecall', params: { pct: 88, from: '2:00', to: '2:40' } })
    expect(head({ pattern: 'support-no-early-ward', season: 2026 })).toEqual({ key: 'supportNoWard', params: { clock: '1:10' } })
    expect(head({ pattern: 'jungle-late-first-recall', season: 2026 })).toEqual({ key: 'lateFirstRecall', params: { clock: '3:30' } })
  })
  it('facts without a season come from the 2025 engine (ANALYSIS_VERSION ≤ 7) and keep its times', () => {
    expect(head({ pattern: 'gank-timer', gankWindow: 1 })).toEqual({ key: 'gankTimer1', params: { from: '2:25', to: '3:00' } })
    expect(head({ pattern: 'gank-timer', gankWindow: 2, season: 2025 })).toEqual({ key: 'gankTimer2', params: { from: '3:15', to: '4:25' } })
    expect(head({ pattern: 'cheater-recall', recallHpPct: 80 })).toEqual({ key: 'cheaterRecall', params: { pct: 80, from: '2:35', to: '3:15' } })
    expect(head({ pattern: 'support-no-early-ward' })).toEqual({ key: 'supportNoWard', params: { clock: '1:45' } })
    expect(head({ pattern: 'jungle-late-first-recall' })).toEqual({ key: 'lateFirstRecall', params: { clock: '4:05' } })
  })
})
