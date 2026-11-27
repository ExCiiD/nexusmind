import { describe, expect, it } from 'vitest'
import fixture from './fixtures/objective-rules-real-game.json'
import {
  OBJECTIVE_RULES_SPEC, climaxWindow, duoDeaths, objectiveRules, waveSpawns, type ObjectiveRuleEntry, type ObjectiveRulesBlock,
} from '../../src/lib/microReview/objectiveRules'
import { ruleCountsOf, sumRuleCounts, emptyRuleCounts } from '../../src/lib/objectiveRuleFigures'
import { buildLedgerTrack } from '../../src/lib/microReview/ledgerCore'

const match = (fixture as any).match
const timeline = (fixture as any).timeline

describe('wave clock and climax window (report § 0.3)', () => {
  it('the wave grid: 0:30, every 30 s, 25 s from 14:00, 20 s from 30:00', () => {
    const w = waveSpawns()
    expect(w.slice(0, 4)).toEqual([30, 60, 90, 120])
    expect(w).toContain(810); expect(w).toContain(840); expect(w).toContain(865)
    expect(w).toContain(1790); expect(w).toContain(1815); expect(w).toContain(1835)
  })
  it('first objectives read the waves the report names', () => {
    // Dragon 5:00 → wave of 4:00, window 4:20-4:45; Grubs 8:00 → 7:00, 7:20-7:45; Herald 15:00 → 14:00, 14:25-14:50; Baron 20:00 → 19:00, 19:25-19:50.
    expect(climaxWindow(300, 400)).toEqual({ spawnSec: 240, fromSec: 260, toSec: 285 })
    expect(climaxWindow(480, 600)).toEqual({ spawnSec: 420, fromSec: 440, toSec: 465 })
    expect(climaxWindow(900, 1000)).toEqual({ spawnSec: 840, fromSec: 865, toSec: 890 })
    expect(climaxWindow(1200, 1300)).toEqual({ spawnSec: 1140, fromSec: 1165, toSec: 1190 })
  })
  it('the window ends before the take, and is null when the take comes before it starts', () => {
    expect(climaxWindow(300, 270)?.toSec).toBe(270)
    expect(climaxWindow(300, 250)).toBeNull()
  })
  it('thresholds are read from the spec: a longer walk moves the window', () => {
    const slow = { ...OBJECTIVE_RULES_SPEC.prio, waveTravelSec: 30 }
    expect(climaxWindow(300, 400, slow)?.fromSec).toBe(265)
  })
})

describe('a real game (EUW1_8052918848, anonymised)', () => {
  const blue = objectiveRules(match, timeline, 100) as ObjectiveRulesBlock
  const red = objectiveRules(match, timeline, 200) as ObjectiveRulesBlock

  it('reads the objectives of the game with their owner', () => {
    const count = (b: ObjectiveRulesBlock, kind: string, ours: boolean) => b.objectives.filter((o) => o.kind === kind && o.ours === ours).length
    // Hand count on the raw events: dragons 4 / 1, one camp of grubs each way, herald 1 / 0, baron 2 / 0.
    expect(count(blue, 'dragon', true)).toBe(4)
    expect(count(blue, 'dragon', false)).toBe(1)
    expect(count(blue, 'herald', true)).toBe(1)
    expect(count(blue, 'baron', true)).toBe(2)
    expect(count(red, 'dragon', true)).toBe(1)
    expect(count(red, 'baron', false)).toBe(2)
  })

  it('every objective reads its climax before the take, with a spawn that is not after the take', () => {
    for (const o of blue.objectives) {
      expect(o.spawnSec).toBeLessThanOrEqual(o.atSec)
      expect(o.refSec).toBeGreaterThanOrEqual(o.spawnSec)
      if (o.window) {
        expect(o.window[1]).toBeLessThanOrEqual(o.atSec)
        expect(o.window[1]).toBeGreaterThan(o.window[0])
      }
    }
  })

  it('the two sides read the same game as mirrors: ours <-> theirs, same proof', () => {
    const mirror = (s: string) => (s === 'ours' ? 'theirs' : s === 'theirs' ? 'ours' : s)
    expect(red.objectives).toHaveLength(blue.objectives.length)
    blue.objectives.forEach((b, i) => {
      const r = red.objectives[i]
      expect(r.kind).toBe(b.kind)
      expect(r.sideLane.state).toBe(mirror(b.sideLane.state))
      expect(r.sideLane.proof).toBe(b.sideLane.proof)
      expect(r.mid.state).toBe(mirror(b.mid.state))
      expect(r.ours).toBe(!b.ours)
    })
  })

  it('an objective taken by us has no contested / crossmap reading; one taken by them has a contested flag', () => {
    for (const o of blue.objectives) {
      if (o.ours) { expect(o.contested).toBeNull(); expect(o.crossmap).toBeNull() } else expect(typeof o.contested).toBe('boolean')
      if (o.crossmap) expect(o.contested).toBe(false)
    }
  })

  it('knows the roles of our side', () => {
    expect(blue.roles.map((r) => r.role).sort()).toEqual(['BOTTOM', 'JUNGLE', 'MIDDLE', 'TOP', 'UTILITY'])
    expect(blue.roles.every((r) => r.pid >= 1 && r.pid <= 5)).toBe(true)
  })

  it('duo deaths belong to our ADC or support and carry a known fault', () => {
    for (const b of [blue, red]) {
      const pids = new Set(b.roles.filter((r) => r.role === 'BOTTOM' || r.role === 'UTILITY').map((r) => r.pid))
      for (const d of b.duo.deaths) {
        expect(pids.has(d.pid)).toBe(true)
        expect(['support', 'adc', 'shared', 'none']).toContain(d.fault)
        expect(d.after14).toBe(d.tSec >= 840)
      }
    }
  })

  it('null-safe: no frames, no participants', () => {
    expect(objectiveRules({ info: { participants: [] } }, { info: { frames: [] } }, 100)).toBeNull()
  })
})

describe('figures per player and per team', () => {
  const blue = objectiveRules(match, timeline, 100) as ObjectiveRulesBlock
  const roleOf = (role: string) => blue.roles.find((r) => r.role === role)!.pid

  it('null without a block, or with another version, or with an unknown player', () => {
    expect(ruleCountsOf(undefined, 1)).toBeNull()
    expect(ruleCountsOf({ ...blue, v: 0 }, 1)).toBeNull()
    expect(ruleCountsOf(blue, 99)).toBeNull()
  })

  it('a laner reads the prio of their own lane only', () => {
    const top = ruleCountsOf(blue, roleOf('TOP'))!
    const adc = ruleCountsOf(blue, roleOf('BOTTOM'))!
    const mid = ruleCountsOf(blue, roleOf('MIDDLE'))!
    expect(top.prio.own.lane).toBe('TOP')
    expect(adc.prio.own.lane).toBe('BOT')
    expect(mid.prio.own.lane).toBe('MID')
    const early = blue.objectives.filter((o) => o.window && o.refSec <= OBJECTIVE_RULES_SPEC.prio.untilSec)
    expect(top.prio.own.n).toBe(early.filter((o) => o.side === 'top').length)
    expect(adc.prio.own.n).toBe(early.filter((o) => o.side === 'bot').length)
    expect(mid.prio.own.n).toBe(early.length)
    const t = top.prio.own.tally
    expect(t.ours + t.even + t.theirs + t.unknown).toBe(top.prio.own.n)
  })

  it('only the jungler carries the engagement and only the support the help', () => {
    const jg = ruleCountsOf(blue, roleOf('JUNGLE'))!
    const top = ruleCountsOf(blue, roleOf('TOP'))!
    const sup = ruleCountsOf(blue, roleOf('UTILITY'))!
    expect(jg.prio.jungle.engaged).toBeGreaterThan(0)
    expect(jg.prio.jungle.engaged).toBe(jg.prio.jungle.sidePrio + jg.prio.jungle.midPrioOnly + jg.prio.jungle.noPrio)
    expect(top.prio.jungle.engaged).toBe(0)
    expect(sup.prio.support.total).toBeGreaterThan(0)
    expect(jg.prio.support.total).toBe(0)
  })

  it('crossmap: the verdicts add up to the uncontested objectives, the player judged only in the three roles', () => {
    const team = ruleCountsOf(blue, null)!
    for (const s of [team.crossmap.before14, team.crossmap.after14]) expect(s.traded + s.noTrade + s.justified).toBe(s.uncontested)
    expect(team.crossmap.objectivesTheirs).toBe(blue.objectives.filter((o) => !o.ours).length)
    expect(ruleCountsOf(blue, roleOf('TOP'))!.crossmap.before14.judged).toBe(0)
    expect(ruleCountsOf(blue, roleOf('BOTTOM'))!.crossmap.after14.judged).toBe(0)
  })

  it('sums the games, ignores games without a block, null when none has one', () => {
    const a = ruleCountsOf(blue, null)!
    const sum = sumRuleCounts([a, null, a, undefined])!
    expect(sum.games).toBe(2)
    expect(sum.prio.objectives).toBe(a.prio.objectives * 2)
    expect(sum.duo.advances).toBe(a.duo.advances * 2)
    expect(sumRuleCounts([null, undefined])).toBeNull()
    expect(emptyRuleCounts().games).toBe(0)
  })
})

// A game made of a few frames: where the fault of a botlane death lies.
function synth(opts: { adcGoldDiff?: number; kill: { victim: number; at: number; pos: { x: number; y: number }; killer: number; assists: number[] }; adc: { x: number; y: number }; sup: { x: number; y: number } }) {
  const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
  const participants = Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, teamId: i < 5 ? 100 : 200, teamPosition: roles[i % 5] }))
  const frame = (m: number) => ({
    timestamp: m * 60000,
    participantFrames: Object.fromEntries(participants.map((p) => {
      const adc = p.participantId === 4, sup = p.participantId === 5
      const position = adc ? opts.adc : sup ? opts.sup : p.teamId === 100 ? { x: 2000, y: 2000 } : { x: 12800, y: 12800 }
      const gold = 2000 + (adc ? (opts.adcGoldDiff ?? 0) : 0)
      return [String(p.participantId), { participantId: p.participantId, position, totalGold: gold, xp: 1500, level: 5, minionsKilled: 20, jungleMinionsKilled: 0 }]
    })),
    events: m === 3 ? [{ type: 'CHAMPION_KILL', timestamp: opts.kill.at, killerId: opts.kill.killer, victimId: opts.kill.victim, assistingParticipantIds: opts.kill.assists, position: opts.kill.pos }] : [],
  })
  return { match: { info: { gameVersion: '16.20.1', participants } }, timeline: { info: { frames: [0, 1, 2, 3, 4, 5].map(frame) } } }
}

describe('duo attribution (report § 3.2)', () => {
  const run = (g: ReturnType<typeof synth>) => {
    const tr = buildLedgerTrack(g.match, g.timeline)!
    const block = objectiveRules(g.match, g.timeline, 100, tr)!
    return block.duo.deaths
  }
  const far = { x: 7000, y: 7000 }
  it('the support roamed (mid of the map), the ADC dies out of his tower to two: shared fault', () => {
    const d = run(synth({ adc: { x: 12500, y: 2800 }, sup: far, kill: { victim: 4, at: 190000, pos: { x: 12500, y: 2800 }, killer: 6, assists: [7] } }))
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ role: 'BOTTOM', fault: 'shared', reason: 'out-of-tower', roam: true })
  })
  it('the support is in base and the ADC dies past the middle of the lane: the ADC\'s fault', () => {
    const d = run(synth({ adc: { x: 12500, y: 2800 }, sup: { x: 400, y: 450 }, kill: { victim: 4, at: 190000, pos: { x: 12500, y: 2800 }, killer: 6, assists: [7] } }))
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ role: 'BOTTOM', fault: 'adc', reason: 'adc-advanced', attackers: 2, after14: false })
  })
  it('the ADC far behind in gold dies: nobody is at fault', () => {
    const d = run(synth({ adcGoldDiff: -2500, adc: { x: 12500, y: 2800 }, sup: far, kill: { victim: 4, at: 190000, pos: { x: 12500, y: 2800 }, killer: 6, assists: [7] } }))
    expect(d[0]).toMatchObject({ fault: 'none' })
  })
  it('the ADC dies next to the support: not a duo death', () => {
    const d = run(synth({ adc: { x: 12500, y: 2800 }, sup: { x: 12000, y: 2500 }, kill: { victim: 4, at: 190000, pos: { x: 12500, y: 2800 }, killer: 6, assists: [7] } }))
    expect(d).toHaveLength(0)
  })
  it('the support pushed past the middle alone dies to two: the support\'s fault', () => {
    const d = run(synth({ adc: far, sup: { x: 12500, y: 2800 }, kill: { victim: 5, at: 190000, pos: { x: 12500, y: 2800 }, killer: 6, assists: [7] } }))
    expect(d[0]).toMatchObject({ role: 'UTILITY', fault: 'support', reason: 'support-advanced' })
  })
  it('a lone attacker is never a duo fault for the support', () => {
    const d = run(synth({ adc: far, sup: { x: 12500, y: 2800 }, kill: { victim: 5, at: 190000, pos: { x: 12500, y: 2800 }, killer: 6, assists: [] } }))
    expect(d[0]).toMatchObject({ fault: 'none', reason: 'solo-kill' })
  })
  it('exposes duoDeaths for direct use', () => {
    expect(typeof duoDeaths).toBe('function')
  })
})

describe('type surface the front relies on', () => {
  it('an entry is fully serialisable (it lives in the cached summary)', () => {
    const blue = objectiveRules(match, timeline, 100) as ObjectiveRulesBlock
    const o: ObjectiveRuleEntry = blue.objectives[0]
    expect(JSON.parse(JSON.stringify(o))).toEqual(o)
    expect(JSON.stringify(blue).length).toBeLessThan(20_000)
  })
})
