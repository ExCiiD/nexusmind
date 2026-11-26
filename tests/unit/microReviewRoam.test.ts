/**
 * Mid roam ledger (docs/PLAN_MOTEUR_BILANS.md phase 1, docs/engine-reports/2026-11-20-bilan-des-roams-mid.md § 5): the nine
 * cases of the report, the thresholds on both sides, the one-event-one-reading rule, the QCM context and the silent flag.
 * Fixtures: mid laner = participant 3 (blue), lane opponent = participant 8. The mid walks to the bot side between the
 * snapshots of minutes 7 and 9 (out of the lane from about 7:18 to 8:42).
 */
import { describe, it, expect } from 'vitest'
import { buildGame, at } from './microReviewFixtures'
import { DETECTOR_SPEC, MOMENT_PATTERNS, analyzeGame } from '../../src/lib/microReview/anomalyDetector'
import { ROAM_THRESHOLDS, roamLedger, type RoamThresholds } from '../../src/lib/microReview/roamLedger'
import { buildQcm } from '../../src/lib/microReview/smartQcm'
import { patchOf } from '../../src/lib/microReview/gameClock'

const ME = 3
const OPP = 8
const SPEC = { ...ROAM_THRESHOLDS, netThreshold: 0.3 } as RoamThresholds

interface Opts { lossFrom?: number; csLoss?: number; xpLoss?: number; oppOut?: boolean; freeze?: boolean; stayInLane?: boolean; events?: any[] }
function roamGame(o: Opts = {}) {
  return buildGame({
    me: ME,
    events: o.events ?? [],
    frame: (i, pid) => {
      if (pid === ME) {
        const r: Record<string, unknown> = {}
        if (i === 8 && !o.stayInLane) r.position = { x: 10000, y: 1500 }
        if (i >= (o.lossFrom ?? 8)) { r.minionsKilled = i * 7 - (o.csLoss ?? 0) - (o.freeze && i >= 9 ? 5 : 0); r.xp = i * 500 - (o.xpLoss ?? 0) }
        return r
      }
      if (pid === OPP && o.oppOut && i === 8) return { position: { x: 13000, y: 6000 } }
      return undefined
    },
  })
}
const botKill = (ts: number, extra: Record<string, unknown> = {}) => ({
  type: 'CHAMPION_KILL', timestamp: ts, killerId: ME, victimId: 9, assistingParticipantIds: [4], position: { x: 10000, y: 1500 }, bounty: 300, shutdownBounty: 0, ...extra,
})
const ledgerOf = (g: ReturnType<typeof roamGame>, spec: RoamThresholds = SPEC) => roamLedger(g.match, g.timeline, ME, spec)!.entries

describe('roam ledger — the cases of the mid report', () => {
  it('1. a roam without any gain and a wave left on our side: losing, freezeLikely', () => {
    const [e] = ledgerOf(roamGame({ csLoss: 12, xpLoss: 1200, freeze: true }))
    expect(e.fromSec).toBeGreaterThanOrEqual(at(7, 10) / 1000)
    expect(e.fromSec).toBeLessThanOrEqual(at(7, 30) / 1000)
    expect(e.cost.cs).toBeGreaterThanOrEqual(12)
    expect(e.gain.z).toBe(0)
    expect(e.freezeLikely).toBe(true)
    expect(e.verdict).toBe('losing')
    expect(e.side).toBe('bot')
  })

  it('2. an assist and a Dragon with a small cost: profitable, no card', () => {
    const g = roamGame({ csLoss: 4, xpLoss: 200, events: [botKill(at(8), { killerId: 4, assistingParticipantIds: [ME] }),
      { type: 'ELITE_MONSTER_KILL', timestamp: at(8, 20), monsterType: 'DRAGON', killerId: 4, assistingParticipantIds: [ME], killerTeamId: 100, position: { x: 9866, y: 4414 } }] })
    const [e] = ledgerOf(g)
    expect(e.gain.assists).toBe(1)
    expect(e.gain.objectives).toEqual(['dragon'])
    expect(e.verdict).toBe('profitable')
  })

  it('3. a paid roam the opponent converts (2 plates, a takedown on our top): losing', () => {
    const g = roamGame({ csLoss: 12, xpLoss: 1200, events: [botKill(at(8), { killerId: 4, assistingParticipantIds: [ME] }),
      { type: 'ELITE_MONSTER_KILL', timestamp: at(8, 20), monsterType: 'DRAGON', killerId: 4, killerTeamId: 100, position: { x: 9866, y: 4414 } },
      { type: 'TURRET_PLATE_DESTROYED', timestamp: at(9, 30), teamId: 100, laneType: 'MID_LANE', killerId: OPP, position: { x: 5846, y: 6396 } },
      { type: 'TURRET_PLATE_DESTROYED', timestamp: at(9, 45), teamId: 100, laneType: 'MID_LANE', killerId: OPP, position: { x: 5846, y: 6396 } },
      { type: 'CHAMPION_KILL', timestamp: at(9, 40), killerId: OPP, victimId: 1, assistingParticipantIds: [7], position: { x: 900, y: 9000 }, bounty: 300, shutdownBounty: 0 }] })
    const [e] = ledgerOf(g)
    expect(e.cost.plates + e.followUp.plates).toBe(2)
    expect(e.followUp.kills).toBe(1)
    expect(e.verdict).toBe('losing')
  })

  it('4. a roam too short for the snapshots, proven by a takedown away from the lane', () => {
    const [e] = ledgerOf(roamGame({ stayInLane: true, events: [botKill(at(8))] }))
    expect(e.shortProof).toBe(true)
    expect(e.gain.kills).toBe(1)
    expect(e.fromSec).toBe(at(7, 45) / 1000)
  })

  it('5. a roam followed by a back: the cost stops at the purchase', () => {
    const base = roamGame({ lossFrom: 9, csLoss: 12, xpLoss: 1200 })
    const withBack = roamGame({ lossFrom: 9, csLoss: 12, xpLoss: 1200, events: [{ type: 'ITEM_PURCHASED', timestamp: at(8, 50), participantId: ME, itemId: 1055 }] })
    const [a] = ledgerOf(base)
    const [b] = ledgerOf(withBack)
    expect(a.reset).toBe(false)
    expect(b.reset).toBe(true)
    expect(a.cost.cs).toBe(12)
    expect(b.cost.cs).toBe(0)
  })

  it('6. a crossed roam: both mid laners leave the lane', () => {
    expect(ledgerOf(roamGame({ csLoss: 12, xpLoss: 1200, oppOut: true }))[0].crossed).toBe(true)
    expect(ledgerOf(roamGame({ csLoss: 12, xpLoss: 1200 }))[0].crossed).toBe(false)
  })

  it('7. a death during the roam: its gold is part of the cost', () => {
    const dead = roamGame({ csLoss: 12, xpLoss: 1200, events: [{ type: 'CHAMPION_KILL', timestamp: at(8, 10), killerId: 9, victimId: ME, assistingParticipantIds: [], position: { x: 10000, y: 1500 }, bounty: 300, shutdownBounty: 0 }] })
    const [e] = ledgerOf(dead)
    expect(e.died).toBe(true)
    expect(e.cost.deathGold).toBe(300)
    expect(e.cost.z).toBeGreaterThan(ledgerOf(roamGame({ csLoss: 12, xpLoss: 1200 }))[0].cost.z)
  })

  it('8. thresholds on both sides: the CS floor and the net threshold', () => {
    // CS floor: 5 CS lost with a big XP loss is neutral, 6 is losing.
    expect(ledgerOf(roamGame({ csLoss: 5, xpLoss: 4000 }))[0].verdict).toBe('neutral')
    expect(ledgerOf(roamGame({ csLoss: 6, xpLoss: 4000 }))[0].verdict).toBe('losing')
    // Net threshold: just under |net| is a verdict, just over is neutral.
    const g = roamGame({ csLoss: 12, xpLoss: 1200 })
    const net = ledgerOf(g)[0].net
    expect(net).toBeLessThan(0)
    expect(ledgerOf(g, { ...SPEC, netThreshold: -net - 0.02 })[0].verdict).toBe('losing')
    expect(ledgerOf(g, { ...SPEC, netThreshold: -net + 0.02 })[0].verdict).toBe('neutral')
    // And the positive side.
    const win = roamGame({ csLoss: 0, xpLoss: 0, events: [botKill(at(8)), botKill(at(8, 10), { victimId: 10 })] })
    const gain = ledgerOf(win)[0].net
    expect(gain).toBeGreaterThan(0)
    expect(ledgerOf(win, { ...SPEC, netThreshold: gain - 0.02 })[0].verdict).toBe('profitable')
    expect(ledgerOf(win, { ...SPEC, netThreshold: gain + 0.02 })[0].verdict).toBe('neutral')
  })

  it('the calibrated threshold is committed and the flag is off', () => {
    expect(DETECTOR_SPEC.roam.netThreshold).toBe(1.25)
    expect(DETECTOR_SPEC.roam.minCsLost).toBe(6)
    expect(DETECTOR_SPEC.roam.enabled).toBe(false)
  })

  it('a roam longer than the roam cap is a rotation of the team, not read', () => {
    const g = buildGame({ me: ME, frame: (i, pid) => (pid === ME && i >= 8 && i <= 12 ? { position: { x: 10000, y: 1500 } } : undefined) })
    expect(ledgerOf(g)).toEqual([])
  })

  it('patchOf reads the steps 16.9 and 16.16', () => {
    const v = (s: string) => patchOf({ info: { gameVersion: s } }).tier
    expect([v('16.8.1'), v('16.9.1'), v('16.15.2'), v('16.16.1'), v('16.22.7'), v('15.20.1'), v('')]).toEqual(['pre-16.9', '16.9', '16.9', '16.16', '16.16', 'unknown', 'unknown'])
  })
})

describe('mid-roam-unpaid — one event, one reading, silent until enabled', () => {
  const costly = () => roamGame({ csLoss: 30, xpLoss: 2500, freeze: true })
  const withFlag = <T,>(on: boolean, fn: () => T): T => {
    const roam = DETECTOR_SPEC.roam as { enabled: boolean }
    const before = roam.enabled
    roam.enabled = on
    try { return fn() } finally { roam.enabled = before }
  }
  const patterns = (a: NonNullable<ReturnType<typeof analyzeGame>>) => [...a.moments, ...(a.extraMoments ?? [])].map((m) => m.facts.pattern ?? m.trigger)

  it('is a known pattern', () => { expect(MOMENT_PATTERNS).toContain('mid-roam-unpaid') })

  it('flag off: the ledger is stored, no card comes from it, the 10:00 card stays', () => {
    const g = costly()
    const a = withFlag(false, () => analyzeGame(g.match, g.timeline, g.selector))!
    expect(a.roams?.length).toBeGreaterThan(0)
    expect(patterns(a)).not.toContain('mid-roam-unpaid')
    expect(a.moments.some((m) => m.trigger === 'early-deficit' && m.facts.csDiff10 != null)).toBe(true)
  })

  it('flag on: the roam is the card; no bad-rotation, no mid-roam-plates, no 10:00 card for the same loss', () => {
    const g = costly()
    const a = withFlag(true, () => analyzeGame(g.match, g.timeline, g.selector))!
    const all = patterns(a)
    expect(all).toContain('mid-roam-unpaid')
    expect(all).not.toContain('bad-rotation')
    expect(all).not.toContain('mid-roam-plates')
    expect([...a.moments, ...(a.extraMoments ?? [])].some((m) => m.facts.csDiff10 != null)).toBe(false)
  })

  it('the QCM reads it as mid-roam with the assumed-trade way out and the freeze hint first', () => {
    const g = costly()
    const a = withFlag(true, () => analyzeGame(g.match, g.timeline, g.selector))!
    const m = [...a.moments, ...(a.extraMoments ?? [])].find((x) => x.facts.pattern === 'mid-roam-unpaid')!
    const card = buildQcm(m)
    expect(card.contexts).toEqual(['mid-roam'])
    expect(card.options.map((o) => o.id)).toContain('justified:roamTradeOk')
    expect(card.options[0].tagSlug).toBe('bad-wave-sync')
    expect(card.summary.head.key).toBe('roamUnpaid')
    expect(card.summary.extras.length).toBeLessThanOrEqual(3)
  })
})
