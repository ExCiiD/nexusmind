/**
 * Roam ledger of the top, the ADC and the support (docs/moteur/PLAN_MOTEUR_BILANS.md phase 2, docs/moteur/engine-reports/
 * 2026-11-20-bilan-des-roams.md § 5): the cases of the report, the roles' flags and the cards.
 * Blue duo: ADC 4, support 5; red duo: ADC 9, support 10; blue top 1, red top 6. Duos stand in the bot lane, the top in
 * the top lane; the roamer walks to the middle of the map between the snapshots of minutes 7 and 9 (out from about 7:07).
 */
import { describe, it, expect } from 'vitest'
import { buildGame, at } from './microReviewFixtures'
import { DETECTOR_SPEC, analyzeGame } from '../../src/lib/microReview/anomalyDetector'
import { ROAM_THRESHOLDS, roamLedger, type RoamThresholds } from '../../src/lib/microReview/roamLedger'
import { buildQcm, contextsOf, optionsFor } from '../../src/lib/microReview/smartQcm'

const LOW = { ...ROAM_THRESHOLDS, netThresholdSupport: 0.2, netThresholdAdc: 0.2, netThresholdTop: 0.2 } as RoamThresholds

interface Opts {
  roamer: number; version?: string
  adcCs?: number; supXp?: number; adcXp?: number; topCs?: number; topXp?: number
  adcHpLow?: boolean; events?: any[]
}
function duoGame(o: Opts) {
  const g = buildGame({
    me: o.roamer, gameVersion: o.version ?? '16.22.1.1', events: o.events ?? [],
    positions: { 1: 'TOP', 6: 'TOP' },
    frame: (i, pid) => {
      const r: Record<string, unknown> = {}
      if (pid === 4 || pid === 5) r.position = { x: 9000, y: 1500 }
      if (pid === 9 || pid === 10) r.position = { x: 13500, y: 6000 }
      if (pid === 1) r.position = { x: 1000, y: 9000 }
      if (pid === o.roamer && i === 8) r.position = { x: 7500, y: 7500 }
      if (pid === 4 && i >= 8) { r.minionsKilled = i * 7 - (o.adcCs ?? 0); r.xp = i * 500 + (o.adcXp ?? 0) - 0 }
      if (pid === 5 && i >= 8) r.xp = i * 500 - (o.supXp ?? 0)
      if (pid === 1 && i >= 8) { r.minionsKilled = i * 7 - (o.topCs ?? 0); r.xp = i * 500 - (o.topXp ?? 0) }
      if (pid === 4 && i === 7 && o.adcHpLow) r.championStats = { health: 300, healthMax: 1000, power: 0, powerMax: 0 }
      return r
    },
  })
  return g
}
const lvl4 = [1, 2, 3].map((n) => ({ type: 'LEVEL_UP', timestamp: n * 60_000, participantId: 5, level: n + 1 }))
const ledger = (g: ReturnType<typeof duoGame>, pid: number, spec = LOW) => roamLedger(g.match, g.timeline, pid, spec)!.entries

describe('roam ledger — support, ADC, top', () => {
  it('a support who leaves before the tax level: the tax depends on the patch (16.20 against 16.10)', () => {
    const [a] = ledger(duoGame({ roamer: 5, version: '16.20.1.1', adcCs: 12, events: lvl4 }), 5)
    const [b] = ledger(duoGame({ roamer: 5, version: '16.10.1.1', adcCs: 12, events: lvl4 }), 5)
    expect(a.role).toBe('UTILITY')
    expect(a.taxed).toBe(true) // level 4 < 5 from 16.16
    expect(b.taxed).toBe(false) // level 4 >= 3 before 16.16
    expect(a.timer).toBe('paid-window')
    expect(a.cost.cs).toBeGreaterThanOrEqual(12) // paid by the ADC
  })

  it('a support who leaves right after a kill on the enemy ADC: a good timer, nothing lost, profitable', () => {
    const g = duoGame({ roamer: 5, events: [...lvl4, { type: 'CHAMPION_KILL', timestamp: at(7, 2), killerId: 4, victimId: 9, assistingParticipantIds: [5], position: { x: 13500, y: 6000 }, bounty: 400, shutdownBounty: 0 },
      { type: 'CHAMPION_KILL', timestamp: at(7, 30), killerId: 5, victimId: 8, assistingParticipantIds: [], position: { x: 7500, y: 7500 }, bounty: 400, shutdownBounty: 0 }] })
    const [e] = ledger(g, 5)
    expect(e.timer).toBe('after-kills')
    expect(e.goodTimer).toBe(true)
    expect(e.cost.cs).toBe(0)
    expect(e.verdict, JSON.stringify(e)).toBe('profitable')
  })

  it('a support who leaves after a recall: timer after-recall', () => {
    const [e] = ledger(duoGame({ roamer: 5, adcCs: 12, events: [...lvl4, { type: 'ITEM_PURCHASED', timestamp: at(6, 45), participantId: 5, itemId: 1055 }] }), 5)
    expect(e.timer).toBe('after-recall')
    expect(e.goodTimer).toBe(true)
  })

  it('an ADC who farms normally during the absence: no cost, never losing', () => {
    const [e] = ledger(duoGame({ roamer: 5, events: lvl4 }), 5, { ...LOW, netThresholdSupport: 0.01 } as RoamThresholds)
    expect(e.cost.cs).toBe(0)
    expect(e.verdict).not.toBe('losing')
  })

  it('an ADC forced back: under 35 % HP before, a purchase during the absence', () => {
    const [e] = ledger(duoGame({ roamer: 5, adcCs: 12, adcHpLow: true, events: [...lvl4, { type: 'ITEM_PURCHASED', timestamp: at(7, 40), participantId: 4, itemId: 1055 }] }), 5)
    expect(e.partner?.hpBefore).toBe(30)
    expect(e.partner?.forcedBack).toBe(true)
  })

  it('an ADC killed 2v1 during the absence: its gold is part of the cost; a lone enemy does not count', () => {
    const kill = (assist: number[]) => ({ type: 'CHAMPION_KILL', timestamp: at(7, 40), killerId: 9, victimId: 4, assistingParticipantIds: assist, position: { x: 9000, y: 1500 }, bounty: 300, shutdownBounty: 0 })
    const two = ledger(duoGame({ roamer: 5, adcCs: 12, events: [...lvl4, kill([10])] }), 5)[0]
    const one = ledger(duoGame({ roamer: 5, adcCs: 12, events: [...lvl4, kill([])] }), 5)[0]
    expect(two.partner?.died).toBe(true)
    expect(two.cost.deathGold).toBe(300)
    expect(one.partner?.died).toBe(false)
    expect(one.cost.deathGold).toBe(0)
  })

  it('the ADC gains XP alone but the duo loses it: the verdict follows the duo', () => {
    const [e] = ledger(duoGame({ roamer: 5, adcCs: 12, adcXp: 300, supXp: 1500, events: lvl4 }), 5)
    expect(e.cost.xp).toBe(1200) // +300 for the ADC, −1500 for the support
  })

  it('a top whose walk to a takedown is too fast: probable Teleport', () => {
    const g = duoGame({ roamer: 1, topCs: 10, events: [{ type: 'CHAMPION_KILL', timestamp: at(7, 20), killerId: 1, victimId: 9, assistingParticipantIds: [], position: { x: 10000, y: 1500 }, bounty: 300, shutdownBounty: 0 }] })
    ;(g.match.info.participants[0] as any).summoner1Id = 12
    const e = ledger(g, 1)[0]
    expect(e.role).toBe('TOP')
    expect(e.tpLikely).toBe(true)
    const g2 = duoGame({ roamer: 1, topCs: 10, events: [{ type: 'CHAMPION_KILL', timestamp: at(7, 20), killerId: 1, victimId: 9, assistingParticipantIds: [], position: { x: 10000, y: 1500 }, bounty: 300, shutdownBounty: 0 }] })
    expect(ledger(g2, 1)[0].tpLikely).toBe(false) // no Teleport among the spells
  })

  it('an ADC who leaves and lets the support die', () => {
    const g = duoGame({ roamer: 4, adcCs: 10, events: [{ type: 'CHAMPION_KILL', timestamp: at(7, 40), killerId: 9, victimId: 5, assistingParticipantIds: [10], position: { x: 9000, y: 1500 }, bounty: 300, shutdownBounty: 0 }] })
    const [e] = ledger(g, 4)
    expect(e.role).toBe('BOTTOM')
    expect(e.partner?.died).toBe(true)
    expect(e.cost.deathGold).toBe(300)
  })

  it('a duo who leaves together is not a roam', () => {
    const g = buildGame({ me: 5, positions: { 1: 'TOP', 6: 'TOP' }, frame: (i, pid) => ((pid === 4 || pid === 5) ? { position: i === 8 ? { x: 7500, y: 7500 } : { x: 9000, y: 1500 } } : undefined) })
    expect(ledger(g as any, 5)).toEqual([])
  })

  it('wards laid, no takedown, a small cost: a support is never losing', () => {
    const ward = (ts: number) => ({ type: 'WARD_PLACED', timestamp: ts, creatorId: 5, wardType: 'YELLOW_TRINKET' })
    const e = ledger(duoGame({ roamer: 5, adcCs: 8, supXp: 3000, events: [...lvl4, ward(at(7, 30))] }), 5, { ...LOW, netThresholdSupport: 0.2 } as RoamThresholds)[0]
    expect(e.wards).toBe(1)
    expect(e.verdict).toBe('neutral')
    const loud = ledger(duoGame({ roamer: 5, adcCs: 8, supXp: 3000, events: lvl4 }), 5)[0]
    expect(loud.verdict).toBe('losing')
  })
})

describe('roam cards of the other roles — silent by default, one event one reading', () => {
  const withFlag = <T,>(role: 'TOP' | 'UTILITY' | 'BOTTOM', fn: () => T): T => {
    const roles = DETECTOR_SPEC.roam.enabledRoles as Record<string, boolean>
    const before = roles[role]
    roles[role] = true
    try { return fn() } finally { roles[role] = before }
  }
  const patterns = (a: NonNullable<ReturnType<typeof analyzeGame>>) => [...a.moments, ...(a.extraMoments ?? [])].map((m) => m.facts.pattern ?? m.trigger)

  it('the flags are off and the thresholds are committed per role', () => {
    expect(DETECTOR_SPEC.roam.enabledRoles).toEqual({ TOP: false, BOTTOM: false, UTILITY: false })
    expect([DETECTOR_SPEC.roam.netThresholdTop, DETECTOR_SPEC.roam.netThresholdAdc, DETECTOR_SPEC.roam.netThresholdSupport]).toEqual([1.5, 1.25, 1.25])
  })

  it('support: a costly roam is a card only once its flag is on; QCM reads it as sup-roam with the free window as the way out', () => {
    const g = duoGame({ roamer: 5, adcCs: 30, supXp: 3000, events: lvl4 })
    const off = analyzeGame(g.match, g.timeline, g.selector)!
    expect(off.roams?.length).toBeGreaterThan(0)
    expect(patterns(off)).not.toContain('support-roam-unpaid')
    const on = withFlag('UTILITY', () => analyzeGame(g.match, g.timeline, g.selector))!
    expect(patterns(on)).toContain('support-roam-unpaid')
    const m = [...on.moments, ...(on.extraMoments ?? [])].find((x) => x.facts.pattern === 'support-roam-unpaid')!
    const card = buildQcm(m)
    expect(card.contexts).toEqual(['sup-roam'])
    expect(card.options.map((o) => o.id)).toContain('justified:freeWindow')
    expect(card.summary.head.key).toBe('roamUnpaidSupport')
    expect(card.summary.extras.length).toBe(3)
  })

  it('top: the roam is the card; no bad-rotation, no 10:00 card for the same loss', () => {
    const g = duoGame({ roamer: 1, topCs: 30, topXp: 2500 })
    const off = analyzeGame(g.match, g.timeline, g.selector)!
    expect([...off.moments, ...(off.extraMoments ?? [])].some((m) => m.facts.csDiff10 != null)).toBe(true)
    const on = withFlag('TOP', () => analyzeGame(g.match, g.timeline, g.selector))!
    const all = patterns(on)
    expect(all).toContain('top-roam-unpaid')
    expect(all).not.toContain('bad-rotation')
    expect([...on.moments, ...(on.extraMoments ?? [])].some((m) => m.facts.csDiff10 != null)).toBe(false)
    expect(contextsOf(on.moments.concat(on.extraMoments ?? []).find((x) => x.facts.pattern === 'top-roam-unpaid')!)).toEqual(['mid-roam'])
  })

  it('every new context has diagnoses and a way out', () => {
    for (const c of ['adc-roam', 'sup-roam'] as const) {
      const o = optionsFor(c)
      expect(o.length).toBe(3)
      expect(o.some((x) => x.outcome === 'justified')).toBe(true)
    }
  })
})
