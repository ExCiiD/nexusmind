/**
 * Mathematical validation of the AnomalyDetector — part 1: map coordinates,
 * win probability, garbage-time filter and the three base triggers. Every
 * threshold is tested on both sides of its boundary (the "just inside" and
 * the "just outside" case), blue side and red side.
 * Part 2 (patterns) is in anomalyDetectorMathPatterns.test.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  analyzeGame, pickMoments, DETECTOR_SPEC, MAX_MOMENTS, SUMMONERS_RIFT_MAP_ID, bountyGold, deathTimerSec, isSupportedGame, respawnTimeFactor,
  type CriticalMoment,
} from '../../src/lib/microReview/anomalyDetector'
import {
  ALLY_RADIUS, BARON_PIT, BLUE_SIDE_MAX, DRAGON_PIT, FOUNTAIN, OBJECTIVE_RADIUS, PIT_FIGHT_RADIUS, PIT_INSIDE_RADIUS, PIT_RIVER_RADIUS, RED_SIDE_MIN, WARD_RADIUS,
  dist, laneOf, nearestPit, pitCenter, tempoLineD, territoryOf, zoneOf,
} from '../../src/lib/microReview/geometry'
import {
  GARBAGE_HIGH, GARBAGE_LOW, OBJECTIVE_WEIGHT, frameClock, isGarbageTime, objectiveKindOf, winProbAt, winProbability, winProbabilityCurve, winProbabilityTrack,
} from '../../src/lib/microReview/winProbability'
import { buildGame, at } from './microReviewFixtures'
import { ROAM_THRESHOLDS } from '../../src/lib/microReview/roamLedger'
import { GANK_THRESHOLDS } from '../../src/lib/microReview/gankLedger'

type Game = ReturnType<typeof buildGame>
const run = (g: Game) => analyzeGame(g.match, g.timeline, g.selector)!
const kill = (ts: number, victimId: number, killerId: number, assists: number[] = [], position?: { x: number; y: number }) =>
  ({ type: 'CHAMPION_KILL', timestamp: ts, victimId, killerId, assistingParticipantIds: assists, ...(position ? { position } : {}) })
const epic = (ts: number, team: 100 | 200, monsterType = 'DRAGON', position = DRAGON_PIT) =>
  ({ type: 'ELITE_MONSTER_KILL', timestamp: ts, killerId: team === 200 ? 9 : 4, killerTeamId: team, monsterType, position })
/** `owner`: the team that LOSES the building (Riot's BUILDING_KILL.teamId). */
const tower = (ts: number, owner: 100 | 200, killerId: number) => ({ type: 'BUILDING_KILL', timestamp: ts, teamId: owner, killerId, buildingType: 'TOWER_BUILDING' })
const ward = (ts: number, creatorId: number) => ({ type: 'WARD_PLACED', timestamp: ts, creatorId, wardType: 'YELLOW_TRINKET' })
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))
/** Adds `lead` gold to one blue player from frame `from` on (blue − red gold difference = lead). */
const blueLead = (g: Game, from: number, lead: number) => { for (const f of g.timeline.info.frames.slice(from)) f.participantFrames['3'].totalGold += lead }

describe('spec constants', () => {
  it('map geometry', () => {
    expect(BARON_PIT).toEqual({ x: 5007, y: 10471 })
    expect(DRAGON_PIT).toEqual({ x: 9866, y: 4414 })
    expect(OBJECTIVE_RADIUS).toBe(2800)
    expect(ALLY_RADIUS).toBe(2500)
    expect(WARD_RADIUS).toBe(3500)
    expect(BLUE_SIDE_MAX).toBe(14500)
    expect(RED_SIDE_MIN).toBe(15500)
    expect(PIT_FIGHT_RADIUS).toBe(3000)
    expect(PIT_INSIDE_RADIUS).toBe(900)
    expect(PIT_RIVER_RADIUS).toBe(1500)
    expect(FOUNTAIN).toEqual({ 100: { x: 400, y: 450 }, 200: { x: 14400, y: 14400 } })
    expect(SUMMONERS_RIFT_MAP_ID).toBe(11)
  })
  it('detector thresholds match the briefs', () => {
    expect(DETECTOR_SPEC).toEqual({
      maxMoments: 3,
      minSpacingSec: 25,
      death: { windowSec: 90, wpDrop: 0.05, allyRadius: 2500, sameFightSec: 10, wardLookbackSec: 60, ownPlaySec: 35, hpSnapshotMinAgeSec: 10 },
      absent: { wardRadius: 3500, wardLookbackSec: 90, crossMapSec: 60, deadBeforeSec: 110, accountableFromSec: 300 },
      early: { atSec: 600, csDiff: -15, xpDiff: -400, takedowns: 2 },
      hesitation: { notInPitSec: 30, moveFromSec: 25, approachMin: 1200, crossMapBeforeSec: 40, crossMapAfterSec: 15, towerGreedSec: 75, inPositionRadius: 4500, estimatedFarSec: 20 },
      soloQLaning: { untilSec: 840, roles: ['TOP', 'MIDDLE', 'BOTTOM'] },
      jungle: {
        fromSec: 115, toSec: 480, overchaseSec: 20, sampleSec: 5, counterTempoXp: 150, riverPlaySec: [160, 220], backAtSec: 265, passiveBotLead: 250,
        homeSamplesSec: [85, 145, 175, 205], quietUntilSec: 205, passiveAtSec: 160, startAtSec: 85, counterTempoAtSec: 235,
      },
      tempoLine: { fromSec: 900, alliesHigh: 0.55, userBase: 0.15, userFront: 0.65, alliesHome: 0.30, minAllies: 3, goldBefore: 1500, goldLookbackSec: 30, fightWindowSec: 30, aliveBeforeSec: 60 },
      gank: { window1: [110, 145], window2: [160, 230], deepWardLifetimeSec: 150 },
      tempoWindow: { fromSec: 115, untilSec: 720, distance: 8000, windowSec: 45, respawnGraceSec: 20 },
      carry: { bounty: 450, kda: 4, goldShare: 0.25, enemies: 3, fightRadius: 2500, lostWithinSec: 60, firstDeathSec: 10 },
      rotation: { untilSec: 840, awaySec: 30, cs: 8, xp: 350, deathGuardSec: 45 },
      // #45 D5: pit fights from 15:00, the Herald's spawn.
      pit: { fromSec: 900, fightRadius: 3000, insideRadius: 900, beforeSec: 15, fightGapSec: 20 },
      // Plates stay up after 14:00, so the plate-bound rules run to 20:00.
      midRoam: { untilSec: 1200, plates: 1, cs: 10, minOffAxis: 2600 },
      // Mid roam ledger (26/11/2026), delivered silently: boundaries in microReviewRoam.test.ts.
      gankLedger: { enabled: false, ...GANK_THRESHOLDS },
      roam: { enabled: false, enabledRoles: { TOP: false, BOTTOM: false, UTILITY: false }, ...ROAM_THRESHOLDS },
      // V5 (laning phase) — boundaries tested in microReviewV5.test.ts.
      dive: { untilSec: 1200, turretRadius: 850, afterKillSec: 4 },
      levelSpike: { untilSec: 235, windowSec: 10, levels: [2, 3] },
      backTimer: { untilSec: 600, hpPct: 35, gold: 800, withinSec: 40 },
      rangeMelee: { untilSec: 480, rangedHp: 60, rangedMaxLevel: 3, meleeHp: 50, meleeMaxLevel: 4, opponentHp: 85 },
      cheaterRecall: { visitSec: [120, 160], anchorSec: 120, hpBeforeSec: 120, hpPct: 75, levelAtSec: 240, levelDeficit: 1, teleportSpellId: 12 },
      // V6 (roles) — boundaries tested in microReviewV6.test.ts.
      supportEarly: { wardBySec: 70, deathFromSec: 90, deathToSec: 125 },
      teamReset: { untilSec: 840, lookbackSec: 15, alliesHome: 2 },
      tradeRecall: { untilSec: 840, hpPct: 40, opponentHpPct: 60, beforeSpawnSec: 35, channelSec: 8, returnSec: 30, visitGapSec: 30 },
      adcReopen: { fromSec: 840, walkSec: 45, withinSec: 45 },
      baronRecall: { kda: 3, goldSpent: 10000, alliesForward: 3, alliesDown: 2, fightWindowSec: 30, awayBeforeSec: 30, awayAfterSec: 15 },
      inhibDive: { withinSec: 15 },
      spawns: { firstDragonSec: 300, dragonRespawnSec: 300, grubsSec: 480, heraldSec: 900, baronSec: 1200, baronRespawnSec: 360, elderAfterSoulSec: 360, elderRespawnSec: 360, soulDragons: 4 },
      // V7–V10 (jungle, mid, engage support) — boundaries tested in microReviewV7.test.ts.
      jungleFirstBack: { bySec: 210, startSec: 60 },
      gankCost: { fromSec: 120, untilSec: 720, cs: 8, enemyRadius: 2500 },
      campsStolen: { cs: 8, fromSec: 120, weakSideUntilSec: 960, supportUntilSec: 1080, wardLookbackSec: 120 },
      invadeDeath: { untilSec: 960, noTakedownSec: 30, campCs: 4, maxAllies: 1, midRadius: 2500 },
      dragonTank: { fromSec: 300, untilSec: 720, damageShare: 0.6 },
      compensation: { windowSec: 15, allyRadius: 3000, outnumberedBy: 2, objectiveWithinSec: 60 },
      earlyBoots: { untilSec: 480, itemId: 1001 },
      sideTower: { fromSec: 0, untilSec: 1200 },
      // #45 D2: Herald 15:00-19:45, the eye gone by 22:00 in 95 % of cached games.
      heraldEye: { fromSec: 900, untilSec: 1320, itemId: 3513, pickupSec: 20 },
      fledInvade: { untilSec: 900, hpPct: 15, enemyHpPct: 70, radius: 2000, aliveSec: 15, campCs: 4 },
      outsmite: { pitRadius: 900 },
      aheadOfWave: { untilSec: 720, afterBaseSec: 45, startSec: 60 },
      resetTrap: { untilSec: 720, lowPct: 30, stayedSec: 45, withinSec: 90, manaPoolMin: 200 },
      midWaveLoss: { atSec: 360, csDiff: -12, takedowns: 2 },
      supportLeech: { fromSec: 540, untilSec: 900, level: 6, radius: 2000, snapshots: 6, kp: 0.45 },
      supportScuttle: { fromSec: 170, untilSec: 195, radius: 2000 },
    })
    expect(MAX_MOMENTS).toBe(3)
    expect([GARBAGE_LOW, GARBAGE_HIGH]).toEqual([0.18, 0.85])
  })
})

describe('coordinates (X/Y)', () => {
  it('distance is Euclidean and symmetric', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(dist({ x: 5007, y: 10471 }, { x: 5007 + 2800, y: 10471 })).toBe(2800)
    expect(dist(BARON_PIT, DRAGON_PIT)).toBeCloseTo(Math.hypot(9866 - 5007, 4414 - 10471), 10)
    expect(dist(BARON_PIT, DRAGON_PIT)).toBe(dist(DRAGON_PIT, BARON_PIT))
  })
  it('territory flips exactly at x+y = 14500 and 15500', () => {
    // 14499 → blue half, 14500 and 15500 → river band, 15501 → red half.
    expect(territoryOf({ x: 7250, y: 7249 }, 100)).toBe('own')
    expect(territoryOf({ x: 7250, y: 7250 }, 100)).toBe('river')
    expect(territoryOf({ x: 7750, y: 7750 }, 100)).toBe('river')
    expect(territoryOf({ x: 7750, y: 7751 }, 100)).toBe('enemy')
    // Mirrored for the red team.
    expect(territoryOf({ x: 7250, y: 7249 }, 200)).toBe('enemy')
    expect(territoryOf({ x: 7250, y: 7250 }, 200)).toBe('river')
    expect(territoryOf({ x: 7750, y: 7751 }, 200)).toBe('own')
  })
  it('both pits are neutral ground for both teams, 1500 units around their centre', () => {
    // By x+y alone the dragon pit centre (14280) would be the blue half and the Baron pit (15478) the river band.
    for (const team of [100, 200] as const) {
      expect(territoryOf(DRAGON_PIT, team)).toBe('river')
      expect(territoryOf(BARON_PIT, team)).toBe('river')
    }
    // 1500 units below the dragon pit centre is still the pit; one more unit is the blue half again.
    expect(territoryOf({ x: DRAGON_PIT.x, y: DRAGON_PIT.y - 1500 }, 100)).toBe('river')
    expect(territoryOf({ x: DRAGON_PIT.x, y: DRAGON_PIT.y - 1501 }, 100)).toBe('own')
    expect(territoryOf({ x: DRAGON_PIT.x, y: DRAGON_PIT.y - 1501 }, 200)).toBe('enemy')
    // Same above the Baron pit, toward the red half.
    expect(territoryOf({ x: BARON_PIT.x, y: BARON_PIT.y + 1500 }, 200)).toBe('river')
    expect(territoryOf({ x: BARON_PIT.x, y: BARON_PIT.y + 1501 }, 200)).toBe('own')
    expect(territoryOf({ x: BARON_PIT.x, y: BARON_PIT.y + 1501 }, 100)).toBe('enemy')
  })
  it('lane corridors: edges at 2200 / 12800, mid diagonal |x−y| < 1700', () => {
    expect(laneOf({ x: 2199, y: 8000 })).toBe('TOP')
    expect(laneOf({ x: 2200, y: 8000 })).toBe('JUNGLE')
    expect(laneOf({ x: 8000, y: 12801 })).toBe('TOP')
    expect(laneOf({ x: 8000, y: 12800 })).toBe('JUNGLE')
    expect(laneOf({ x: 8000, y: 2199 })).toBe('BOT')
    expect(laneOf({ x: 8000, y: 2200 })).toBe('JUNGLE')
    expect(laneOf({ x: 12801, y: 8000 })).toBe('BOT')
    expect(laneOf({ x: 12800, y: 8000 })).toBe('JUNGLE')
    expect(laneOf({ x: 7000, y: 8699 })).toBe('MID')
    expect(laneOf({ x: 7000, y: 8700 })).toBe('JUNGLE')
    // Both base corners are the ends of the mid diagonal.
    expect(laneOf({ x: 1000, y: 1000 })).toBe('MID')
    expect(laneOf({ x: 14000, y: 14000 })).toBe('MID')
  })
  it('zones are named from the player\'s side', () => {
    expect(zoneOf({ x: 500, y: 500 }, 100)).toBe('own-base')
    expect(zoneOf({ x: 500, y: 500 }, 200)).toBe('enemy-base')
    expect(zoneOf({ x: 14300, y: 14300 }, 200)).toBe('own-base')
    expect(zoneOf(BARON_PIT, 100)).toBe('top-river')
    expect(zoneOf(BARON_PIT, 200)).toBe('top-river')
    expect(zoneOf(DRAGON_PIT, 200)).toBe('bot-river')
    // A jungle point of the blue half, away from the river band and from both pits.
    const p = { x: 3000, y: 10400 }
    expect(Math.abs(p.x + p.y - 15000)).toBeGreaterThan(1500)
    expect(nearestPit(p).distance).toBeGreaterThan(1500)
    expect(zoneOf(p, 100)).toBe('own-jungle')
    expect(zoneOf(p, 200)).toBe('enemy-jungle')
    // River band for naming: |x+y − 15000| ≤ 1500.
    expect(zoneOf({ x: 3600, y: 9900 }, 100)).toBe('top-river')
    expect(zoneOf({ x: 11000, y: 5500 }, 100)).toBe('bot-river')
  })
  it('nearest pit and pit centres', () => {
    expect(nearestPit(BARON_PIT)).toEqual({ pit: 'baron', distance: 0 })
    expect(nearestPit(DRAGON_PIT)).toEqual({ pit: 'dragon', distance: 0 })
    expect(nearestPit({ x: 7436, y: 7443 }).pit).toBe('baron') // 1 unit closer to Baron than the midpoint
    expect(pitCenter('baron')).toBe(BARON_PIT)
    expect(pitCenter('dragon')).toBe(DRAGON_PIT)
  })
  it('tempo line: D = (x+y)/30000 for blue, 1 − D for red', () => {
    expect(tempoLineD({ x: 0, y: 0 }, 100)).toBe(0)
    expect(tempoLineD({ x: 15000, y: 15000 }, 100)).toBe(1)
    expect(tempoLineD({ x: 7500, y: 7500 }, 100)).toBe(0.5)
    expect(tempoLineD({ x: 9000, y: 7500 }, 100)).toBe(0.55)
    expect(tempoLineD({ x: 0, y: 0 }, 200)).toBe(1)
    expect(tempoLineD({ x: 15000, y: 15000 }, 200)).toBe(0)
    expect(tempoLineD({ x: 9000, y: 7500 }, 200)).toBeCloseTo(0.45, 12)
    // A fountain is at the bottom of its own line on both sides.
    expect(tempoLineD({ x: 400, y: 400 }, 100)).toBeCloseTo(tempoLineD({ x: 14600, y: 14600 }, 200), 12)
  })
})

describe('win probability', () => {
  it('is the sigmoid of 0.0075·ΔGold/t + 0.004·ΔXP/t + 0.28·ΔObj', () => {
    for (const [g, x, o, t] of [[4000, 3000, 0, 20], [-2500, 800, 1, 12], [0, 0, -2, 30], [1200, -600, 0.5, 7], [9000, 7000, 4, 35]] as const) {
      expect(winProbability(g, x, o, t)).toBeCloseTo(sigmoid((0.0075 * g) / t + (0.004 * x) / t + 0.28 * o), 12)
    }
  })
  it('hand-computed values', () => {
    expect(winProbability(0, 0, 0, 20)).toBe(0.5)
    expect(winProbability(4000, 3000, 0, 20)).toBeCloseTo(0.890903, 6) // z = 1.5 + 0.6 = 2.1
    expect(winProbability(0, 0, 1, 20)).toBeCloseTo(0.569546, 6) // z = 0.28
    expect(winProbability(0, 0, -2, 20)).toBeCloseTo(0.363547, 6) // z = −0.56
  })
  it('is antisymmetric: P(−lead) = 1 − P(lead)', () => {
    for (const [g, x, o, t] of [[3200, 1500, 1, 18], [800, -200, -0.5, 9]] as const) {
      expect(winProbability(-g, -x, -o, t)).toBeCloseTo(1 - winProbability(g, x, o, t), 12)
    }
  })
  it('is strictly increasing in gold, XP and objectives', () => {
    expect(winProbability(1001, 0, 0, 20)).toBeGreaterThan(winProbability(1000, 0, 0, 20))
    expect(winProbability(0, 1001, 0, 20)).toBeGreaterThan(winProbability(0, 1000, 0, 20))
    expect(winProbability(0, 0, 0.3, 20)).toBeGreaterThan(winProbability(0, 0, 0, 20))
  })
  it('weighs leads per minute, with time floored at 5 minutes', () => {
    expect(winProbability(1000, 500, 0, 2)).toBe(winProbability(1000, 500, 0, 5))
    expect(winProbability(1000, 500, 0, 5)).toBeGreaterThan(winProbability(1000, 500, 0, 10))
    // Objectives do not decay with time.
    expect(winProbability(0, 0, 2, 5)).toBe(winProbability(0, 0, 2, 40))
  })
  it('objective weights', () => {
    expect(OBJECTIVE_WEIGHT).toEqual({ tower: 1, inhibitor: 1.5, dragon: 1, elder: 2.5, herald: 0.5, grubs: 0.3, baron: 2 })
    expect(objectiveKindOf({ type: 'ELITE_MONSTER_KILL', monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON' })).toBe('dragon')
    expect(objectiveKindOf({ type: 'ELITE_MONSTER_KILL', monsterType: 'BARON_NASHOR' })).toBe('baron')
    expect(objectiveKindOf({ type: 'ELITE_MONSTER_KILL', monsterType: 'RIFTHERALD' })).toBe('herald')
    expect(objectiveKindOf({ type: 'ELITE_MONSTER_KILL', monsterType: 'ATAKHAN' })).toBeNull()
    expect(objectiveKindOf({ type: 'BUILDING_KILL', buildingType: 'TOWER_BUILDING' })).toBe('tower')
    expect(objectiveKindOf({ type: 'ELITE_MONSTER_KILL', monsterType: 'SCUTTLE' })).toBeNull()
  })
  it('curve: per-frame value, rounded to 3 decimals, from each team\'s point of view', () => {
    const g = buildGame({ minutes: 20, me: 1 })
    blueLead(g, 10, 2000)
    const teamOf = (id: number) => (id <= 5 ? 100 : 200)
    const blue = winProbabilityCurve(g.timeline.info.frames, teamOf, 100)
    const red = winProbabilityCurve(g.timeline.info.frames, teamOf, 200)
    expect(blue[9]).toBe(0.5)
    for (const i of [10, 15, 20]) {
      const expected = Math.round(sigmoid((0.0075 * 2000) / i) * 1000) / 1000
      expect(blue[i]).toBe(expected)
      expect(red[i]).toBeCloseTo(1 - expected, 3)
    }
    expect(blue).toHaveLength(21)
  })
  it('curve: objectives count from the snapshot that closes their minute', () => {
    const g = buildGame({ minutes: 12, me: 1, events: [
      epic(at(4, 30), 200), // enemy dragon → −1
      tower(at(6, 10), 200, 1), // enemy tower destroyed → +1
      tower(at(8, 10), 100, 6), // our tower lost → −1
      { type: 'ELITE_MONSTER_KILL', timestamp: at(10, 5), killerId: 2, monsterType: 'BARON_NASHOR' }, // no killerTeamId: falls back on the killer's team → +2
    ] })
    const curve = winProbabilityCurve(g.timeline.info.frames, (id) => (id <= 5 ? 100 : 200), 100)
    const p = (obj: number) => Math.round(sigmoid(0.28 * obj) * 1000) / 1000
    expect(curve[4]).toBe(0.5)
    expect(curve[5]).toBe(p(-1))
    expect(curve[7]).toBe(p(0))
    expect(curve[9]).toBe(p(-1))
    expect(curve[11]).toBe(p(1))
  })
  it('winProbAt reads the last snapshot at or before the action', () => {
    const curve = [0.5, 0.6, 0.7]
    expect(winProbAt(curve, 0)).toBe(0.5)
    expect(winProbAt(curve, 59_999)).toBe(0.5)
    expect(winProbAt(curve, 60_000)).toBe(0.6)
    expect(winProbAt(curve, 10 * 60_000)).toBe(0.7) // clamped to the last frame
    expect(winProbAt([], 1000)).toBeNull()
  })
})

describe('timeline clock and exact-time win probability', () => {
  const teamOf = (id: number) => (id <= 5 ? 100 : 200)
  it('frame i is minute i (Riot drifts by a few ms); the last frame is the end of the game', () => {
    const frames = Array.from({ length: 32 }, (_, i) => ({ timestamp: i * 60_000 + i * 23 }))
    frames[31].timestamp = at(30, 23) // game over at 30:23
    const c = frameClock(frames)
    expect([c.last, c.endMs]).toEqual([31, 1_823_000])
    expect([c.ts(0), c.ts(30), c.ts(31)]).toEqual([0, 1_800_000, 1_823_000])
    expect(c.indexAt(1_799_999)).toBe(29)
    expect(c.indexAt(1_800_000)).toBe(30)
    expect(c.indexAt(1_822_999)).toBe(30)
    expect(c.indexAt(1_823_000)).toBe(31)
    expect(c.indexAt(-5)).toBe(0)
    // A final frame that falls on the minute is an ordinary one.
    const even = frameClock(Array.from({ length: 11 }, (_, i) => ({ timestamp: i * 60_000 })))
    expect([even.last, even.endMs, even.indexAt(599_999), even.indexAt(600_000), even.indexAt(700_000)]).toEqual([10, 600_000, 9, 10, 10])
  })
  it('objectives move P(win) at their exact time; "before" excludes the action itself', () => {
    // Enemy dragon at 4:30 (−1), then an enemy tower destroyed at 4:45 (+1): back to even.
    const g = buildGame({ minutes: 12, me: 1, events: [epic(at(4, 30), 200), tower(at(4, 45), 200, 1)] })
    const track = winProbabilityTrack(g.timeline.info.frames, teamOf, 100)
    expect(track.before(at(4, 30))).toBe(0.5)
    expect(track.at(at(4, 30))).toBeCloseTo(sigmoid(-0.28), 12)
    expect(track.before(at(4, 45))).toBeCloseTo(sigmoid(-0.28), 12)
    expect(track.at(at(4, 45))).toBe(0.5)
    // The snapshots only see the net result.
    expect([track.curve[4], track.curve[5]]).toEqual([0.5, 0.5])
    // From the red team's side the same dragon is +1.
    expect(winProbabilityTrack(g.timeline.info.frames, teamOf, 200).at(at(4, 30))).toBeCloseTo(sigmoid(0.28), 12)
  })
  it('gold and XP only move at the snapshots', () => {
    const g = buildGame({ minutes: 12, me: 1 })
    blueLead(g, 5, 2000)
    const track = winProbabilityTrack(g.timeline.info.frames, teamOf, 100)
    expect(track.at(at(5) - 1)).toBe(0.5)
    expect(track.at(at(5))).toBeCloseTo(sigmoid((0.0075 * 2000) / 5), 12)
    expect(track.at(at(5, 59))).toBeCloseTo(sigmoid((0.0075 * 2000) / 5), 12)
    expect(track.at(at(6))).toBeCloseTo(sigmoid((0.0075 * 2000) / 6), 12)
    // The stored curve is the same estimate, rounded to 3 decimals.
    expect(track.curve[5]).toBe(Math.round(track.at(at(5))! * 1000) / 1000)
    expect(track.curve).toEqual(winProbabilityCurve(g.timeline.info.frames, teamOf, 100))
  })
  it('an empty timeline has no estimate', () => {
    const track = winProbabilityTrack([], teamOf, 100)
    expect([track.curve, track.before(0), track.at(60_000)]).toEqual([[], null, null])
  })
  it('positions in the last, partial minute use the real end of the game', () => {
    // Game over at 20:23. Ally 3 walks from (3000, 3000) at 20:00 to (9000, 3000) at 20:23:
    // at 20:10 it is at x = 3000 + 6000·10/23 = 5609, i.e. 2291 units from the player's death.
    const g = buildGame({ minutes: 21, me: 1, frame: (i, pid) => (pid === 3 && i === 21 ? { position: { x: 9000, y: 3000 } } : undefined),
      events: [kill(at(20, 10), 1, 8, [9], { x: 7900, y: 3000 }), tower(at(20, 20), 100, 8)] })
    g.timeline.info.frames[21].timestamp = at(20, 23)
    expect(run(g).moments[0].facts.alliesNearby).toBe(1)
    // Read as a full minute, the same ally would be at x = 4000 — 3900 units away.
    g.timeline.info.frames[21].timestamp = at(21)
    expect(run(g).moments[0].facts.alliesNearby).toBe(0)
  })
})

describe('supported games', () => {
  it('Summoner\'s Rift in classic mode only', () => {
    const g = buildGame({ minutes: 20, me: 1, events: [epic(at(15, 30), 200)] })
    const withInfo = (info: Record<string, unknown>) => analyzeGame({ info: { ...g.match.info, ...info } }, g.timeline, g.selector)
    expect(withInfo({ mapId: 11, gameMode: 'CLASSIC' })!.moments).toHaveLength(1)
    expect(withInfo({ mapId: 12, gameMode: 'ARAM' })).toBeNull()
    expect(withInfo({ mapId: 30, gameMode: 'CHERRY' })).toBeNull()
    expect(withInfo({ mapId: 11, gameMode: 'URF' })).toBeNull()
    expect(withInfo({ mapId: 11, gameMode: 'SWIFTPLAY' })).toBeNull()
    // A payload without these fields is not rejected for it.
    expect(isSupportedGame({ info: {} })).toBe(true)
    expect(isSupportedGame(null)).toBe(true)
  })
  it('needs the player and at least two frames', () => {
    const g = buildGame({ minutes: 20, me: 1 })
    expect(analyzeGame(g.match, g.timeline, { puuids: ['nobody'] })).toBeNull()
    expect(analyzeGame(g.match, { info: { frames: g.timeline.info.frames.slice(0, 1) } }, g.selector)).toBeNull()
    expect(analyzeGame(g.match, {}, g.selector)).toBeNull()
  })
})

describe('respawn timer', () => {
  it('base wait by level, clamped to 1–18: the wiki table', () => {
    const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
    expect(levels.map((l) => deathTimerSec(l, 10)))
      .toEqual([10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5])
    expect([deathTimerSec(0, 5), deathTimerSec(25, 5)]).toEqual([10, 52.5])
  })
  it('the wiki examples (Death, read 19/11/2026)', () => {
    expect(deathTimerSec(6, 10)).toBe(16)
    expect(deathTimerSec(11, 20)).toBeCloseTo(35 * 1.0425, 10) // ~36.5 s
    expect(deathTimerSec(14, 25)).toBeCloseTo(42.5 * 1.085, 10) // ~46 s
    expect(deathTimerSec(18, 35)).toBeCloseTo(52.5 * 1.1575, 10) // ~60.8 s
    expect(deathTimerSec(18, 55)).toBe(78.75)
  })
  it('grows with game time from 15:00, by 30 s steps, up to +50 %', () => {
    expect(respawnTimeFactor(14.99)).toBe(0)
    expect(respawnTimeFactor(15)).toBe(0)
    expect(respawnTimeFactor(15.01)).toBeCloseTo(0.00425, 12)
    expect(respawnTimeFactor(20)).toBeCloseTo(10 * 0.00425, 12)
    expect(respawnTimeFactor(29.99)).toBeCloseTo(0.1275, 12)
    expect(respawnTimeFactor(30)).toBeCloseTo(0.1275, 12)
    expect(respawnTimeFactor(36.5)).toBeCloseTo(0.1275 + 13 * 0.003, 12)
    expect(respawnTimeFactor(45)).toBeCloseTo(0.2175, 12)
    expect(respawnTimeFactor(50)).toBeCloseTo(0.2175 + 10 * 0.0145, 12)
    expect(respawnTimeFactor(54.9)).toBe(0.5)
    expect(respawnTimeFactor(70)).toBe(0.5)
    expect(deathTimerSec(16, 30)).toBeCloseTo(47.5 * 1.1275, 10)
    expect(deathTimerSec(18, 60)).toBe(78.75)
  })
})

describe('garbage-time filter', () => {
  it('is strict: P < 0.18 or P > 0.85', () => {
    expect(isGarbageTime(0.18)).toBe(false)
    expect(isGarbageTime(0.1799)).toBe(true)
    expect(isGarbageTime(0.85)).toBe(false)
    expect(isGarbageTime(0.8501)).toBe(true)
    expect(isGarbageTime(0.5)).toBe(false)
    expect(isGarbageTime(null)).toBe(false)
    expect(isGarbageTime(undefined)).toBe(false)
  })

  // A death at 20:30 that costs a dragon 20 s later: kept unless P(win) at 20:00 is garbage.
  const scenario = (lead: number) => {
    const g = buildGame({ minutes: 24, me: 1, events: [kill(at(20, 30), 1, 8, [], { x: 5000, y: 5000 }), epic(at(20, 50), 200)] })
    blueLead(g, 20, lead)
    return g
  }
  it('85 % boundary, on the unrounded probability: 0.84997 is kept, 0.85002 is garbage', () => {
    // sigmoid(0.0075·L/20) = 0.85 at L = 4625.6: both leads below are stored as 0.850 in the curve.
    expect(winProbability(4625, 0, 0, 20)).toBeLessThan(GARBAGE_HIGH)
    expect(winProbability(4626, 0, 0, 20)).toBeGreaterThan(GARBAGE_HIGH)
    const edge = run(scenario(4625))
    expect(edge.winProb[20]).toBe(0.85)
    expect(edge.moments.map((m) => m.trigger)).toContain('critical-death')
    expect(edge.moments[0].winProbBefore).toBe(0.85)
    expect(edge.garbageDiscarded).toBe(0)
    const over = run(scenario(4626))
    expect(over.winProb[20]).toBe(0.85)
    expect(over.moments).toHaveLength(0)
    expect(over.garbageDiscarded).toBe(1)
  })
  it('18 % boundary, on the unrounded probability: 0.18003 is kept, 0.17998 is garbage', () => {
    // sigmoid(0.0075·L/20) = 0.18 at L = −4043.6.
    expect(winProbability(-4043, 0, 0, 20)).toBeGreaterThan(GARBAGE_LOW)
    expect(winProbability(-4044, 0, 0, 20)).toBeLessThan(GARBAGE_LOW)
    const edge = run(scenario(-4043))
    expect(edge.winProb[20]).toBe(0.18)
    expect(edge.moments.map((m) => m.trigger)).toContain('critical-death')
    const under = run(scenario(-4044))
    expect(under.winProb[20]).toBe(0.18)
    expect(under.moments).toHaveLength(0)
    expect(under.garbageDiscarded).toBe(1)
  })
  it('counts the objectives taken since the last snapshot: P(win) just before the action, not a minute earlier', () => {
    // 20:00 → 0.5. Our team takes Baron + 2 dragons + 2 towers by 20:20 (ΔObj = +6 → 0.843): a death at 20:30 still counts…
    const swing = (extra: any[]) => buildGame({ minutes: 24, me: 1, events: [
      epic(at(20, 5), 100, 'BARON_NASHOR', BARON_PIT), epic(at(20, 10), 100), epic(at(20, 12), 100), tower(at(20, 15), 200, 3), tower(at(20, 20), 200, 3),
      ...extra, kill(at(20, 30), 1, 8, [], { x: 5000, y: 5000 }), tower(at(20, 50), 100, 8)] })
    const kept = run(swing([]))
    expect(kept.moments.map((m) => m.trigger)).toEqual(['critical-death'])
    expect(kept.moments[0].winProbBefore).toBe(0.843)
    // …one more tower (ΔObj = +7 → 0.877) and the same death is garbage time, although the 20:00 snapshot says 0.5.
    const over = run(swing([tower(at(20, 25), 200, 3)]))
    expect(over.winProb[20]).toBe(0.5)
    expect(over.moments).toHaveLength(0)
    expect(over.garbageDiscarded).toBe(1)
  })
  it('uses P(win) BEFORE the action: a lead that appears after the death does not hide it', () => {
    const g = buildGame({ minutes: 24, me: 1, events: [kill(at(20, 30), 1, 8, [], { x: 5000, y: 5000 }), epic(at(20, 50), 200)] })
    blueLead(g, 21, -9000)
    expect(run(g).moments.map((m) => m.trigger)).toContain('critical-death')
  })
  it('also filters enemy objectives and the 10:00 check', () => {
    const dragon = buildGame({ minutes: 20, me: 1, events: [epic(at(15, 30), 200)] })
    expect(run(dragon).moments.map((m) => m.trigger)).toEqual(['absent-objective'])
    blueLead(dragon, 15, 9000)
    const filtered = run(dragon)
    expect(filtered.moments).toHaveLength(0)
    expect(filtered.garbageDiscarded).toBe(1)

    const lane = buildGame({ minutes: 14, me: 1, frame: (i, pid) => (i === 10 && pid === 1 ? { minionsKilled: 40 } : undefined) })
    expect(run(lane).moments.map((m) => m.trigger)).toEqual(['early-deficit'])
    blueLead(lane, 10, -6000)
    expect(run(lane).moments).toHaveLength(0)
  })
})

describe('trigger 1 — critical death', () => {
  const death = (extra: any[] = [], frame?: (i: number, pid: number) => any) =>
    buildGame({ minutes: 20, me: 1, frame, events: [kill(at(12), 1, 8, [9], { x: 5000, y: 5000 }), ...extra] })

  it('needs a consequence: nothing happens → no moment', () => {
    expect(run(death()).moments).toHaveLength(0)
  })
  it('objective lost within 90 s inclusive', () => {
    const inside = run(death([tower(at(12) + 90_000, 100, 8)])).moments[0]
    expect(inside.facts).toMatchObject({ objectiveLost: 'tower', objectiveLostAfterSec: 90 })
    // 1 ms later the tower is out of the window: it is neither "lost within 90 s" nor part of the 90 s win-probability swing.
    expect(run(death([tower(at(12) + 90_001, 100, 8)])).moments).toHaveLength(0)
  })
  it('an objective lost BEFORE the death is not its consequence', () => {
    // Enemy Baron at 12:05, death at 12:50, nothing afterwards: the Baron did not follow the death.
    const g = buildGame({ minutes: 20, me: 1, events: [epic(at(12, 5), 200, 'BARON_NASHOR', BARON_PIT), kill(at(12, 50), 1, 8, [9], { x: 1500, y: 1500 })] })
    expect(run(g).moments.filter((m) => m.trigger === 'critical-death')).toHaveLength(0)
    // The same Baron 5 s after the death is.
    const after = buildGame({ minutes: 20, me: 1, events: [kill(at(12, 50), 1, 8, [9], { x: 1500, y: 1500 }), epic(at(12, 55), 200, 'BARON_NASHOR', BARON_PIT)] })
    expect(run(after).moments[0]).toMatchObject({ trigger: 'critical-death', facts: { objectiveLost: 'baron', objectiveLostAfterSec: 5 } })
  })
  it('prefers the heaviest objective lost in the window', () => {
    const m = run(death([tower(at(12, 20), 100, 8), epic(at(12, 50), 200, 'BARON_NASHOR', BARON_PIT)])).moments[0]
    expect(m.facts.objectiveLost).toBe('baron')
  })
  it('win-probability drop of 0.05 or more between the death and +90 s', () => {
    // Death at 12:00 → before = the 12:00 snapshot, after = the last snapshot inside the 90 s window (13:00).
    // sigmoid(−0.0075·L/13) = 0.45 at L = 347.8: 348 → drop 0.05002 (kept), 347 → 0.04988 (not), both stored as 0.450.
    const withLead = (enemyLead: number) => { const g = death(); blueLead(g, 13, -enemyLead); return run(g) }
    expect(0.5 - winProbability(-348, 0, 0, 13)).toBeGreaterThan(0.05)
    expect(0.5 - winProbability(-347, 0, 0, 13)).toBeLessThan(0.05)
    const kept = withLead(348)
    expect(kept.winProb[12]).toBe(0.5)
    expect(kept.winProb[13]).toBe(0.45)
    expect(kept.moments).toHaveLength(1)
    expect(kept.moments[0]).toMatchObject({ trigger: 'critical-death', winProbBefore: 0.5, winProbAfter: 0.45 })
    const notEnough = withLead(347)
    expect(notEnough.winProb[13]).toBe(0.45)
    expect(notEnough.moments).toHaveLength(0)
  })
  it('the swing is read inside the 90 s window: a snapshot taken after it does not count', () => {
    // Death at 12:29.999 → window ends at 13:59.999 → last snapshot inside = 13:00. A collapse first seen at 14:00 is out…
    const lateSwing = (deathMs: number) => { const g = buildGame({ minutes: 20, me: 1, events: [kill(deathMs, 1, 8, [9], { x: 5000, y: 5000 })] }); blueLead(g, 14, -5000); return run(g) }
    expect(lateSwing(at(12, 30) - 1).moments).toHaveLength(0)
    // …and in for a death at 12:30.000, whose window reaches the 14:00 snapshot.
    expect(lateSwing(at(12, 30)).moments.map((m) => m.trigger)).toEqual(['critical-death'])
  })
  it('counts allies within 2500 units, inclusive', () => {
    const allyAt = (x: number) => run(death([tower(at(12, 30), 100, 8)], (_i, pid) => (pid === 3 ? { position: { x, y: 5000 } } : undefined))).moments[0].facts.alliesNearby
    expect(allyAt(7500)).toBe(1)
    expect(allyAt(7501)).toBe(0)
  })
  it('an ally counts as nearby when alive there, or fallen in the same fight (the 10 s before)', () => {
    // Ally 3 dies 500 units from where the player will die; its snapshots still say (3000, 3000).
    const allyFell = (msBefore: number) => run(death([tower(at(12, 30), 100, 8), kill(at(12) - msBefore, 3, 9, [], { x: 5500, y: 5000 })])).moments[0].facts.alliesNearby
    expect(allyFell(10_000)).toBe(1)
    expect(allyFell(10_001)).toBe(0) // an older corpse is nobody
  })
  it('positions between two snapshots follow the events: an ally walking to its own death is on that path', () => {
    // Player dies at 12:30 at (5000, 5000). Ally 3 is at (3000, 3000) at 12:00 and dies at 12:40 at (7000, 5000):
    // at 12:30 it is 3/4 of the way, at (6000, 4500) — 1118 units from the player, not 2828.
    const g = buildGame({ minutes: 20, me: 1, events: [kill(at(12, 30), 1, 8, [9], { x: 5000, y: 5000 }), kill(at(12, 40), 3, 9, [], { x: 7000, y: 5000 }), tower(at(13), 100, 8)] })
    expect(run(g).moments[0].facts.alliesNearby).toBe(1)
  })
  it('ward in the previous 60 s, inclusive', () => {
    const wardedAt = (ts: number) => run(death([tower(at(12, 30), 100, 8), ward(ts, 1)])).moments[0].facts.wardedLast60s
    expect(wardedAt(at(12) - 60_000)).toBe(true)
    expect(wardedAt(at(12) - 60_001)).toBe(false)
    // A ward of someone else does not count.
    expect(run(death([tower(at(12, 30), 100, 8), ward(at(11, 50), 3)])).moments[0].facts.wardedLast60s).toBe(false)
  })
  it('death less than 35 s after the player\'s own kill or tower (strict)', () => {
    const after = (ms: number) => run(death([tower(at(12, 30), 100, 8), kill(at(12) - ms, 6, 1)])).moments[0].facts.secondsSinceOwnPlay
    expect(after(34_999)).toBe(35)
    expect(after(35_000)).toBeNull()
    expect(after(12_000)).toBe(12)
    // A tower taken with the player's assist counts too.
    const assist = run(death([tower(at(12, 30), 100, 8), { ...tower(at(11, 45), 200, 3), assistingParticipantIds: [1] }])).moments[0]
    expect(assist.facts.secondsSinceOwnPlay).toBe(15)
  })
  it('gold in pocket and enemies involved come from the event and the last snapshot', () => {
    const g = buildGame({ minutes: 20, me: 1, frame: (i, pid) => (i === 12 && pid === 1 ? { currentGold: 1650 } : undefined),
      events: [kill(at(12, 40), 1, 8, [9, 10], { x: 5000, y: 5000 }), tower(at(13), 100, 8)] })
    expect(run(g).moments[0].facts).toMatchObject({ goldInPocket: 1650, assisters: 2, enemiesInvolved: 3 })
    // An execution (killerId 0) only counts its assisters.
    const exec = buildGame({ minutes: 20, me: 1, events: [kill(at(12, 40), 1, 0, [9], { x: 5000, y: 5000 }), tower(at(13), 100, 8)] })
    expect(run(exec).moments[0].facts).toMatchObject({ assisters: 1, enemiesInvolved: 1 })
  })
  it('"near objective" is 2800 units from a pit, inclusive', () => {
    const near = (x: number) => run(buildGame({ minutes: 20, me: 1, events: [kill(at(12), 1, 8, [], { x, y: BARON_PIT.y }), tower(at(12, 30), 100, 8)] })).moments[0].facts
    expect(near(BARON_PIT.x + 2800)).toMatchObject({ nearObjective: true, nearestPit: 'baron', pitDistance: 2800 })
    expect(near(BARON_PIT.x + 2801)).toMatchObject({ nearObjective: false, pitDistance: 2801 })
  })
  it('level deficit against the killer and HP at the last snapshot (10 s or older)', () => {
    const g = (deathSec: number) => buildGame({ minutes: 20, me: 1,
      frame: (i, pid) => (i === 12 && pid === 1 ? { level: 6, championStats: { health: 300, healthMax: 1200 } } : i === 12 && pid === 8 ? { level: 8 } : undefined),
      events: [kill(at(12, deathSec), 1, 8, [], { x: 5000, y: 5000 }), tower(at(13, 20), 100, 8)] })
    expect(run(g(40)).moments[0].facts).toMatchObject({ levelDeficit: 2, hpPct: 25, hpSnapshotAgeSec: 40 })
    expect(run(g(10)).moments[0].facts).toMatchObject({ hpPct: 25, hpSnapshotAgeSec: 10 })
    // A snapshot taken 9 s before the death mostly shows the fight itself: HP is not reported.
    expect(run(g(9)).moments[0].facts.hpPct).toBeUndefined()
  })
  it('reads the map from a red player\'s side', () => {
    const g = buildGame({ minutes: 20, me: 6, events: [kill(at(12), 6, 3, [], { x: 3000, y: 10400 }), tower(at(12, 30), 200, 3)] })
    expect(run(g).moments[0]).toMatchObject({ trigger: 'critical-death', zone: 'enemy-jungle', territory: 'enemy' })
    expect(run(g).teamId).toBe(200)
  })
})

describe('trigger 2 — absent on objective', () => {
  const T = at(15, 30)
  // The player stands still at a known distance from the dragon pit.
  const dragon = (playerX: number, extra: any[] = []) =>
    buildGame({ minutes: 20, me: 1, frame: (_i, pid) => (pid === 1 ? { position: { x: playerX, y: DRAGON_PIT.y } } : undefined), events: [epic(T, 200), ...extra] })

  it('a ward within 3500 units of the pit, inclusive, satisfies it', () => {
    const inside = run(dragon(DRAGON_PIT.x - 3500, [ward(T - 30_000, 1)]))
    expect(inside.contested).toEqual([{ gameTimeSec: 930, kind: 'dragon', takenBy: 'enemy', playerWarded: true, accountable: true }])
    expect(inside.moments).toHaveLength(0)
    const outside = run(dragon(DRAGON_PIT.x - 3501, [ward(T - 30_000, 1)]))
    expect(outside.contested[0].playerWarded).toBe(false)
    expect(outside.moments[0]).toMatchObject({ trigger: 'absent-objective', gameTimeSec: 910, facts: { objective: 'dragon', wardsElsewhere: 1, playerDistance: 3501 } })
  })
  it('the ward must be placed in the previous 90 s, inclusive', () => {
    expect(run(dragon(DRAGON_PIT.x - 3000, [ward(T - 90_000, 1)])).moments).toHaveLength(0)
    expect(run(dragon(DRAGON_PIT.x - 3000, [ward(T - 90_001, 1)])).moments).toHaveLength(1)
    // A ward placed after the objective fell does not count.
    expect(run(dragon(DRAGON_PIT.x - 3000, [ward(T + 1, 1)])).moments).toHaveLength(1)
  })
  it('a cross-map objective or tower within ±60 s, inclusive, cancels it', () => {
    expect(run(dragon(3000, [tower(T + 60_000, 200, 3)])).moments).toHaveLength(0)
    expect(run(dragon(3000, [tower(T - 60_000, 200, 3)])).moments).toHaveLength(0)
    expect(run(dragon(3000, [tower(T + 60_001, 200, 3)])).moments.map((m) => m.trigger)).toEqual(['absent-objective'])
    // Losing a tower is not a trade.
    expect(run(dragon(3000, [tower(T + 10_000, 100, 8)])).moments.map((m) => m.trigger)).toEqual(['absent-objective'])
  })
  it('only when the player is alive: a death in the 90 s before belongs to trigger 1', () => {
    const dead = run(dragon(3000, [kill(T - 90_000, 1, 8, [], { x: 3000, y: 4414 })])).moments
    expect(dead.map((m) => m.trigger)).toEqual(['critical-death'])
    const alive = run(dragon(3000, [kill(T - 90_001, 1, 8, [], { x: 3000, y: 4414 })])).moments
    expect(alive.map((m) => m.trigger)).toContain('absent-objective')
  })
  it('an objective taken by the player\'s team is recorded as contested, never as a moment', () => {
    const a = run(buildGame({ minutes: 20, me: 1, events: [epic(T, 100)] }))
    // A top laner is not accountable for the vision of an objective their team takes.
    expect(a.contested).toEqual([{ gameTimeSec: 930, kind: 'dragon', takenBy: 'ally', playerWarded: false, accountable: false }])
    expect(a.moments).toHaveLength(0)
  })
  it('accountable for the vision: supports and junglers on every objective, laners on the ones lost', () => {
    const accountable = (me: number, team: 100 | 200, extra: any[] = [], ts = T, monster = 'DRAGON') =>
      run(buildGame({ minutes: 20, me, events: [epic(ts, team, monster, monster === 'DRAGON' ? DRAGON_PIT : BARON_PIT), ...extra] })).contested[0].accountable
    expect(accountable(1, 200)).toBe(true) // top laner, objective lost
    expect(accountable(1, 100)).toBe(false) // top laner, objective taken by the team
    expect(accountable(5, 100)).toBe(true) // support
    expect(accountable(2, 100)).toBe(true) // jungler
    // Dead in the 110 s before (inclusive): no chance to ward.
    expect(accountable(1, 200, [kill(T - 110_000, 1, 8, [], { x: 3000, y: 3000 })])).toBe(false)
    expect(accountable(1, 200, [kill(T - 110_001, 1, 8, [], { x: 3000, y: 3000 })])).toBe(true)
    // Not before 5:00, never for the Voidgrubs.
    expect(accountable(5, 200, [], at(5) - 1)).toBe(false)
    expect(accountable(5, 200, [], at(5))).toBe(true)
    expect(accountable(5, 200, [], T, 'HORDE')).toBe(false)
    expect(accountable(5, 200, [], T, 'BARON_NASHOR')).toBe(true)
  })
  it('one contest per Voidgrub pack and per side', () => {
    const grub = (ts: number, team: 100 | 200) => epic(ts, team, 'HORDE', BARON_PIT)
    // Enemy, ally, enemy within 15 s: two contests (one per side), not three.
    const a = run(buildGame({ minutes: 12, me: 1, events: [grub(at(8), 200), grub(at(8, 7), 100), grub(at(8, 14), 200)] }))
    expect(a.contested.map((c) => c.takenBy)).toEqual(['enemy', 'ally'])
    // A second pack more than 60 s later is a new contest.
    const b = run(buildGame({ minutes: 12, me: 1, events: [grub(at(8), 200), grub(at(8, 59), 200), grub(at(9), 200)] }))
    expect(b.contested).toHaveLength(2)
  })
  it('works from the red side (enemy = team 100)', () => {
    const g = buildGame({ minutes: 20, me: 6, events: [epic(T, 100)] })
    expect(run(g).moments.map((m) => m.trigger)).toEqual(['absent-objective'])
    expect(run(g).contested[0].takenBy).toBe('enemy')
  })
})

describe('trigger 3 — early deficit at 10:00', () => {
  const lane = (over: Record<string, unknown>, extra: any[] = [], me = 1) =>
    buildGame({ minutes: 14, me, frame: (i, pid) => (i === 10 && pid === me ? over : undefined), events: extra })

  it('CS: strictly under −15', () => {
    expect(run(lane({ minionsKilled: 70 - 15 })).moments).toHaveLength(0)
    const m = run(lane({ minionsKilled: 70 - 16 }))
    expect(m.moments[0]).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 600, facts: { csDiff10: -16, xpDiff10: 0 } })
    expect(m.laneAt10).toEqual({ csDiff: -16, xpDiff: 0 })
  })
  it('XP: strictly under −400', () => {
    expect(run(lane({ xp: 5000 - 400 })).moments).toHaveLength(0)
    expect(run(lane({ xp: 5000 - 401 })).moments[0].facts).toMatchObject({ xpDiff10: -401, csDiff10: 0 })
  })
  it('jungle camps count as CS', () => {
    expect(run(lane({ minionsKilled: 40, jungleMinionsKilled: 16 })).moments).toHaveLength(0) // 56 vs 70 → −14
    expect(run(lane({ minionsKilled: 40, jungleMinionsKilled: 14 })).moments).toHaveLength(1) // 54 vs 70 → −16
  })
  it('2 takedowns before 10:00 compensate, 1 does not', () => {
    const two = [kill(at(4), 6, 3, [1]), kill(at(10), 7, 1)]
    expect(run(lane({ minionsKilled: 40 }, two)).moments).toHaveLength(0)
    expect(run(lane({ minionsKilled: 40 }, [two[0]])).moments[0].facts.takedownsBefore10).toBe(1)
    // A takedown after 10:00 does not count.
    expect(run(lane({ minionsKilled: 40 }, [two[0], kill(at(10) + 1, 7, 1)])).moments).toHaveLength(1)
  })
  it('compares with the direct opponent, on both sides, laners only', () => {
    expect(run(lane({ minionsKilled: 40 }, [], 8)).moments[0].facts.opponentChampion).toBe('Champ3')
    expect(run(lane({ minionsKilled: 0 }, [], 2)).moments).toHaveLength(0) // jungler
    // Support: no 10:00 deficit (no direct opponent). Its only moment here is the V6 "no ward by 1:45" (the fixture places none).
    expect(run(lane({ minionsKilled: 0 }, [], 5)).moments.map((m) => m.facts.pattern)).toEqual(['support-no-early-ward'])
    expect(run(lane({ minionsKilled: 0 }, [], 5)).laneAt10).toBeNull()
  })
  it('needs a 10:00 snapshot', () => {
    expect(run(buildGame({ minutes: 9, me: 1 })).laneAt10).toBeNull()
  })
})

describe('moment selection', () => {
  const m = (t: number, s: number): CriticalMoment => ({ key: `k${t}`, trigger: 'critical-death', gameTimeSec: t, severity: s, position: null, zone: null, lane: null, territory: null, winProbBefore: 0.5, winProbAfter: 0.4, facts: {} })
  it('at most 3, the costliest, returned in game order', () => {
    const out = pickMoments([m(100, 0.1), m(300, 0.5), m(600, 0.3), m(900, 0.2), m(1200, 0.4)])
    expect(out.map((x) => x.gameTimeSec)).toEqual([300, 600, 1200])
    expect(pickMoments([])).toEqual([])
  })
  it('two moments less than 25 s apart are one: the costlier wins', () => {
    expect(pickMoments([m(100, 0.2), m(124, 0.3)]).map((x) => x.gameTimeSec)).toEqual([124])
    expect(pickMoments([m(100, 0.2), m(125, 0.3)]).map((x) => x.gameTimeSec)).toEqual([100, 125])
  })
  it('ties go to the earlier moment', () => {
    expect(pickMoments([m(500, 0.2), m(100, 0.2), m(900, 0.2), m(300, 0.2)]).map((x) => x.gameTimeSec)).toEqual([100, 300, 500])
  })
  it('the analysis never returns more than 3 moments', () => {
    const events = [4, 8, 12, 16, 20, 24].flatMap((min) => [kill(at(min), 1, 8, [], { x: 5000, y: 5000 }), tower(at(min, 30), 100, 8)])
    const a = run(buildGame({ minutes: 28, me: 1, events }))
    expect(a.moments).toHaveLength(3)
    expect([...a.moments].sort((x, y) => x.gameTimeSec - y.gameTimeSec)).toEqual(a.moments)
  })
})

describe('bounty estimate', () => {
  it('follows the kill-streak table and caps at 7', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 12].map(bountyGold)).toEqual([300, 300, 450, 600, 700, 800, 900, 1000, 1000])
  })
})
