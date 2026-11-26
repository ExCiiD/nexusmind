/**
 * Gank ledger of the jungler (docs/moteur/PLAN_MOTEUR_BILANS.md phase 3, docs/moteur/engine-reports/2026-11-20-bilan-des-ganks-jungle.md § 5):
 * the ten cases of the report. Blue jungler = participant 2, red jungler = 7; red bot laners stand in the bot lane at (11500, 1500),
 * the blue jungler is in the bot lane on the snapshots of minutes 7 and 8 and in his own jungle before and after.
 */
import { describe, it, expect } from 'vitest'
import { buildGame, at } from './microReviewFixtures'
import { DETECTOR_SPEC, MOMENT_PATTERNS, analyzeGame } from '../../src/lib/microReview/anomalyDetector'
import { GANK_THRESHOLDS, gankLedger, type GankThresholds } from '../../src/lib/microReview/gankLedger'
import { buildQcm } from '../../src/lib/microReview/smartQcm'

const ME = 2
const SPEC = { ...GANK_THRESHOLDS, netThreshold: 0.2 } as GankThresholds
const BOT = { x: 10500, y: 1500 }

interface Opts { enemyCamps?: number; stolen?: boolean; laneFar?: boolean; enemyNear?: boolean; foeHpLow?: boolean; events?: any[]; gankFrames?: number[] }
function gankGame(o: Opts = {}) {
  const frames = o.gankFrames ?? [7, 8]
  return buildGame({
    me: ME, events: o.events ?? [],
    frame: (i, pid) => {
      const r: Record<string, unknown> = {}
      if (pid === ME) {
        r.position = frames.includes(i) ? BOT : { x: 4000, y: 6500 }
        r.jungleMinionsKilled = Math.min(i, 6) * 4
        r.minionsKilled = o.laneFar && i >= 8 ? i * 7 : 0
      }
      if (pid === 9) { r.position = { x: o.laneFar ? 13500 : 11500, y: o.laneFar ? 6000 : 1500 }; if (o.foeHpLow && i === 6) r.championStats = { health: 200, healthMax: 1000, power: 0, powerMax: 0 } }
      if (pid === 7) {
        r.jungleMinionsKilled = i >= 8 ? (o.enemyCamps ?? 0) * 4 : 0
        if (o.stolen) { r.position = { x: 4000, y: 6500 }; r.jungleMinionsKilled = i >= 8 ? 8 : 0 }
        if (o.enemyNear && i >= 5 && i <= 9) r.position = { x: 9000, y: 3000 }
      }
      return r
    },
  })
}
const ledger = (g: ReturnType<typeof gankGame>, spec = SPEC) => gankLedger(g.match, g.timeline, ME, spec)!.entries
const bot = { x: 11000, y: 1500 }
const kill = (ts: number, extra: Record<string, unknown> = {}) => ({ type: 'CHAMPION_KILL', timestamp: ts, killerId: 4, victimId: 9, assistingParticipantIds: [ME], position: bot, bounty: 300, shutdownBounty: 0, ...extra })

describe('gank ledger — the cases of the jungle report', () => {
  it('1. a failed gank with the camps up: losing, the camps counted', () => {
    const [e] = ledger(gankGame({ enemyCamps: 3 }))
    expect(e.lane).toBe('BOT')
    expect(e.campsLost).toBe(3)
    expect(e.gain.z).toBe(0)
    expect(e.verdict).toBe('losing')
    expect(e.proof.position).toBe(true)
  })

  it('2. an assist and a Dragon: profitable', () => {
    const [e] = ledger(gankGame({ enemyCamps: 1, events: [kill(at(7, 30)), { type: 'ELITE_MONSTER_KILL', timestamp: at(8, 10), monsterType: 'DRAGON', killerId: 4, killerTeamId: 100, assistingParticipantIds: [ME], position: { x: 9866, y: 4414 } }] }))
    expect(e.gain.assists).toBe(1)
    expect(e.gain.objectives).toEqual(['dragon'])
    expect(e.verdict).toBe('profitable')
  })

  it('3. no takedown but the laner forced back: a trade', () => {
    const [e] = ledger(gankGame({ enemyCamps: 1, foeHpLow: true, events: [{ type: 'ITEM_PURCHASED', timestamp: at(7, 40), participantId: 9, itemId: 1055 }] }))
    expect(e.gain.forcedBack).toBe(true)
    expect(e.verdict).toBe('neutral')
  })

  it('4. a gank paid by an enemy Dragon on the other side: losing', () => {
    const g = gankGame({ enemyCamps: 2, events: [{ type: 'ELITE_MONSTER_KILL', timestamp: at(9, 0), monsterType: 'DRAGON', killerId: 7, killerTeamId: 200, position: { x: 9866, y: 4414 } }] })
    const [e] = ledger(g)
    expect(e.followUp.objectives).toEqual(['dragon'])
    expect(e.verdict).toBe('losing')
    expect(ledger(gankGame({ enemyCamps: 2 }))[0].followUp.objectives).toEqual([])
  })

  it('5. a gank seen only through the lane minions taken', () => {
    const [e] = ledger(gankGame({ laneFar: true, enemyCamps: 3 }))
    expect(e.proof).toEqual({ position: false, takedown: false, minions: true })
    expect(e.lane).toBe('BOT')
  })

  it('6. two takedowns less than 45 s apart are one gank', () => {
    const g = gankGame({ gankFrames: [], events: [kill(at(7, 0)), kill(at(7, 40), { victimId: 10 })] })
    const entries = ledger(g)
    expect(entries).toHaveLength(1)
    expect(entries[0].gain.kills + entries[0].gain.assists).toBe(2)
  })

  it('7. the jungler dies during the gank: its gold is part of the cost', () => {
    const [e] = ledger(gankGame({ enemyCamps: 2, events: [{ type: 'CHAMPION_KILL', timestamp: at(7, 20), killerId: 9, victimId: ME, assistingParticipantIds: [10], position: bot, bounty: 300, shutdownBounty: 0 }] }))
    expect(e.died).toBe(true)
    expect(e.cost.deathGold).toBe(300)
  })

  it('8. camps stolen while the jungler is away', () => {
    const [e] = ledger(gankGame({ stolen: true }))
    expect(e.campsStolen).toBe(2)
  })

  it('9. the enemy jungler close at the start is a bad timer; a far one is a good one', () => {
    expect(ledger(gankGame({ enemyCamps: 3, enemyNear: true }))[0].timer).toBe('enemy-close')
    expect(ledger(gankGame({ enemyCamps: 3, enemyNear: true }))[0].goodTimer).toBe(false)
    expect(ledger(gankGame({ enemyCamps: 3 }))[0].goodTimer).toBe(true)
  })

  it('thresholds on both sides: the camps floor and the net threshold', () => {
    // one camp lost cannot be losing however negative the net.
    expect(ledger(gankGame({ enemyCamps: 1 }), { ...SPEC, netThreshold: 0.01 } as GankThresholds)[0].verdict).toBe('neutral')
    expect(ledger(gankGame({ enemyCamps: 2 }), { ...SPEC, netThreshold: 0.01 } as GankThresholds)[0].verdict).toBe('losing')
    const net = ledger(gankGame({ enemyCamps: 3 }))[0].net
    expect(ledger(gankGame({ enemyCamps: 3 }), { ...SPEC, netThreshold: -net - 0.02 } as GankThresholds)[0].verdict).toBe('losing')
    expect(ledger(gankGame({ enemyCamps: 3 }), { ...SPEC, netThreshold: -net + 0.02 } as GankThresholds)[0].verdict).toBe('neutral')
  })

  it('the committed spec: calibrated threshold, flag off', () => {
    expect(DETECTOR_SPEC.gankLedger.enabled).toBe(false)
    expect(DETECTOR_SPEC.gankLedger.netThreshold).toBe(GANK_THRESHOLDS.netThreshold)
    expect(DETECTOR_SPEC.gankLedger.minCampsLost).toBe(2)
    expect(MOMENT_PATTERNS).toContain('jungle-gank-unpaid')
  })
})

describe('jungle-gank-unpaid — replaces jungle-camps-up-gank, silent until enabled', () => {
  const withFlag = <T,>(on: boolean, fn: () => T): T => {
    const g = DETECTOR_SPEC.gankLedger as { enabled: boolean }
    const before = g.enabled
    g.enabled = on
    try { return fn() } finally { g.enabled = before }
  }
  const patterns = (a: NonNullable<ReturnType<typeof analyzeGame>>) => [...a.moments, ...(a.extraMoments ?? [])].map((m) => m.facts.pattern ?? m.trigger)
  const g = () => gankGame({ enemyCamps: 12 })

  it('flag off: the legacy rule is the card, the ledger is only stored', () => {
    const game = g()
    const a = withFlag(false, () => analyzeGame(game.match, game.timeline, game.selector))!
    expect(a.ganks?.length).toBeGreaterThan(0)
    expect(patterns(a)).toContain('jungle-camps-up-gank')
    expect(patterns(a)).not.toContain('jungle-gank-unpaid')
  })

  it('flag on: one card, never also the legacy one; the QCM reuses the gank context with the assumed trade as the way out', () => {
    const game = g()
    const a = withFlag(true, () => analyzeGame(game.match, game.timeline, game.selector))!
    const all = patterns(a)
    expect(all).toContain('jungle-gank-unpaid')
    expect(all).not.toContain('jungle-camps-up-gank')
    expect(all.filter((p) => p === 'jungle-gank-unpaid')).toHaveLength(1)
    const m = [...a.moments, ...(a.extraMoments ?? [])].find((x) => x.facts.pattern === 'jungle-gank-unpaid')!
    const card = buildQcm(m)
    expect(card.contexts).toEqual(['jgl-gank-camps-up'])
    expect(card.options.map((o) => o.id)).toContain('justified:gankTrade')
    expect(card.summary.head.key).toBe('gankUnpaid')
    expect(card.summary.head.params?.lane).toBe('bot')
  })
})
