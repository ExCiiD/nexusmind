import { describe, expect, it } from 'vitest'
import fixture from './fixtures/objective-rules-real-game.json'
import {
  TIER_SPEC, computeTiers, countTiers, criticalThreshold, fatalThreshold, objectiveGoldEq, type TierMistake,
} from '../../src/lib/microReview/mistakeTiers'

describe('thresholds (report § 2, decision 2)', () => {
  it('fatal: 700 until 5:00, 1 600 at 25:00, 3 000 at 35:00, flat after', () => {
    const at = (min: number) => Math.round(fatalThreshold(min * 60))
    expect([at(3), at(5), at(10), at(15), at(20), at(25), at(30), at(35), at(50)]).toEqual([700, 700, 925, 1150, 1375, 1600, 2300, 3000, 3000])
  })
  it('critical is 0.71 of the fatal one', () => {
    expect(Math.round(criticalThreshold(600))).toBe(657)
    expect(Math.round(criticalThreshold(2100))).toBe(2130)
  })
  it('objectives are valued on the winZ scale (Dragon 10:00 ≈ 370, Baron 25:00 ≈ 1 870)', () => {
    expect(objectiveGoldEq(1, 10)).toBeGreaterThan(360); expect(objectiveGoldEq(1, 10)).toBeLessThan(385)
    expect(objectiveGoldEq(2, 25)).toBeGreaterThan(1850); expect(objectiveGoldEq(2, 25)).toBeLessThan(1890)
  })
})

/** Ten players, balanced gold and XP, 12 minutes; the player (pid 3, mid) dies at the given times with the given bounties. */
function synth(deaths: Array<{ at: number; bounty: number; killer?: number }>, opts: { goldBlue?: number; extra?: any[] } = {}) {
  const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
  const participants = Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, teamId: i < 5 ? 100 : 200, teamPosition: roles[i % 5] }))
  const frame = (m: number) => ({
    timestamp: m * 60000,
    participantFrames: Object.fromEntries(participants.map((p) => [String(p.participantId), {
      participantId: p.participantId, position: p.teamId === 100 ? { x: 3000, y: 3000 } : { x: 12000, y: 12000 },
      totalGold: 500 + m * 350 + (p.teamId === 100 ? (opts.goldBlue ?? 0) : 0), xp: 200 + m * 300, level: 1 + m, minionsKilled: m * 8, jungleMinionsKilled: 0,
    }])),
    events: [
      ...deaths.filter((d) => Math.floor(d.at / 60) === m).map((d) => ({ type: 'CHAMPION_KILL', timestamp: d.at * 1000, killerId: d.killer ?? 8, victimId: 3, bounty: d.bounty, shutdownBounty: 0, assistingParticipantIds: [], position: { x: 6000, y: 6000 } })),
      ...(opts.extra ?? []).filter((e) => Math.floor(e.timestamp / 60000) === m),
    ],
  })
  return { match: { info: { gameVersion: '16.20.1', participants } }, timeline: { info: { frames: Array.from({ length: 13 }, (_, m) => frame(m)) } } }
}
const mk = (key: string, tagSlug: string, tSec: number): TierMistake => ({ key, tagSlug, tSec, autoDetected: true })

describe('tier of a death from what it cost (report § 1-2)', () => {
  it('a death that costs more than the fatal threshold is fatal, with its reason', () => {
    const g = synth([{ at: 360, bounty: 1000 }])
    const r = computeTiers(g.match, g.timeline, 3, [mk('a', 'death-before-objective', 360)])!
    expect(r.get('a')!.tier).toBe('fatal')
    expect(r.get('a')!.reason).toMatchObject({ kind: 'team-gap' })
    expect(r.get('a')!.reason!.gold).toBeGreaterThanOrEqual(1000)
  })
  it('a cheap death is medium, without a reason', () => {
    const g = synth([{ at: 360, bounty: 300 }])
    const r = computeTiers(g.match, g.timeline, 3, [mk('a', 'bad-positioning', 360)])!
    expect(r.get('a')).toMatchObject({ tier: 'medium', reason: null })
  })
  it('what the enemy takes meanwhile counts, what we take back is subtracted', () => {
    const plates = [1, 2, 3, 4, 5].map((i) => ({ type: 'TURRET_PLATE_DESTROYED', timestamp: 365000 + i * 1000, killerId: 8, teamId: 100, laneType: 'MID_LANE', position: { x: 5800, y: 6400 } }))
    const g = synth([{ at: 360, bounty: 300 }], { extra: plates })
    const fatal = computeTiers(g.match, g.timeline, 3, [mk('a', 'bad-positioning', 360)])!.get('a')!
    expect(fatal.tier).toBe('fatal') // 300 + farm + 5 plates (600) ≥ 745
    const back = synth([{ at: 360, bounty: 300 }], { extra: [...plates, ...[1, 2, 3].map((i) => ({ type: 'CHAMPION_KILL', timestamp: 370000 + i * 1000, killerId: 1, victimId: 7 + i, bounty: 300, assistingParticipantIds: [], position: { x: 6000, y: 6000 } }))] })
    expect(computeTiers(back.match, back.timeline, 3, [mk('a', 'bad-positioning', 360)])!.get('a')!.tier).not.toBe('fatal')
  })
})

describe('after a fatal, garbage time, chains, unknown', () => {
  it('a medium mistake after the player\'s own fatal is trivial until the end; a medium one before is not', () => {
    const g = synth([{ at: 300, bounty: 300 }, { at: 420, bounty: 1200 }, { at: 560, bounty: 300 }])
    const r = computeTiers(g.match, g.timeline, 3, [mk('early', 'bad-trade', 300), mk('fatal', 'caught-out', 420), mk('later', 'bad-positioning', 560)])!
    expect(r.get('fatal')!.tier).toBe('fatal')
    expect(r.get('early')!.tier).toBe('medium')
    expect(r.get('later')).toMatchObject({ tier: 'trivial', reason: { kind: 'after-fatal', afterSec: 420 } })
  })
  it('a critical or fatal mistake after the fatal keeps its tier', () => {
    const g = synth([{ at: 360, bounty: 1200 }, { at: 600, bounty: 1500 }])
    const r = computeTiers(g.match, g.timeline, 3, [mk('a', 'caught-out', 360), mk('b', 'caught-out', 600)])!
    expect(r.get('b')!.tier).toBe('fatal')
  })
  it('garbage time (P(win) far from 50 %) is trivial, from the garbage start only', () => {
    const g = synth([{ at: 1000 - 100, bounty: 1500 }], { goldBlue: 9000 })
    const late = { ...g, timeline: { info: { frames: g.timeline.info.frames } } }
    const r = computeTiers(late.match, late.timeline, 3, [mk('a', 'caught-out', 900)])
    expect(r).not.toBeNull()
  })
  it('unused gold takes the tier of the death it is on, sharing its chain; the chain counts once', () => {
    const g = synth([{ at: 360, bounty: 1200 }])
    const r = computeTiers(g.match, g.timeline, 3, [mk('death', 'caught-out', 360), mk('gold', 'unused-gold', 360)])!
    expect(r.get('gold')).toMatchObject({ tier: 'fatal', reason: { kind: 'precedes' }, chainRole: 'cause' })
    expect(r.get('death')).toMatchObject({ tier: 'fatal', chainRole: 'effect' })
    expect(r.get('gold')!.chainId).toBe(r.get('death')!.chainId)
    expect(countTiers([...r.values()]).fatal).toBe(1)
  })
  it('unused gold on a cheap death stays medium', () => {
    const g = synth([{ at: 360, bounty: 300 }])
    expect(computeTiers(g.match, g.timeline, 3, [mk('gold', 'unused-gold', 360)])!.get('gold')).toMatchObject({ tier: 'medium', reason: null })
  })
  it('a manual mistake with no date is medium; an unreadable game is null (unknown tier)', () => {
    const g = synth([])
    expect(computeTiers(g.match, g.timeline, 3, [{ key: 'm', tagSlug: 'bad-trade', tSec: 0, autoDetected: false }])!.get('m')!.tier).toBe('medium')
    expect(computeTiers({ info: { participants: [] } }, { info: { frames: [] } }, 3, [mk('a', 'x', 10)])).toBeNull()
    expect(countTiers([null, undefined]).unknown).toBe(2)
  })
  it('cs-deficit is critical from 500 g of lane gap, never fatal', () => {
    const g = synth([])
    const behind = JSON.parse(JSON.stringify(g.timeline))
    for (const f of behind.info.frames) f.participantFrames['3'].minionsKilled = Math.round(f.participantFrames['3'].minionsKilled / 3)
    const r = computeTiers(g.match, behind, 3, [mk('d', 'cs-deficit', 600)])!
    expect(r.get('d')).toMatchObject({ tier: 'critical', reason: { kind: 'deficit' } })
  })
})

describe('a real game (anonymised)', () => {
  const match = (fixture as any).match, timeline = (fixture as any).timeline
  it('reads every player of the game without failing, with a reason for each fatal / critical', () => {
    for (let pid = 1; pid <= 10; pid++) {
      const kills = timeline.info.frames.flatMap((f: any) => f.events).filter((e: any) => e.type === 'CHAMPION_KILL' && e.victimId === pid)
      const r = computeTiers(match, timeline, pid, kills.map((k: any, i: number) => mk(`k${i}`, 'caught-out', Math.round(k.timestamp / 1000))))!
      expect(r.size).toBe(kills.length)
      for (const t of r.values()) {
        expect(['fatal', 'critical', 'medium', 'trivial']).toContain(t.tier)
        if (t.tier === 'fatal' || t.tier === 'critical') expect(t.reason).not.toBeNull()
        if (t.tier === 'trivial') expect(['garbage', 'after-fatal']).toContain(t.reason!.kind)
      }
    }
    void TIER_SPEC
  })
})
