/**
 * V5 brief (laning phase): the merged AscendCodex, the QCM options it adds,
 * and the five detector patterns, each threshold tested on both sides.
 * Also the engine-wide guarantees the brief asks for: no duplicate fiche,
 * no duplicate trigger, no unofficial video, no two identical options on one card.
 */
import { describe, it, expect } from 'vitest'
import { CODEX, CODEX_ALIASES, codexById, codexFor, isOfficialVideo } from '../../src/lib/microReview/codex'
import {
  buildQcm, contextsOf, optionsFor, choiceStats, QCM_CONTEXTS, CODEX_DIVE, CODEX_BACK_TIMER, CODEX_LEVEL_SPIKE, CODEX_RANGE_MELEE,
  CODEX_VOLATILITY, CODEX_TRACKING, CODEX_WAVE_SIDE, CODEX_ARCHETYPES, type QcmContext, type PastAnswer,
} from '../../src/lib/microReview/smartQcm'
import { analyzeGame, DETECTOR_SPEC, MOMENT_PATTERNS, type CriticalMoment, type MomentFacts, type MomentPattern } from '../../src/lib/microReview/anomalyDetector'
import { OUTER_TURRETS, laneOf, zoneOf } from '../../src/lib/microReview/geometry'
import { attackTypeOf } from '../../src/lib/microReview/championClasses'
import { buildGame, at } from './microReviewFixtures'

// The engine-wide checks below run over every context and pattern the code declares (V6 ones included).
const ALL_CONTEXTS: readonly QcmContext[] = QCM_CONTEXTS
const ALL_PATTERNS: readonly MomentPattern[] = MOMENT_PATTERNS
const V5_NEW = ['codex_mechanics_hit_or_miss_adaptation_and_internal_kiting', 'codex_mechanics_levelup_timers_7th_14th_minion_premove',
  'codex_tempo_lane_volatility_control_short_vs_long', 'codex_mechanics_micro_movements_stutter_bait_fake_retreat_flash', 'codex_mechanics_range_vs_melee_100to0_vs_volatility']
const V5_MERGED: Record<string, string> = {
  codex_mechanics_triple_cd_sync_malphite_camille: 'codex_mechanics_trading_4laws_cooldown_punish',
  codex_mechanics_two_step_posturing_and_lane_side_minion_rule: 'codex_mechanics_lane_quadrants_minion_wall',
  codex_tempo_back_priority_freeze_recall_4minion_rule_cheater: 'overstay-any-early',
  codex_mechanics_cs_priority_matrix_spell_discipline_proxy: 'cs-any-early',
  codex_tempo_attacking_tp_and_slow_motion_dive_and_lead_protection: 'dive-any-early',
}

const moment = (facts: MomentFacts, trigger: CriticalMoment['trigger'] = 'critical-death', over: Partial<CriticalMoment> = {}): CriticalMoment => ({
  key: `${trigger}@200`, trigger, gameTimeSec: 200, severity: 0.3, position: { x: 1500, y: 9000 }, zone: 'top-lane', lane: 'TOP', territory: 'own',
  winProbBefore: 0.5, winProbAfter: 0.45, facts, ...over,
})

// ── Codex: no duplicates, merged content, terminology ─────────────────────

describe('AscendCodex — no duplicate fiche', () => {
  it('ids are unique, and so are the headlines in both languages', () => {
    expect(new Set(CODEX.map((e) => e.id)).size).toBe(CODEX.length)
    expect(new Set(CODEX.map((e) => e.headline.fr)).size).toBe(CODEX.length)
    expect(new Set(CODEX.map((e) => e.headline.en)).size).toBe(CODEX.length)
  })
  it('an alias never shadows a real entry and always lands on one', () => {
    for (const [from, to] of Object.entries(CODEX_ALIASES)) {
      expect(CODEX.some((e) => e.id === from), from).toBe(false)
      expect(codexById(from)?.id, from).toBe(to)
    }
  })
  it('the two internal duplicates are merged: one fiche each, the old ids still resolve', () => {
    expect(codexById('trade-any-early')!.id).toBe('codex_mechanics_trading_4laws_cooldown_punish')
    expect(codexById('trade-any-early')!.tacticalRule.fr).toContain('3–5 s')
    expect(codexById('overstay-any-mid')!.id).toBe('codex_tempo_single_action_window_wave_cheating')
    expect(codexById('overstay-any-mid')!.tacticalRule.fr).toContain('ouvre 30 s')
    // Merged fiches took the place of the generic ones: still the default for their tag.
    expect(codexFor('bad-trade', 'TOP', 'early')!.id).toBe('codex_mechanics_trading_4laws_cooldown_punish')
    expect(codexFor('overstay', 'MIDDLE', 'mid')!.id).toBe('codex_tempo_single_action_window_wave_cheating')
  })
  it('a QCM reason always points to the same fiche, whatever the context', () => {
    const seen = new Map<string, string>()
    for (const c of ALL_CONTEXTS) for (const facts of [{}, { secondsSinceOwnPlay: 10 }, { hpPct: 20 }, { playerWarded: true }, { nearObjective: true }]) {
      for (const o of optionsFor(c, facts)) {
        const key = `${o.tagSlug}|${o.reason}`
        const target = o.codexId ?? ''
        if (seen.has(key)) expect(seen.get(key), key).toBe(target)
        seen.set(key, target)
      }
    }
  })
  it('every detector pattern maps to exactly one QCM context', () => {
    const owner = new Map<QcmContext, MomentPattern>()
    for (const pattern of ALL_PATTERNS) {
      const triggers: CriticalMoment['trigger'][] = ['critical-death', 'absent-objective', 'early-deficit']
      const ctx = new Set(triggers.map((t) => contextsOf(moment({ pattern }, t)).join(',')))
      expect(ctx.size, pattern).toBe(1)
      const [only] = contextsOf(moment({ pattern }))
      expect(contextsOf(moment({ pattern })), pattern).toHaveLength(1)
      // tempo-hesitation / late recall / pit-chokepoint share no context with another pattern, except the two jungle-cycle ones.
      if (owner.has(only) && !(only === 'jungle-cycle')) throw new Error(`${pattern} and ${owner.get(only)} share the context ${only}`)
      owner.set(only, pattern)
    }
  })
})

describe('AscendCodex — V5 fiches', () => {
  it('adds the 5 new fiches, bilingual, text only, all early game', () => {
    for (const id of V5_NEW) {
      const e = codexById(id)!
      expect(e, id).not.toBeNull()
      expect(e.id).toBe(id)
      expect(e.phase).toBe('early')
      expect(e.videoExamples).toEqual([])
      for (const f of [e.headline, e.tacticalRule, e.drillObjective]) {
        expect(f.fr.length).toBeGreaterThan(20)
        expect(f.en.length).toBeGreaterThan(20)
      }
    }
  })
  it('the 5 others are merged into the fiche that already covered the concept, without losing their numbers', () => {
    for (const [v5, target] of Object.entries(V5_MERGED)) expect(codexById(v5)?.id, v5).toBe(target)
    const text = (id: string) => `${codexById(id)!.tacticalRule.fr} ${codexById(id)!.drillObjective.fr}`
    expect(text('codex_mechanics_triple_cd_sync_malphite_camille')).toMatch(/passif de bouclier actif \+ rune clé rechargée/)
    expect(text('codex_mechanics_triple_cd_sync_malphite_camille')).toMatch(/Comet, Grasp, Manaflow, Electrocute/)
    expect(text('codex_mechanics_two_step_posturing_and_lane_side_minion_rule')).toMatch(/40 % PV/)
    expect(text('codex_mechanics_two_step_posturing_and_lane_side_minion_rule')).toMatch(/au moins 4 sbires alliés/)
    expect(text('codex_tempo_back_priority_freeze_recall_4minion_rule_cheater')).toMatch(/4 à 5 sbires d'avance/)
    expect(text('codex_tempo_back_priority_freeze_recall_4minion_rule_cheater')).toMatch(/3 sbires ou moins/)
    expect(text('codex_tempo_back_priority_freeze_recall_4minion_rule_cheater')).toMatch(/90 % PV/)
    expect(text('codex_mechanics_cs_priority_matrix_spell_discipline_proxy')).toMatch(/19\/19 CS/)
    expect(text('codex_mechanics_cs_priority_matrix_spell_discipline_proxy')).toMatch(/entre T1 et T2/)
    expect(text('codex_tempo_attacking_tp_and_slow_motion_dive_and_lead_protection')).toMatch(/1-pour-0/)
    expect(text('codex_tempo_attacking_tp_and_slow_motion_dive_and_lead_protection')).toMatch(/en 2\/0/)
    expect(text(CODEX_LEVEL_SPIKE)).toMatch(/7e sbire/)
    expect(text(CODEX_LEVEL_SPIKE)).toMatch(/2e sbire de la 3e wave/)
    expect(text(CODEX_RANGE_MELEE)).toMatch(/85 % PV/)
  })
  it('the fiches no detector can trigger are still reachable through their tag ("Autre cause…")', () => {
    expect(codexFor('whiff-skillshot', 'TOP', 'early')!.id).toBe('codex_mechanics_hit_or_miss_adaptation_and_internal_kiting')
    expect(codexFor('bad-engage-angle', 'MIDDLE', 'early')!.id).toBe('codex_mechanics_micro_movements_stutter_bait_fake_retreat_flash')
    expect(codexFor('bad-threat-assessment', 'TOP', 'early')!.id).toBe(CODEX_LEVEL_SPIKE)
    expect(codexFor('dove-tower', 'TOP', 'early')!.id).toBe(CODEX_DIVE)
  })
})

describe('AscendCodex — rights and terminology', () => {
  const raw = JSON.stringify(CODEX)
  it('every video is an official LoL Esports segment; the V5 fiches have none', () => {
    for (const e of CODEX) for (const v of e.videoExamples ?? []) expect(isOfficialVideo(v), e.id).toBe(true)
    for (const id of [...V5_NEW, ...Object.values(V5_MERGED)]) expect(codexById(id)!.videoExamples ?? [], id).toEqual([])
  })
  it('no proprietary jargon, no rank name, no creator or coach name', () => {
    expect(raw).not.toMatch(/2L1L|1\/8 ?fog|r[eè]gle du 1\/8|arcade|tokens?\b|jetons?/i)
    expect(raw).not.toMatch(/\b(iron|bronze|silver|platinum|emerald|diamond|grandmaster|challenger)\b/i)
    expect(raw).not.toMatch(/caedrel|coach curtis|skill ?capped|lol ?coaching|tarzaned|nemesis|thebausffs|youtube\.com\/@/i)
  })
  it('keeps LoL jargon in English in the French text', () => {
    const fr = CODEX.map((e) => [e.headline.fr, e.tacticalRule.fr, e.drillObjective.fr].join(' ')).join(' ')
    expect(fr).not.toMatch(/\bvagues?\b/i)
    expect(fr).not.toMatch(/temps de recharge|contre-gank/i)
  })
})

// ── QCM: one event, never two identical options ───────────────────────────

describe('SmartQCMGenerator — one event, distinct options', () => {
  const habit: PastAnswer[] = Array.from({ length: 4 }, () => ({ role: 'TOP', champion: 'Darius', tagSlug: 'whiff-skillshot', viaOther: true }))
  const shapes: MomentFacts[] = [
    { alliesNearby: 0, enemiesInvolved: 1 }, { alliesNearby: 0, enemiesInvolved: 3 }, { alliesNearby: 2, enemiesInvolved: 4 }, { alliesNearby: 1, enemiesInvolved: 4 },
    { nearObjective: true, objectiveLost: 'baron', goldInPocket: 1650, alliesNearby: 0, enemiesInvolved: 2, hpPct: 20, levelDeficit: 2, secondsSinceOwnPlay: 10 },
    { alliedBaron: true, alliesNearby: 1, enemiesInvolved: 3 }, { hpPct: 20, goldInPocket: 1500, alliesNearby: 0, enemiesInvolved: 1 },
    ...ALL_PATTERNS.map((pattern) => ({ pattern })), { pattern: 'gank-timer', gankWindow: 1, hpPct: 30 } as MomentFacts,
    { pattern: 'range-melee-volatility', attackType: 'melee', laneHpPct: 40, opponentHpPct: 90 } as MomentFacts,
  ]
  const triggers: CriticalMoment['trigger'][] = ['critical-death', 'absent-objective', 'early-deficit']

  it('never two options with the same diagnosis label, nor the same tag', () => {
    let cards = 0
    for (const facts of shapes) for (const trigger of triggers) for (const t of [3 * 60, 7 * 60, 16 * 60, 30 * 60]) for (const zone of ['top-lane', 'mid-lane', 'enemy-jungle'] as const)
      for (const stats of [undefined, choiceStats(habit, 'TOP', 'Darius')]) {
        const card = buildQcm(moment(facts, trigger, { gameTimeSec: t, zone, territory: 'enemy' }), stats)
        cards++
        expect(new Set(card.options.map((o) => o.id)).size).toBe(card.options.length)
        expect(new Set(card.options.map((o) => o.reason)).size, JSON.stringify(card.options)).toBe(card.options.length)
        const tags = card.options.filter((o) => o.tagSlug).map((o) => o.tagSlug)
        expect(new Set(tags).size, JSON.stringify(card.options)).toBe(tags.length)
      }
    expect(cards).toBeGreaterThan(1000)
  })
  it('every linked fiche of the new contexts exists and records one of its own tags', () => {
    for (const c of ['tower-dive', 'level-spike', 'back-timer', 'range-melee', 'cheater-recall', 'gank-timer'] as const) {
      for (const o of [...optionsFor(c), ...optionsFor(c, { hpPct: 20 })].filter((x) => x.codexId)) {
        const e = codexById(o.codexId!)!
        expect(e, o.codexId).not.toBeNull()
        expect([e.mistakeSlug, ...(e.mistakeSlugs ?? [])], `${c} → ${o.codexId}`).toContain(o.tagSlug)
      }
    }
  })
})

describe('SmartQCMGenerator — V5 cards', () => {
  it.each([
    [{ pattern: 'tower-dive-one-for-one', killGapSec: 2, turretLane: 'TOP' }, 'critical-death', 'dove-tower', 'diveOneForOne', CODEX_DIVE, 'diveOneForOne'],
    [{ pattern: 'level-up-spike', spikeLevel: 3 }, 'critical-death', 'bad-threat-assessment', 'levelSpike', CODEX_LEVEL_SPIKE, 'levelSpike'],
    [{ pattern: 'back-timer-missed', hpPct: 22, hpSnapshotAgeSec: 30, goldInPocket: 950 }, 'critical-death', 'overstay', 'backTimer', CODEX_BACK_TIMER, 'backTimer'],
    [{ pattern: 'range-melee-volatility', attackType: 'ranged', laneHpPct: 52 }, 'critical-death', 'bad-trade', 'rangeMelee', CODEX_RANGE_MELEE, 'rangedChunked'],
    [{ pattern: 'cheater-recall', recallHpPct: 88, levelsBehind: 1 }, 'early-deficit', 'late-back', 'cheaterRecall', CODEX_BACK_TIMER, 'cheaterRecall'],
  ] as const)('%o → choice [1] is the linked fiche', (facts, trigger, tag, reason, codexId, head) => {
    const card = buildQcm(moment(facts as MomentFacts, trigger))
    expect(card.options[0]).toMatchObject({ tagSlug: tag, reason, codexId })
    expect(card.options).toHaveLength(3)
    expect(card.summary.head.key).toBe(head)
  })
  it('summaries carry the facts the detector proved', () => {
    expect(buildQcm(moment({ pattern: 'tower-dive-one-for-one', killGapSec: 3 })).summary.head).toEqual({ key: 'diveOneForOne', params: { sec: 3 } })
    expect(buildQcm(moment({ pattern: 'back-timer-missed', hpPct: 22, hpSnapshotAgeSec: 30, goldInPocket: 950 })).summary.extras)
      .toEqual([{ key: 'hpBefore', params: { pct: 22, sec: 30 } }, { key: 'gold', params: { gold: 950 } }])
    const melee = buildQcm(moment({ pattern: 'range-melee-volatility', attackType: 'melee', laneHpPct: 41, opponentHpPct: 92 }))
    expect(melee.summary).toMatchObject({ head: { key: 'meleeChunked', params: { pct: 41 } }, extras: [{ key: 'opponentHp', params: { pct: 92 } }] })
    expect(buildQcm(moment({ pattern: 'cheater-recall', recallHpPct: 88, levelsBehind: 2 }, 'early-deficit')).summary.extras).toEqual([{ key: 'levelsBehind', params: { count: 2 } }])
  })
  it('range against melee keeps the wave-side and archetype fiches as the other readings', () => {
    const card = buildQcm(moment({ pattern: 'range-melee-volatility', attackType: 'ranged', laneHpPct: 50 }))
    expect(card.options.map((o) => o.codexId)).toEqual([CODEX_RANGE_MELEE, CODEX_WAVE_SIDE, CODEX_ARCHETYPES])
  })
  it('a 1-for-1 dive has a justified way out (the kill was worth it)', () => {
    expect(buildQcm(moment({ pattern: 'tower-dive-one-for-one' })).options.at(-1)).toMatchObject({ outcome: 'justified', reason: 'diveTrade' })
  })
  it('a gank taken under 50 % HP also reads as a lane left too volatile; above, the card is unchanged', () => {
    const low = buildQcm(moment({ pattern: 'gank-timer', gankWindow: 1, hpPct: 49 }))
    expect(low.options.map((o) => [o.reason, o.codexId ?? null])).toEqual([['gankTimer', CODEX_TRACKING], ['laneVolatility', CODEX_VOLATILITY], ['trinketUnused', null]])
    const high = buildQcm(moment({ pattern: 'gank-timer', gankWindow: 1, hpPct: 50 }))
    expect(high.options.map((o) => o.reason)).toEqual(['gankTimer', 'trinketUnused', 'waveState'])
    expect(buildQcm(moment({ pattern: 'gank-timer', gankWindow: 1 })).options.map((o) => o.reason)).toEqual(['gankTimer', 'trinketUnused', 'waveState'])
  })
})

// ── Detector: the five V5 patterns ────────────────────────────────────────

type Game = ReturnType<typeof buildGame>
type P = { x: number; y: number }
const run = (g: Game) => analyzeGame(g.match, g.timeline, g.selector)!
const withPattern = (g: Game, pattern: MomentPattern) => run(g).moments.find((m) => m.facts.pattern === pattern)
const patternsOf = (g: Game) => run(g).moments.map((m) => m.facts.pattern)
const kill = (ts: number, victimId: number, killerId: number, assists: number[] = [], position?: P, extra: Record<string, unknown> = {}) =>
  ({ type: 'CHAMPION_KILL', timestamp: ts, victimId, killerId, assistingParticipantIds: assists, ...(position ? { position } : {}), ...extra })
const levelUp = (ts: number, participantId: number, level: number) => ({ type: 'LEVEL_UP', timestamp: ts, participantId, level })
const hp = (pct: number) => ({ championStats: { health: pct * 10, healthMax: 1000 } })
// Player 1 (blue top) against participant 6 (red top); the enemy jungler is participant 7.
const RED_T1_TOP = OUTER_TURRETS[200].TOP
const TOP_LANE: P = { x: 1500, y: 9000 }
const RIVER: P = { x: 5000, y: 9500 }

describe('detector — the V5 numbers', () => {
  it('are the ones of the brief', () => {
    expect(DETECTOR_SPEC.dive).toEqual({ untilSec: 840, turretRadius: 850, afterKillSec: 4 })
    expect(DETECTOR_SPEC.levelSpike).toEqual({ untilSec: 270, windowSec: 10, levels: [2, 3] })
    expect(DETECTOR_SPEC.backTimer).toEqual({ untilSec: 600, hpPct: 35, gold: 800, withinSec: 40 })
    expect(DETECTOR_SPEC.rangeMelee).toEqual({ untilSec: 480, rangedHp: 60, rangedMaxLevel: 3, meleeHp: 50, meleeMaxLevel: 4, opponentHp: 85 })
    // Recall seen at 3:00 = a back between 2:35 and 3:15; HP read at 2:00, levels at 4:00; Teleport is spell 12.
    expect(DETECTOR_SPEC.cheaterRecall).toEqual({ atSec: 180, anchorSec: 155, hpBeforeSec: 120, hpPct: 75, levelAtSec: 240, levelDeficit: 1, teleportSpellId: 12 })
  })
})

describe('pattern — 1-for-1 tower dive (laning phase)', () => {
  const S = DETECTOR_SPEC.dive
  const dive = (o: { killAt?: number; deathAt?: number; offset?: number; killer?: number; assists?: number[]; damageBy?: number[]; extra?: any[] } = {}) => {
    const killAt = o.killAt ?? at(5)
    const near = { x: RED_T1_TOP.x, y: RED_T1_TOP.y - (o.offset ?? 600) }
    return buildGame({ minutes: 20, me: 1, events: [
      kill(killAt, 6, 1, [], near),
      kill(o.deathAt ?? killAt + 2000, 1, o.killer ?? 0, o.assists ?? [], near, { victimDamageReceived: (o.damageBy ?? [0]).map((participantId) => ({ participantId, type: participantId ? 'CHAMPION' : 'TOWER' })) }),
      ...(o.extra ?? []),
    ] })
  }
  it('death within 4 s of the kill, inclusive', () => {
    expect(withPattern(dive({ deathAt: at(5) + 4000 }), 'tower-dive-one-for-one')).toMatchObject({ trigger: 'critical-death', facts: { killGapSec: 4, turretLane: 'TOP' } })
    expect(withPattern(dive({ deathAt: at(5) + 4001 }), 'tower-dive-one-for-one')).toBeUndefined()
  })
  it('the kill within 850 units of the enemy T1, inclusive', () => {
    expect(withPattern(dive({ offset: S.turretRadius }), 'tower-dive-one-for-one')).toBeDefined()
    expect(withPattern(dive({ offset: S.turretRadius + 1 }), 'tower-dive-one-for-one')).toBeUndefined()
  })
  it('killed by the tower or the defender, never with the enemy jungler (credited or in the damage)', () => {
    expect(withPattern(dive({ killer: 8, damageBy: [8, 0] }), 'tower-dive-one-for-one')).toBeDefined()
    expect(withPattern(dive({ killer: 8, assists: [7] }), 'tower-dive-one-for-one')).toBeUndefined()
    expect(withPattern(dive({ killer: 0, damageBy: [0, 7] }), 'tower-dive-one-for-one')).toBeUndefined()
  })
  it('the T1 must still stand, and only before 14:00', () => {
    const fallen = { type: 'BUILDING_KILL', timestamp: at(4), teamId: 200, killerId: 1, towerType: 'OUTER_TURRET', laneType: 'TOP_LANE', buildingType: 'TOWER_BUILDING' }
    expect(withPattern(dive({ extra: [fallen] }), 'tower-dive-one-for-one')).toBeUndefined()
    expect(withPattern(dive({ killAt: S.untilSec * 1000 - 3000 }), 'tower-dive-one-for-one')).toBeDefined()
    expect(withPattern(dive({ killAt: S.untilSec * 1000 }), 'tower-dive-one-for-one')).toBeUndefined()
  })
})

describe('pattern — killed on the lane opponent\'s level 2 or 3', () => {
  const S = DETECTOR_SPEC.levelSpike
  const spike = (o: { deathAt?: number; upAt?: number; level?: number; mine?: number[]; assists?: number[] } = {}) => {
    const deathAt = o.deathAt ?? 125_000
    return buildGame({ minutes: 8, me: 1, events: [
      levelUp(o.upAt ?? deathAt - 5000, 6, o.level ?? 2), ...(o.mine ?? []).map((t, k) => levelUp(t, 1, k + 2)),
      kill(deathAt, 1, 6, o.assists ?? [], TOP_LANE),
    ] })
  }
  it('within 10 s of the level-up, inclusive', () => {
    expect(withPattern(spike({ upAt: 125_000 - S.windowSec * 1000 }), 'level-up-spike')).toMatchObject({ facts: { spikeLevel: 2 } })
    expect(withPattern(spike({ upAt: 125_000 - S.windowSec * 1000 - 1 }), 'level-up-spike')).toBeUndefined()
  })
  it('levels 2 and 3 only, while the player is still below', () => {
    expect(withPattern(spike({ level: 3, mine: [100_000] }), 'level-up-spike')).toMatchObject({ facts: { spikeLevel: 3 } })
    expect(withPattern(spike({ level: 3, mine: [100_000, 110_000] }), 'level-up-spike')).toBeUndefined()
    expect(withPattern(spike({ level: 2, mine: [100_000] }), 'level-up-spike')).toBeUndefined()
    expect(withPattern(spike({ level: 4 }), 'level-up-spike')).toBeUndefined()
  })
  it('until 4:30 inclusive, and only a duel with the lane opponent', () => {
    expect(withPattern(spike({ deathAt: S.untilSec * 1000 }), 'level-up-spike')).toBeDefined()
    expect(withPattern(spike({ deathAt: S.untilSec * 1000 + 1000 }), 'level-up-spike')).toBeUndefined()
    expect(withPattern(spike({ assists: [7] }), 'level-up-spike')).toBeUndefined()
  })
})

describe('pattern — back timer missed (before 10:00)', () => {
  const S = DETECTOR_SPEC.backTimer
  const late = (o: { pct?: number; gold?: number; deathAt?: number; where?: P; from?: P; killer?: number } = {}) => {
    const deathAt = o.deathAt ?? at(5, 30)
    const fi = Math.floor(deathAt / 60_000)
    return buildGame({ minutes: 12, me: 1,
      frame: (i, pid) => (pid === 1 && i === fi ? { ...hp(o.pct ?? 30), currentGold: o.gold ?? 900, position: o.from ?? TOP_LANE } : undefined),
      events: [kill(deathAt, 1, o.killer ?? 8, [], o.where ?? RIVER)] })
  }
  it('reads the positions it relies on', () => {
    expect(laneOf(TOP_LANE)).toBe('TOP')
    expect(laneOf(RIVER)).toBe('JUNGLE')
  })
  it('under 35 % HP, strictly; 800 gold or more', () => {
    expect(withPattern(late({ pct: 34 }), 'back-timer-missed')).toMatchObject({ facts: { hpPct: 34 } })
    expect(withPattern(late({ pct: S.hpPct }), 'back-timer-missed')).toBeUndefined()
    expect(withPattern(late({ gold: S.gold }), 'back-timer-missed')).toBeDefined()
    expect(withPattern(late({ gold: S.gold - 1 }), 'back-timer-missed')).toBeUndefined()
  })
  it('dead 10 to 40 s after the snapshot', () => {
    expect(withPattern(late({ deathAt: at(5, 10) }), 'back-timer-missed')).toBeDefined()
    expect(withPattern(late({ deathAt: at(5, 9) }), 'back-timer-missed')).toBeUndefined()
    expect(withPattern(late({ deathAt: at(5, 40) }), 'back-timer-missed')).toBeDefined()
    expect(withPattern(late({ deathAt: at(5, 41) }), 'back-timer-missed')).toBeUndefined()
  })
  it('in lane at the snapshot, dead in the river or jungle, before 10:00', () => {
    expect(withPattern(late({ where: TOP_LANE }), 'back-timer-missed')).toBeUndefined()
    expect(withPattern(late({ from: RIVER }), 'back-timer-missed')).toBeUndefined()
    expect(withPattern(late({ deathAt: at(9, 30) }), 'back-timer-missed')).toBeDefined()
    expect(withPattern(late({ deathAt: at(10, 30) }), 'back-timer-missed')).toBeUndefined()
  })
})

describe('pattern — range against melee (before 8:00)', () => {
  const S = DETECTOR_SPEC.rangeMelee
  const duel = (o: { me?: string; opp?: string; mine?: number; theirs?: number; level?: number; deathAt?: number; assists?: number[] } = {}) => buildGame({
    minutes: 10, me: 1, champions: { 1: o.me ?? 'Vayne', 6: o.opp ?? 'Darius' },
    frame: (i, pid) => (i === 2 && pid === 1 ? { ...hp(o.mine ?? 55), level: o.level ?? 2 } : i === 2 && pid === 6 ? hp(o.theirs ?? 90) : undefined),
    events: [kill(o.deathAt ?? at(4, 30), 1, 6, o.assists ?? [], TOP_LANE)],
  })
  it('knows the attack types it compares', () => {
    expect([attackTypeOf('Vayne'), attackTypeOf('Darius'), attackTypeOf('Jayce'), attackTypeOf('Kayle'), attackTypeOf('NewChamp')]).toEqual(['ranged', 'melee', 'ranged', 'melee', null])
  })
  it('ranged: under 60 % HP at level 3 or lower', () => {
    expect(withPattern(duel({ mine: 59 }), 'range-melee-volatility')).toMatchObject({ facts: { attackType: 'ranged', laneHpPct: 59 } })
    expect(withPattern(duel({ mine: S.rangedHp }), 'range-melee-volatility')).toBeUndefined()
    expect(withPattern(duel({ level: S.rangedMaxLevel }), 'range-melee-volatility')).toBeDefined()
    expect(withPattern(duel({ level: S.rangedMaxLevel + 1 }), 'range-melee-volatility')).toBeUndefined()
  })
  it('melee: under 50 % HP at level 4 or lower while the ranged stays above 85 %', () => {
    const melee = (o: Parameters<typeof duel>[0]) => duel({ me: 'Darius', opp: 'Vayne', mine: 49, theirs: 86, level: 4, ...o })
    expect(withPattern(melee({}), 'range-melee-volatility')).toMatchObject({ facts: { attackType: 'melee', laneHpPct: 49, opponentHpPct: 86 } })
    expect(withPattern(melee({ mine: S.meleeHp }), 'range-melee-volatility')).toBeUndefined()
    expect(withPattern(melee({ theirs: S.opponentHp }), 'range-melee-volatility')).toBeUndefined()
    expect(withPattern(melee({ level: S.meleeMaxLevel + 1 }), 'range-melee-volatility')).toBeUndefined()
  })
  it('a 1v1 with a melee/ranged pair of known champions, strictly before 8:00', () => {
    expect(withPattern(duel({ assists: [7] }), 'range-melee-volatility')).toBeUndefined()
    expect(withPattern(duel({ opp: 'Caitlyn' }), 'range-melee-volatility')).toBeUndefined()
    expect(withPattern(duel({ opp: 'NewChamp' }), 'range-melee-volatility')).toBeUndefined()
    expect(withPattern(duel({ deathAt: S.untilSec * 1000 - 1000 }), 'range-melee-volatility')).toBeDefined()
    expect(withPattern(duel({ deathAt: S.untilSec * 1000 }), 'range-melee-volatility')).toBeUndefined()
  })
})

describe('pattern — cheater recall that backfired', () => {
  const C = DETECTOR_SPEC.cheaterRecall
  const BASE: P = { x: 1000, y: 1000 }
  const recall = (o: { pct?: number; mine?: number; theirs?: number; where?: P; summoners?: Record<string, number>; events?: any[] } = {}) => {
    const g = buildGame({ minutes: 12, me: 1,
      frame: (i, pid) => {
        if (pid === 1 && i === 2) return hp(o.pct ?? 88)
        if (pid === 1 && i === 3) return { position: o.where ?? BASE }
        if (i === 4 && pid === 1) return { level: o.mine ?? 3 }
        if (i === 4 && pid === 6) return { level: o.theirs ?? 4 }
        return undefined
      }, events: o.events ?? [] })
    Object.assign(g.match.info.participants[0], o.summoners ?? {})
    return g
  }
  it('reads the base it relies on', () => expect(zoneOf(BASE, 100)).toBe('own-base'))
  it('in base at 3:00 from above 75 % HP at 2:00, a level behind at 4:00', () => {
    expect(withPattern(recall(), 'cheater-recall')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: C.anchorSec, facts: { recallHpPct: 88, levelsBehind: 1 } })
    expect(withPattern(recall({ pct: 76 }), 'cheater-recall')).toBeDefined()
    expect(withPattern(recall({ pct: C.hpPct }), 'cheater-recall')).toBeUndefined()
    expect(withPattern(recall({ theirs: 3 }), 'cheater-recall')).toBeUndefined()
    expect(withPattern(recall({ where: TOP_LANE }), 'cheater-recall')).toBeUndefined()
  })
  it('a Teleport the player held is only excused when Riot counts zero casts', () => {
    expect(withPattern(recall({ summoners: { summoner1Id: 12, summoner1Casts: 0, summoner2Id: 4 } }), 'cheater-recall')).toBeDefined()
    expect(withPattern(recall({ summoners: { summoner1Id: 12, summoner1Casts: 1, summoner2Id: 4 } }), 'cheater-recall')).toBeUndefined()
    expect(withPattern(recall({ summoners: { summoner1Id: 4, summoner2Id: 12 } }), 'cheater-recall')).toBeUndefined() // casts unknown
    expect(withPattern(recall({ summoners: { summoner1Id: 4, summoner2Id: 14 } }), 'cheater-recall')).toBeDefined()
  })
  it('alive from 2:00 to 4:00 (standing in base after a death is no recall)', () => {
    expect(withPattern(recall({ events: [kill(at(2, 40), 1, 6, [], TOP_LANE)] }), 'cheater-recall')).toBeUndefined()
  })
})

describe('detector — one death, one reading (most specific first)', () => {
  it('a low-HP death with gold during a gank window is the missed back timer, not the gank timer', () => {
    const g = buildGame({ minutes: 8, me: 1, frame: (i, pid) => (pid === 1 && i === 3 ? { ...hp(30), currentGold: 900, position: TOP_LANE } : undefined),
      events: [kill(at(3, 30), 1, 7, [], RIVER)] })
    expect(patternsOf(g)).toEqual(['back-timer-missed'])
  })
  it('a level-up death that is also a lost range/melee duel is the level-up', () => {
    const g = buildGame({ minutes: 8, me: 1, champions: { 1: 'Vayne', 6: 'Darius' },
      frame: (i, pid) => (pid === 1 && i === 1 ? { ...hp(50), level: 1 } : undefined),
      events: [levelUp(115_000, 6, 2), kill(at(2), 1, 6, [], TOP_LANE)] })
    expect(patternsOf(g)).toEqual(['level-up-spike'])
  })
  it('the same death is never reported twice', () => {
    const g = buildGame({ minutes: 20, me: 1, champions: { 1: 'Vayne', 6: 'Darius' },
      frame: (i, pid) => (pid === 1 && i === 4 ? { ...hp(30), currentGold: 900, position: TOP_LANE } : undefined),
      events: [levelUp(at(4, 15), 6, 3), kill(at(4, 20), 1, 6, [], RIVER)] })
    const moments = run(g).moments.filter((m) => m.trigger === 'critical-death')
    expect(moments).toHaveLength(1)
    expect(moments[0].facts.pattern).toBe('level-up-spike')
  })
})
