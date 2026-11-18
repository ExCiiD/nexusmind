/**
 * V7–V10 briefs (advanced jungle, pro jungle, pro mid lane, engage support): the 15 AscendCodex fiches, the QCM
 * cards they get, and the detectors, each threshold tested on both sides of its boundary. The checks that run over
 * every pattern and context (no duplicate trigger, no two identical options on one card) live in microReviewV5.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { CODEX, CODEX_ALIASES, codexById, codexFor } from '../../src/lib/microReview/codex'
import {
  buildQcm, optionsFor, QCM_CONTEXTS, CODEX_JGL_CLEAR, CODEX_JGL_INVADE_ORDER, CODEX_JGL_GANK, CODEX_JGL_MINUS, CODEX_JGL_ECONOMY,
  CODEX_JGL_T1_HERALD, CODEX_JGL_NEVER_FLEE, CODEX_JGL_INVADE_STOP, CODEX_JGL_VISION, CODEX_JGL_SMITE, CODEX_MID_MICRO, CODEX_MID_WAVES,
  CODEX_SUP_POST_CRASH, CODEX_SUP_POST6, CODEX_JUNGLE_CYCLE, CODEX_OBJ_SETUP,
} from '../../src/lib/microReview/smartQcm'
import { analyzeGame, DETECTOR_SPEC, MOMENT_PATTERNS, type CriticalMoment, type MomentFacts, type MomentPattern } from '../../src/lib/microReview/anomalyDetector'
import { BARON_PIT, DRAGON_PIT, laneOf, territoryOf, zoneOf } from '../../src/lib/microReview/geometry'
import { buildGame, at } from './microReviewFixtures'

const CODEX_SUP_ENGAGE = 'codex_support_engage_micro_cc_chain_exit_pathing_zone_c_crash'
const V7_IDS = [CODEX_JGL_CLEAR, CODEX_JGL_INVADE_ORDER, CODEX_JGL_GANK, CODEX_JGL_MINUS, CODEX_JGL_ECONOMY, CODEX_JGL_T1_HERALD, CODEX_JGL_NEVER_FLEE,
  CODEX_JGL_INVADE_STOP, CODEX_JGL_VISION, CODEX_JGL_SMITE, CODEX_MID_MICRO, CODEX_MID_WAVES, CODEX_SUP_ENGAGE, CODEX_SUP_POST_CRASH, CODEX_SUP_POST6]
const V7_PATTERNS = MOMENT_PATTERNS.slice(MOMENT_PATTERNS.indexOf('jungle-late-first-recall'))
/**
 * The briefs' qcmTrigger.condition → the detector patterns that implement it → the fiche of choice [1] (the fiche whose
 * text teaches that case). Conditions with no pattern cannot be read from Riot's timeline.
 */
const V7_TRIGGERS: Record<string, Array<[MomentPattern, string]>> = {
  JUNGLE_BAD_CAMPS_UP_GANK_OR_LATE_FIRST_RECALL: [['jungle-late-first-recall', CODEX_JGL_CLEAR], ['jungle-camps-up-gank', CODEX_JGL_CLEAR]],
  JUNGLE_WEAKSIDE_CAMPS_IGNORED_OR_WRONG_INVADE_ORDER: [['jungle-weakside-stolen', CODEX_JGL_CLEAR], ['jungle-invade-death', CODEX_JGL_INVADE_ORDER]],
  JUNGLE_COMPENSATION_DEATH_OR_FORCED_BAD_DRAGON: [['jungle-dragon-tank-death', CODEX_JGL_INVADE_ORDER], ['jungle-compensation-death', CODEX_JGL_MINUS]],
  GANK_FAILED_FROM_EARLY_DASH_OR_SLOW_CLEAR_TEMPO: [], // spell casts and camp clears are not in the timeline
  JUNGLE_EARLY_BOOTS_DELAYED_SPIKE_OR_SMITE_WASTED_SECOND_CLEAR: [['jungle-early-boots', CODEX_JGL_ECONOMY]], // Scuttle Crabs and Smite casts: not in it either
  JUNGLE_WASTED_HERALD_OR_DESTROYED_NON_FIRST_T1_EARLY: [['jungle-side-t1-destroyed', CODEX_JGL_T1_HERALD], ['jungle-herald-unused-death', CODEX_JGL_T1_HERALD]],
  JUNGLE_FLED_INVADE_AT_1HP_LOSING_CAMPS: [['jungle-fled-invade', CODEX_JGL_NEVER_FLEE]],
  JUNGLE_OVERSTAYED_INVADE_SECOND_CAMP_WITHOUT_MID_PRIO: [], // one event with the wrong invade order: the invade death, its first reading when the mid laner is on their wave
  JUNGLE_OBJECTIVE_OUTSMITED_FROM_DESYNCED_BURST: [['jungle-outsmited', CODEX_JGL_SMITE]],
  MID_CAUGHT_AHEAD_OF_WAVE_AFTER_RESET_OR_KEYSTONE_BAITED: [['mid-ahead-of-wave-death', CODEX_MID_MICRO], ['mid-reset-trap-death', CODEX_MID_WAVES]],
  MID_PASSIVE_WAVE_LOSS_VS_LANE_BULLY: [['mid-passive-wave-loss', CODEX_MID_WAVES]],
  SUPPORT_STUCK_IN_BOT_LANE_POST_LEVEL_6_OR_VISIBLE_ON_CRASH: [['support-botlane-leech', CODEX_SUP_POST6], ['support-absent-scuttle', CODEX_SUP_POST_CRASH]],
  SUPPORT_WEAKSIDE_JUNGLE_UNWARDED_OR_WAVE_STUCK_ZONE_C: [['support-weakside-unwarded', CODEX_SUP_POST6]], // minion waves (zone C): not in the timeline
}

const moment = (facts: MomentFacts, trigger: CriticalMoment['trigger'] = 'critical-death', over: Partial<CriticalMoment> = {}): CriticalMoment => ({
  key: `${trigger}@200`, trigger, gameTimeSec: 200, severity: 0.3, position: null, zone: null, lane: null, territory: null,
  winProbBefore: 0.5, winProbAfter: 0.45, facts, ...over,
})

// ── Codex: audit, mapping, content ───────────────────────────────────────

describe('AscendCodex — V7–V10 audit: nothing duplicated', () => {
  it('75 fiches (76 with V7, less the withdrawn low-energy protocol): the 15 new ids are fiches of their own, no id, alias or headline collision', () => {
    expect(CODEX).toHaveLength(75)
    for (const id of V7_IDS) {
      expect(CODEX.filter((e) => e.id === id), id).toHaveLength(1)
      expect(CODEX_ALIASES[id], id).toBeUndefined()
    }
    expect(new Set(CODEX.map((e) => e.id)).size).toBe(CODEX.length)
    expect(new Set(CODEX.map((e) => e.headline.fr)).size).toBe(CODEX.length)
    expect(new Set(CODEX.map((e) => e.headline.en)).size).toBe(CODEX.length)
  })
  it('each brief condition is its own patterns, shared with no other condition and no older pattern', () => {
    const v7 = Object.values(V7_TRIGGERS).flatMap((list) => list.map(([p]) => p))
    expect(new Set(v7).size).toBe(v7.length)
    expect([...v7].sort()).toEqual([...V7_PATTERNS].sort())
    const older = MOMENT_PATTERNS.slice(0, MOMENT_PATTERNS.indexOf('jungle-late-first-recall'))
    for (const p of v7) expect(older, p).not.toContain(p)
  })
  it('every new fiche is reachable: as a QCM diagnosis, or as the default fiche of its tag for its role and phase', () => {
    const linked = new Set(QCM_CONTEXTS.flatMap((c) => [...optionsFor(c), ...optionsFor(c, { midOnWave: true })].map((o) => o.codexId)))
    for (const id of V7_IDS) {
      const e = codexById(id)!
      expect(linked.has(id) || codexFor(e.mistakeSlug, e.role, e.phase === 'any' ? null : e.phase)?.id === id, id).toBe(true)
    }
    // The two fiches without a detector answer their tag for their role.
    expect(codexFor('bad-engage-angle', 'JUNGLE', 'early')!.id).toBe(CODEX_JGL_GANK)
    expect(codexFor('bad-engage-angle', 'SUPPORT', 'early')!.id).toBe(CODEX_SUP_ENGAGE)
  })
})

describe('AscendCodex — V7–V10 fiches', () => {
  it.each([
    [CODEX_JGL_CLEAR, 'JUNGLE', 'early', 'cs-deficit', ['overstay', 'bad-positioning'], 'csm', 'csing_pathing'],
    [CODEX_JGL_INVADE_ORDER, 'JUNGLE', 'early', 'death-before-objective', ['caught-out', 'bad-positioning'], 'gold15', 'weak_strong_side'],
    [CODEX_JGL_GANK, 'JUNGLE', 'early', 'bad-engage-angle', ['cs-deficit'], 'xp15', 'gank_effectiveness'],
    [CODEX_JGL_MINUS, 'JUNGLE', 'mid', 'caught-out', ['overstay', 'death-before-objective'], 'kda', 'decision_making'],
    [CODEX_JGL_ECONOMY, 'JUNGLE', 'early', 'unused-gold', ['cs-deficit', 'death-before-objective'], 'gold15', 'itemization'],
    [CODEX_JGL_T1_HERALD, 'JUNGLE', 'mid', 'overstay', ['bad-positioning', 'no-ward-pre-obj'], 'kp', 'wave_management_objectives'],
    [CODEX_JGL_NEVER_FLEE, 'JUNGLE', 'early', 'bad-trade', ['bad-positioning', 'cs-deficit'], 'xp15', 'aggression_calibration'],
    [CODEX_JGL_INVADE_STOP, 'JUNGLE', 'early', 'overstay', ['caught-out', 'bad-positioning'], 'kda', 'resource_management'],
    [CODEX_JGL_VISION, 'JUNGLE', 'early', 'forgot-trinket', ['no-ward-pre-obj', 'death-before-objective'], 'kp', 'vision_control'],
    [CODEX_JGL_SMITE, 'JUNGLE', 'mid', 'bad-dmg-maximisation', ['death-before-objective'], 'dmgm', 'mastery'],
    [CODEX_MID_MICRO, 'MIDDLE', 'early', 'bad-trade', ['bad-positioning'], 'dmgm', 'cooldown_tracking'],
    [CODEX_MID_WAVES, 'MIDDLE', 'early', 'cs-deficit', ['overstay', 'unused-gold'], 'cs15', 'wave_management'],
    [CODEX_SUP_ENGAGE, 'UTILITY', 'early', 'bad-engage-angle', ['bad-positioning', 'cs-deficit'], 'kp', 'mastery'],
    [CODEX_SUP_POST_CRASH, 'UTILITY', 'early', 'bad-positioning', ['overstay', 'caught-out'], 'fb', 'fog_usage'],
    [CODEX_SUP_POST6, 'UTILITY', 'mid', 'no-ward-pre-obj', ['forgot-trinket', 'bad-positioning'], 'kp', 'rotation_positioning'],
  ])('%s: role, phase, tags and axis in the app taxonomy, text only, bilingual', (id, role, phase, tag, others, axis, fundamental) => {
    const e = codexById(id)!
    expect(e).toMatchObject({ id, role, phase, mistakeSlug: tag, radarAxis: axis, fundamentalId: fundamental })
    for (const o of others) expect(e.mistakeSlugs, `${id} ${o}`).toContain(o)
    expect(e.videoExamples).toEqual([])
    for (const f of [e.headline, e.tacticalRule, e.drillObjective]) {
      expect(f.fr.length).toBeGreaterThan(40)
      expect(f.en.length).toBeGreaterThan(40)
    }
  })
  it('keeps every number and mechanic of the briefs', () => {
    const fr = (id: string) => { const e = codexById(id)!; return `${e.headline.fr} ${e.tacticalRule.fr} ${e.drillObjective.fr}` }
    const keep: Array<[string, RegExp[]]> = [
      [CODEX_JGL_CLEAR, [/T-25 s/, /8 s de back \+ 17 s de marche/, /au moins 90 %/, /6 camps/, /Sweeper ou cône de vision → vérifier les Raptors ennemis → aider le mid à crash → recall/]],
      [CODEX_JGL_INVADE_ORDER, [/rouge → jaune → vert/, /entre 5 et 12 min/, /5e joueur ennemi/, /à 6 min/, /3 buissons/]],
      [CODEX_JGL_GANK, [/50 PV/, /1\. couper la trajectoire.*5\. Flash/, /6e seconde/]],
      [CODEX_JGL_MINUS, [/3e Dragon dès T-20 s/, /1000 g de camps/, /1800 g sans recall/, /3 camps ennemis adjacents/]],
      [CODEX_JGL_ECONOMY, [/Pioche \(875 g\)/, /3:12/, /5:30/, /Smite à 900/, /15 s chrono/, /1000 PV/]],
      [CODEX_JGL_T1_HERALD, [/APRÈS 14 MIN/, /100 PV/, /1v3/, /1 pink/]],
      [CODEX_JGL_NEVER_FLEE, [/5:30/, /Smite amélioré \(900\)/, /3 s/, /300 g/, /Raptors → Red → Krugs → recall → camps bot/]],
      [CODEX_JGL_INVADE_STOP, [/4 s/, /5 s/, /E-Q de Jarvan IV/]],
      [CODEX_JGL_VISION, [/8-10 min/, /\(5:00\)/, /Shyvana, Vi, Udyr/, /1 ou 2 ennemis/]],
      [CODEX_JGL_SMITE, [/0,25 s/, /900\/1200/, /2200\+ PV/, /0,2 s/, /50 % de tes dégâts/, /R de Cho'Gath à 1200\+/]],
      [CODEX_MID_MICRO, [/30 s/, /3 secondes DEVANT/, /2 autos au lieu de 3/, /niveau 3/]],
      [CODEX_MID_WAVES, [/niveau 1/, /2 points dans le Q au niveau 3/, /wave 5/, /Cristal de mana/]],
      [CODEX_SUP_ENGAGE, [/\+65 PV/, /niveau 7/, /0,5 s/, /0,3 s/, /auto → W reset → auto/, /WAVES 3 ET 6/]],
      [CODEX_SUP_POST_CRASH, [/2:30/, /moins de 300 g/, /3:15/, /15 s avant le Carapateur de 3:30/, /4 secondes/, /T-30 S/]],
      [CODEX_SUP_POST6, [/NIVEAU 6/, /2 wards défensives/, /3 casters/, /20 s/]],
    ]
    for (const [id, patterns] of keep) for (const p of patterns) expect(fr(id), `${id} ${p}`).toMatch(p)
  })
  it('the new fiches answer their tags for their role without displacing another role\'s fiche', () => {
    expect(codexFor('unused-gold', 'JUNGLE', 'early')!.id).toBe(CODEX_JGL_ECONOMY)
    expect(codexFor('forgot-trinket', 'JUNGLE', 'early')!.id).toBe(CODEX_JGL_VISION)
    expect(codexFor('caught-out', 'JUNGLE', 'mid')!.id).toBe(CODEX_JGL_MINUS)
    expect(codexFor('cs-deficit', 'MIDDLE', 'early')!.id).toBe(CODEX_MID_WAVES)
    expect(codexFor('bad-trade', 'MIDDLE', 'early')!.id).toBe(CODEX_MID_MICRO)
    // Unchanged elsewhere.
    expect(codexFor('cs-deficit', 'JUNGLE', 'early')!.id).toBe('codex_jgl_3camps_mid_cross_bot_invade')
    expect(codexFor('overstay', 'JUNGLE', 'early')!.id).toBe('codex_jgl_pathing_integrity_reset_cycle')
    expect(codexFor('cs-deficit', 'TOP', 'early')!.id).toBe('cs-top-early')
    expect(codexFor('bad-positioning', 'SUPPORT', 'early')!.id).toBe('codex_support_3bush_warding_level2_stacks_aftershock_punish')
    expect(codexFor('no-ward-pre-obj', 'SUPPORT', 'mid')!.id).toBe('vision-obj-support-mid')
  })
})

describe('V7–V10 — confidentiality', () => {
  const NAMES = /coach ?leo|\binspired\b|jankos|doaenel|chovy|mysterias|\bcoach ?k\b|skill ?capped/i
  const locale = (lang: string) => JSON.parse(readFileSync(new URL(`../../src/i18n/locales/${lang}.json`, import.meta.url), 'utf8'))
  it('no outside coach, pro player or creator name in the Codex, the micro-review code or its texts', () => {
    expect(JSON.stringify(CODEX)).not.toMatch(NAMES)
    for (const lang of ['fr', 'en']) {
      expect(JSON.stringify(locale(lang).microReview), lang).not.toMatch(NAMES)
      expect(JSON.stringify(locale(lang).codex), lang).not.toMatch(NAMES)
    }
    const dir = new URL('../../src/lib/microReview/', import.meta.url)
    for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(NAMES)
  })
  it('every new fiche is text only', () => {
    for (const id of V7_IDS) expect(codexById(id)!.videoExamples, id).toEqual([])
  })
})

// ── QCM ───────────────────────────────────────────────────────────────────

describe('SmartQCMGenerator — V7–V10 cards', () => {
  it.each([
    [{ pattern: 'jungle-late-first-recall', firstBackSec: 268 }, 'cs-deficit', 'lateFirstRecall', CODEX_JGL_CLEAR, 'lateFirstRecall'],
    [{ pattern: 'jungle-camps-up-gank', jungleCsLost: 8 }, 'cs-deficit', 'campsUpGank', CODEX_JGL_CLEAR, 'campsUpGank'],
    [{ pattern: 'jungle-weakside-stolen', campsStolenCs: 12 }, 'cs-deficit', 'weakSideFirst', CODEX_JGL_CLEAR, 'weakSideStolen'],
    [{ pattern: 'jungle-invade-death', campsTakenCs: 4 }, 'caught-out', 'invadeOrder', CODEX_JGL_INVADE_ORDER, 'invadeDeath'],
    [{ pattern: 'jungle-dragon-tank-death', dragonDamagePct: 72 }, 'death-before-objective', 'dragonScenarios', CODEX_JGL_INVADE_ORDER, 'dragonTank'],
    [{ pattern: 'jungle-compensation-death', deathGapSec: 6, objective: 'baron' }, 'caught-out', 'compensation', CODEX_JGL_MINUS, 'compensation'],
    [{ pattern: 'jungle-early-boots', bootsSec: 300 }, 'unused-gold', 'earlyBoots', CODEX_JGL_ECONOMY, 'earlyBoots'],
    [{ pattern: 'jungle-side-t1-destroyed', turretLane: 'TOP' }, 'overstay', 'leaveT1', CODEX_JGL_T1_HERALD, 'sideT1'],
    [{ pattern: 'jungle-herald-unused-death', heraldAgoSec: 90 }, 'bad-positioning', 'heraldUnused', CODEX_JGL_T1_HERALD, 'heraldUnused'],
    [{ pattern: 'jungle-fled-invade', hpPct: 9, opponentHpPct: 85 }, 'bad-trade', 'neverFlee', CODEX_JGL_NEVER_FLEE, 'fledInvade'],
    [{ pattern: 'jungle-outsmited', objective: 'dragon' }, 'bad-dmg-maximisation', 'burstSmite', CODEX_JGL_SMITE, 'outsmited'],
    [{ pattern: 'mid-ahead-of-wave-death', sinceBaseSec: 31 }, 'bad-trade', 'aheadOfWave', CODEX_MID_MICRO, 'aheadOfWave'],
    [{ pattern: 'mid-reset-trap-death', resetResource: 'mana', resetLowPct: 12, enemyBackSec: 40 }, 'overstay', 'resetTrap', CODEX_MID_WAVES, 'resetTrapMana'],
    [{ pattern: 'mid-passive-wave-loss', csDiff6: -15 }, 'cs-deficit', 'midWaveLoss', CODEX_MID_WAVES, 'midWaveLoss'],
    [{ pattern: 'support-botlane-leech', laneSnapshots: 7, kpPct: 30 }, 'bad-positioning', 'post6Fog', CODEX_SUP_POST6, 'botLeech'],
    [{ pattern: 'support-absent-scuttle' }, 'bad-positioning', 'hover315', CODEX_SUP_POST_CRASH, 'absentScuttle'],
    [{ pattern: 'support-weakside-unwarded', campsStolenCs: 8 }, 'forgot-trinket', 'weakSideWard', CODEX_SUP_POST6, 'weakSideUnwarded'],
  ] as const)('%o → choice [1] is the fiche that teaches it', (facts, tag, reason, codexId, head) => {
    const card = buildQcm(moment(facts as MomentFacts))
    expect(card.options[0]).toMatchObject({ outcome: 'mistake', tagSlug: tag, reason, codexId })
    expect(card.summary.head.key).toBe(head)
  })
  it('each brief condition: one context per pattern, choice [1] on the fiche of the table', () => {
    for (const [condition, list] of Object.entries(V7_TRIGGERS)) for (const [pattern, fiche] of list) {
      const card = buildQcm(moment({ pattern }))
      expect(card.contexts, `${condition} / ${pattern}`).toHaveLength(1)
      expect(card.options[0].codexId, `${condition} / ${pattern}`).toBe(fiche)
    }
  })
  it('the invade death reads the second-camp greed first when the mid laner was held on their wave', () => {
    expect(buildQcm(moment({ pattern: 'jungle-invade-death', midOnWave: true })).options.map((o) => o.codexId ?? o.reason))
      .toEqual([CODEX_JGL_INVADE_STOP, CODEX_JGL_INVADE_ORDER, 'invadeWorth'])
    expect(buildQcm(moment({ pattern: 'jungle-invade-death' })).options.map((o) => o.codexId ?? o.reason))
      .toEqual([CODEX_JGL_INVADE_ORDER, CODEX_JGL_INVADE_STOP, 'invadeWorth'])
  })
  it('the second reading is another cause (never a rewording of choice [1]), on the fiche of the neighbouring concept', () => {
    const second = (facts: MomentFacts) => buildQcm(moment(facts)).options[1]
    expect(second({ pattern: 'jungle-late-first-recall' })).toMatchObject({ reason: 'cycleBreak', codexId: CODEX_JUNGLE_CYCLE })
    expect(second({ pattern: 'jungle-camps-up-gank' })).toMatchObject({ reason: 'gankExecution', codexId: CODEX_JGL_GANK })
    expect(second({ pattern: 'jungle-weakside-stolen' })).toMatchObject({ reason: 'yellowTrinket', codexId: CODEX_JGL_VISION })
    expect(second({ pattern: 'jungle-dragon-tank-death' })).toMatchObject({ reason: 'burstSmite', codexId: CODEX_JGL_SMITE })
    expect(second({ pattern: 'jungle-compensation-death' })).toMatchObject({ reason: 'setupFail', codexId: CODEX_OBJ_SETUP })
    expect(second({ pattern: 'jungle-fled-invade' })).toMatchObject({ reason: 'yellowTrinket', codexId: CODEX_JGL_VISION })
    expect(second({ pattern: 'jungle-outsmited' })).toMatchObject({ reason: 'setupFail', codexId: CODEX_OBJ_SETUP })
    // The plain second readings of the mid and support cards: lost trades, an enemy spike, a wave that was not pushed.
    expect(second({ pattern: 'mid-reset-trap-death' })).toMatchObject({ tagSlug: 'bad-trade', reason: 'lostTrades' })
    expect(second({ pattern: 'mid-passive-wave-loss' })).toMatchObject({ tagSlug: 'bad-trade', reason: 'lostTrades' })
    expect(buildQcm(moment({ pattern: 'mid-ahead-of-wave-death' })).options.map((o) => o.reason)).toEqual(['aheadOfWave', 'noMinimap', 'powerSpike'])
    expect(second({ pattern: 'support-botlane-leech' })).toMatchObject({ tagSlug: 'bad-wave-sync', reason: 'absentNoRotate' })
  })
  it('summaries carry only what the detector proved', () => {
    const sum = (facts: MomentFacts) => buildQcm(moment(facts)).summary
    expect(sum({ pattern: 'jungle-late-first-recall', firstBackSec: 268 })).toMatchObject({ head: { key: 'lateFirstRecall' }, extras: [{ key: 'firstBack', params: { clock: '4:28' } }] })
    expect(sum({ pattern: 'jungle-late-first-recall', firstBackSec: null }).extras).toEqual([])
    expect(sum({ pattern: 'jungle-early-boots', bootsSec: 305 }).head).toEqual({ key: 'earlyBoots', params: { clock: '5:05' } })
    expect(sum({ pattern: 'jungle-camps-up-gank', jungleCsLost: 12 })).toMatchObject({ head: { key: 'campsUpGank' }, extras: [{ key: 'jungleCsLost', params: { cs: 12 } }] })
    expect(sum({ pattern: 'jungle-weakside-stolen', campsStolenCs: 8 })).toMatchObject({ head: { key: 'weakSideStolen' }, extras: [{ key: 'campsStolen', params: { cs: 8 } }] })
    expect(sum({ pattern: 'jungle-invade-death', campsTakenCs: 8, midOnWave: true }).extras).toEqual([{ key: 'campsTaken', params: { cs: 8 } }, { key: 'midOnWave' }])
    expect(sum({ pattern: 'jungle-compensation-death', deathGapSec: 7, objective: 'baron', enemiesInvolved: 4 }))
      .toMatchObject({ head: { key: 'compensation', params: { sec: 7, objective: 'baron' } }, extras: [{ key: 'outnumbered', params: { n: 4 } }] })
    expect(sum({ pattern: 'jungle-side-t1-destroyed', turretLane: 'BOT' }).head).toEqual({ key: 'sideT1', params: { lane: 'bot' } })
    expect(sum({ pattern: 'mid-reset-trap-death', resetResource: 'hp', resetLowPct: 22, enemyBackSec: 51 }).head).toEqual({ key: 'resetTrapHp', params: { pct: 22, sec: 51 } })
    expect(sum({ pattern: 'mid-passive-wave-loss', csDiff6: -14 })).toMatchObject({ head: { key: 'midWaveLoss', params: { cs: -14 } }, extras: [{ key: 'skillsSpread' }] })
    expect(sum({ pattern: 'support-botlane-leech', laneSnapshots: 6, kpPct: 31 })).toMatchObject({ head: { key: 'botLeech', params: { n: 6 } }, extras: [{ key: 'killParticipation', params: { pct: 31 } }] })
  })
  it('a way out that does not count wherever the play can be right', () => {
    const exits: Array<[MomentPattern, string]> = [['jungle-late-first-recall', 'stayedForPlay'], ['jungle-camps-up-gank', 'gankTrade'], ['jungle-early-boots', 'bootsNeeded'],
      ['jungle-side-t1-destroyed', 't1Worth'], ['jungle-fled-invade', 'fleeNeeded'], ['support-botlane-leech', 'laneNeeded'], ['support-weakside-unwarded', 'withJungler']]
    for (const [pattern, reason] of exits) expect(buildQcm(moment({ pattern })).options.at(-1), pattern).toMatchObject({ outcome: 'justified', reason })
  })
})

// ── Detector ──────────────────────────────────────────────────────────────

type Game = ReturnType<typeof buildGame>
type P = { x: number; y: number }
type FrameFn = (i: number, pid: number) => Record<string, unknown> | undefined
const run = (g: Game) => analyzeGame(g.match, g.timeline, g.selector)!
const withPattern = (g: Game, pattern: MomentPattern) => run(g).moments.find((m) => m.facts.pattern === pattern)
const patternsOf = (g: Game) => run(g).moments.map((m) => m.facts.pattern)
const kill = (ts: number, victimId: number, killerId: number, assists: number[] = [], position?: P, extra: Record<string, unknown> = {}) =>
  ({ type: 'CHAMPION_KILL', timestamp: ts, victimId, killerId, assistingParticipantIds: assists, ...(position ? { position } : {}), ...extra })
const buy = (ts: number, participantId: number, itemId = 1036) => ({ type: 'ITEM_PURCHASED', timestamp: ts, participantId, itemId })
const ward = (ts: number, creatorId: number) => ({ type: 'WARD_PLACED', timestamp: ts, creatorId, wardType: 'YELLOW_TRINKET' })
const skillUp = (ts: number, participantId: number, skillSlot: number) => ({ type: 'SKILL_LEVEL_UP', timestamp: ts, participantId, skillSlot, levelUpType: 'NORMAL' })
const hp = (pct: number) => ({ championStats: { health: pct * 10, healthMax: 1000 } })
const merge = (...fns: Array<FrameFn | undefined>): FrameFn => (i, pid) => Object.assign({}, ...fns.map((f) => f?.(i, pid) ?? {}))
// Participants 1–5 blue (top, jungle, mid, ADC, support), 6–10 red in the same order. Places as seen by blue:
const OUR_BOT_JUNGLE: P = { x: 7000, y: 3500 }
const OUR_TOP_JUNGLE: P = { x: 3500, y: 7000 }
const ENEMY_JUNGLE: P = { x: 11000, y: 8000 }
const TOP_LANE: P = { x: 1500, y: 9000 }
const MID_LANE: P = { x: 7000, y: 7000 }
const BOT_RIVER: P = { x: 9500, y: 5000 }
const NEAR_DRAGON: P = { x: DRAGON_PIT.x + 500, y: DRAGON_PIT.y }

describe('detector — the V7–V10 numbers and places', () => {
  it('are the ones of the briefs', () => {
    expect(DETECTOR_SPEC.jungleFirstBack).toEqual({ bySec: 245, startSec: 60 })
    expect(DETECTOR_SPEC.gankCost).toEqual({ fromSec: 120, untilSec: 720, cs: 8, enemyRadius: 2500 })
    expect(DETECTOR_SPEC.campsStolen).toMatchObject({ cs: 8, weakSideUntilSec: 960, supportUntilSec: 1080 })
    expect(DETECTOR_SPEC.invadeDeath).toMatchObject({ untilSec: 960 })
    expect(DETECTOR_SPEC.dragonTank).toEqual({ fromSec: 300, untilSec: 720, damageShare: 0.6 })
    expect(DETECTOR_SPEC.compensation).toMatchObject({ windowSec: 15 })
    expect(DETECTOR_SPEC.earlyBoots).toEqual({ untilSec: 480, itemId: 1001 })
    expect(DETECTOR_SPEC.sideTower).toEqual({ fromSec: 840, untilSec: 1200 })
    expect(DETECTOR_SPEC.heraldEye).toEqual({ fromSec: 840, untilSec: 1170, itemId: 3513, pickupSec: 20 })
    expect(DETECTOR_SPEC.fledInvade).toMatchObject({ untilSec: 900, hpPct: 15, enemyHpPct: 70, radius: 2000 })
    expect(DETECTOR_SPEC.outsmite).toEqual({ pitRadius: 900 })
    expect(DETECTOR_SPEC.aheadOfWave).toMatchObject({ untilSec: 720 })
    expect(DETECTOR_SPEC.resetTrap).toMatchObject({ untilSec: 720, lowPct: 30 })
    expect(DETECTOR_SPEC.midWaveLoss).toEqual({ atSec: 360, csDiff: -12, takedowns: 2 })
    expect(DETECTOR_SPEC.supportLeech).toMatchObject({ fromSec: 540, untilSec: 900, level: 6, kp: 0.45 })
    expect(DETECTOR_SPEC.supportScuttle).toMatchObject({ fromSec: 205, untilSec: 230 })
  })
  it('reads the places it relies on', () => {
    expect([territoryOf(OUR_BOT_JUNGLE, 100), laneOf(OUR_BOT_JUNGLE), territoryOf(OUR_TOP_JUNGLE, 100), laneOf(OUR_TOP_JUNGLE)]).toEqual(['own', 'JUNGLE', 'own', 'JUNGLE'])
    expect([territoryOf(ENEMY_JUNGLE, 100), laneOf(ENEMY_JUNGLE), laneOf(TOP_LANE), laneOf(MID_LANE), zoneOf(BOT_RIVER, 100)]).toEqual(['enemy', 'JUNGLE', 'TOP', 'MID', 'bot-river'])
  })
})

describe('pattern — jungle: first back after 4:05', () => {
  const S = DETECTOR_SPEC.jungleFirstBack
  const game = (o: { back?: number | null; me?: number; extra?: any[]; noShop?: boolean } = {}) => buildGame({ minutes: 8, me: o.me ?? 2, events: [
    ...(o.noShop ? [] : [buy(10_000, o.me ?? 2)]), ...(o.back === null || o.noShop ? [] : [buy(o.back ?? 268_000, o.me ?? 2)]), ...(o.extra ?? []),
  ] })
  it('still on the map at 4:05: a back at 4:05 is in time, one after is late', () => {
    expect(withPattern(game(), 'jungle-late-first-recall')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: S.bySec, facts: { firstBackSec: 268 } })
    expect(withPattern(game({ back: S.bySec * 1000 }), 'jungle-late-first-recall')).toBeUndefined()
    expect(withPattern(game({ back: S.bySec * 1000 + 1 }), 'jungle-late-first-recall')).toBeDefined()
    expect(withPattern(game({ back: null }), 'jungle-late-first-recall')).toMatchObject({ facts: { firstBackSec: null } })
  })
  it('a takedown or a death before 4:05 explains it; a timeline without purchases proves nothing; junglers only', () => {
    expect(withPattern(game({ extra: [kill(200_000, 7, 2)] }), 'jungle-late-first-recall')).toBeUndefined()
    expect(withPattern(game({ extra: [kill(200_000, 2, 7)] }), 'jungle-late-first-recall')).toBeUndefined()
    expect(withPattern(game({ noShop: true }), 'jungle-late-first-recall')).toBeUndefined()
    expect(withPattern(game({ me: 1 }), 'jungle-late-first-recall')).toBeUndefined()
  })
})

describe('pattern — jungle: a gank that cost the camps (2:00–12:00)', () => {
  const S = DETECTOR_SPEC.gankCost
  // On snapshot k the jungler (2) stands in the top lane, the enemy top laner (6) `gap` units away; over the minute that
  // follows the enemy jungler (7) takes `theirs` jungle CS and the player `mine` (4 per minute each before that).
  const gank = (o: { k?: number; theirs?: number; mine?: number; gap?: number | null; where?: P; extra?: any[] } = {}) => {
    const k = o.k ?? 5
    const where = o.where ?? TOP_LANE
    return buildGame({ minutes: 16, me: 2, events: o.extra ?? [],
      frame: (i, pid) => ({
        ...(pid === 2 ? { jungleMinionsKilled: i <= k ? 4 * i : 4 * k + (o.mine ?? 0) } : {}),
        ...(pid === 7 ? { jungleMinionsKilled: i <= k ? 4 * i : 4 * k + (o.theirs ?? 8) } : {}),
        ...(pid === 2 && i === k ? { position: where } : {}),
        ...(pid === 6 && i === k && o.gap !== null ? { position: { x: where.x, y: where.y + (o.gap ?? 1000) } } : {}),
      }) })
  }
  it('8+ jungle CS lost on the enemy jungler over the minute', () => {
    expect(withPattern(gank(), 'jungle-camps-up-gank')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 300, facts: { jungleCsLost: 8 } })
    expect(withPattern(gank({ theirs: S.cs - 1 }), 'jungle-camps-up-gank')).toBeUndefined()
    expect(withPattern(gank({ theirs: 12, mine: 4 }), 'jungle-camps-up-gank')).toMatchObject({ facts: { jungleCsLost: 8 } })
    expect(withPattern(gank({ theirs: 11, mine: 4 }), 'jungle-camps-up-gank')).toBeUndefined()
  })
  it('in a lane next to an enemy (2500 units, inclusive), no takedown and no death in that minute', () => {
    expect(withPattern(gank({ gap: S.enemyRadius }), 'jungle-camps-up-gank')).toBeDefined()
    expect(withPattern(gank({ gap: S.enemyRadius + 1 }), 'jungle-camps-up-gank')).toBeUndefined()
    expect(withPattern(gank({ gap: null }), 'jungle-camps-up-gank')).toBeUndefined()
    expect(withPattern(gank({ where: OUR_TOP_JUNGLE }), 'jungle-camps-up-gank')).toBeUndefined()
    expect(withPattern(gank({ extra: [kill(320_000, 6, 2, [], TOP_LANE)] }), 'jungle-camps-up-gank')).toBeUndefined()
    expect(withPattern(gank({ extra: [kill(330_000, 2, 6, [], TOP_LANE)] }), 'jungle-camps-up-gank')).toBeUndefined()
  })
  it('from 2:00 to 12:00', () => {
    expect(withPattern(gank({ k: S.fromSec / 60 }), 'jungle-camps-up-gank')).toBeDefined()
    expect(withPattern(gank({ k: S.fromSec / 60 - 1 }), 'jungle-camps-up-gank')).toBeUndefined()
    expect(withPattern(gank({ k: S.untilSec / 60 - 1 }), 'jungle-camps-up-gank')).toBeDefined()
    expect(withPattern(gank({ k: S.untilSec / 60 }), 'jungle-camps-up-gank')).toBeUndefined()
  })
})

describe('pattern — our camps stolen, proven by two snapshots (weak side left behind / support ward)', () => {
  const S = DETECTOR_SPEC.campsStolen
  // The enemy jungler (7) stands in our bot-side jungle at snapshots k and k+1 and takes `cs` jungle CS in between.
  const steal = (k: number, cs = 8, where: P = OUR_BOT_JUNGLE): FrameFn => (i, pid) =>
    pid === 7 && (i === k || i === k + 1) ? { position: where, jungleMinionsKilled: i === k ? 20 : 20 + cs } : undefined
  const at2: (k: number, p: P) => FrameFn = (k, p) => (i, pid) => (pid === 2 && i === k ? { position: p } : undefined)
  const game = (frame: FrameFn, events: any[] = [], minutes = 20) => buildGame({ minutes, me: 2, frame, events })
  it('8+ jungle CS with the enemy jungler in the same quadrant of our jungle at both snapshots', () => {
    const stolen = (frame: FrameFn) => withPattern(game(merge(frame, at2(9, OUR_TOP_JUNGLE)), [buy(470_000, 2)]), 'jungle-weakside-stolen')
    expect(stolen(steal(8))).toBeDefined()
    expect(stolen(steal(8, S.cs - 1))).toBeUndefined()
    const once: FrameFn = (i, pid) => (pid === 7 && i === 8 ? { position: OUR_BOT_JUNGLE, jungleMinionsKilled: 20 } : pid === 7 && i === 9 ? { position: ENEMY_JUNGLE, jungleMinionsKilled: 28 } : undefined)
    expect(stolen(once)).toBeUndefined()
    // Crossing from one quadrant of our jungle to the other proves no camp. Top to bot matters: the player (top side at
    // snapshot 9) would then stand on the other side of the second snapshot.
    const across = (from: P, to: P): FrameFn => (i, pid) => (pid === 7 && i === 8 ? { position: from, jungleMinionsKilled: 20 } : pid === 7 && i === 9 ? { position: to, jungleMinionsKilled: 28 } : undefined)
    expect(stolen(across(OUR_TOP_JUNGLE, OUR_BOT_JUNGLE))).toBeUndefined()
    expect(stolen(across(OUR_BOT_JUNGLE, OUR_TOP_JUNGLE))).toBeUndefined()
  })
  it('the starting items are not a back; nothing is read before 2:00', () => {
    const early = (k: number, shops: number[]) => withPattern(game(merge(steal(k), at2(k + 1, OUR_TOP_JUNGLE)), shops.map((t) => buy(t, 2))), 'jungle-weakside-stolen')
    expect(early(2, [30_000, 100_000])).toBeDefined()
    expect(early(2, [30_000, 60_000])).toBeUndefined()
    expect(early(1, [30_000, 100_000])).toBeUndefined()
  })
  it('the weak side: a back from the minute before to the end of that minute, then the other side, alive, before 16:00', () => {
    const weak = (k: number, backAt: number, side: P = OUR_TOP_JUNGLE, extra: any[] = []) => game(merge(steal(k), at2(k + 1, side)), [buy(backAt, 2), ...extra])
    expect(withPattern(weak(8, 470_000), 'jungle-weakside-stolen')).toMatchObject({ gameTimeSec: 480, facts: { campsStolenCs: 8 } })
    expect(withPattern(weak(8, 480_000 - 60_000), 'jungle-weakside-stolen')).toBeDefined()
    expect(withPattern(weak(8, 480_000 - 60_001), 'jungle-weakside-stolen')).toBeUndefined()
    expect(withPattern(weak(8, 480_000 + 60_000), 'jungle-weakside-stolen')).toBeDefined()
    expect(withPattern(weak(8, 470_000, OUR_BOT_JUNGLE), 'jungle-weakside-stolen')).toBeUndefined()
    expect(withPattern(weak(8, 470_000, OUR_TOP_JUNGLE, [kill(500_000, 2, 6, [], TOP_LANE)]), 'jungle-weakside-stolen')).toBeUndefined()
    expect(withPattern(weak(S.weakSideUntilSec / 60 - 1, (S.weakSideUntilSec - 70) * 1000), 'jungle-weakside-stolen')).toBeDefined()
    expect(withPattern(weak(S.weakSideUntilSec / 60, (S.weakSideUntilSec - 10) * 1000), 'jungle-weakside-stolen')).toBeUndefined()
  })
  it('for the support: our jungler top side, no ward of theirs in our bot-side jungle in the 120 s before, before 18:00', () => {
    const jgTop: FrameFn = (i, pid) => (pid === 2 && (i === 9 || i === 10) ? { position: OUR_TOP_JUNGLE } : undefined)
    const support = (frame: FrameFn, events: any[] = []) => buildGame({ minutes: 20, me: 5, frame, events: [ward(60_000, 5), ...events] })
    expect(withPattern(support(merge(steal(9), jgTop)), 'support-weakside-unwarded')).toMatchObject({ gameTimeSec: 540, facts: { campsStolenCs: 8 } })
    // A ward placed while standing in our bot-side jungle 100 s before.
    const warding: FrameFn = (i, pid) => (pid === 5 && (i === 7 || i === 8) ? { position: OUR_BOT_JUNGLE } : undefined)
    expect(withPattern(support(merge(steal(9), jgTop, warding), [ward(440_000, 5)]), 'support-weakside-unwarded')).toBeUndefined()
    expect(withPattern(support(steal(9)), 'support-weakside-unwarded')).toBeUndefined() // our jungler stayed bot side
    expect(withPattern(support(merge(steal(9, 8, OUR_TOP_JUNGLE), jgTop)), 'support-weakside-unwarded')).toBeUndefined() // top-side camps
    const late: FrameFn = (i, pid) => (pid === 2 && (i === 18 || i === 19) ? { position: OUR_TOP_JUNGLE } : undefined)
    expect(withPattern(buildGame({ minutes: 22, me: 5, frame: merge(steal(18), late), events: [ward(60_000, 5)] }), 'support-weakside-unwarded')).toBeUndefined()
  })
})

describe('pattern — jungle: dead invading (before 16:00)', () => {
  const S = DETECTOR_SPEC.invadeDeath
  // Dead at 7:20 in the enemy jungle; the player's jungle CS rises by `camps` between 6:00 and 8:00.
  const invade = (o: { deathAt?: number; camps?: number; where?: P; extra?: any[]; frame?: FrameFn } = {}) => {
    const deathAt = o.deathAt ?? at(7, 20)
    const k = Math.floor((deathAt - 60_000) / 60_000)
    const cs: FrameFn = (i, pid) => (pid === 2 && i >= k + 2 ? { jungleMinionsKilled: o.camps ?? 4 } : undefined)
    return buildGame({ minutes: 20, me: 2, frame: merge(cs, o.frame), events: [kill(deathAt, 2, 7, [8], o.where ?? ENEMY_JUNGLE), ...(o.extra ?? [])] })
  }
  it('after a camp (4+ jungle CS around the death), in the enemy jungle', () => {
    expect(withPattern(invade(), 'jungle-invade-death')).toMatchObject({ trigger: 'critical-death', facts: { campsTakenCs: 4, midOnWave: true } })
    expect(withPattern(invade({ camps: S.campCs - 1 }), 'jungle-invade-death')).toBeUndefined()
    expect(withPattern(invade({ where: OUR_TOP_JUNGLE }), 'jungle-invade-death')).toBeUndefined()
  })
  it('no takedown in the 30 s before, before 16:00', () => {
    expect(withPattern(invade({ extra: [kill(at(7, 20) - 30_000, 9, 2)] }), 'jungle-invade-death')).toBeUndefined()
    expect(withPattern(invade({ extra: [kill(at(7, 20) - 30_001, 9, 2)] }), 'jungle-invade-death')).toBeDefined()
    expect(withPattern(invade({ deathAt: S.untilSec * 1000 - 1000 }), 'jungle-invade-death')).toBeDefined()
    expect(withPattern(invade({ deathAt: S.untilSec * 1000 }), 'jungle-invade-death')).toBeUndefined()
  })
  it('notes whether the mid laner was held on their wave, away from it', () => {
    const covering: FrameFn = (i, pid) => (pid === 3 && (i === 7 || i === 8) ? { position: { x: ENEMY_JUNGLE.x - 500, y: ENEMY_JUNGLE.y } } : undefined)
    expect(withPattern(invade({ frame: covering }), 'jungle-invade-death')!.facts.midOnWave).toBeUndefined()
  })
  it('alone or with one ally: a team fight in their jungle is not an invade', () => {
    const near = (ids: number[]): FrameFn => (i, pid) => (ids.includes(pid) && (i === 7 || i === 8) ? { position: { x: ENEMY_JUNGLE.x + 400, y: ENEMY_JUNGLE.y } } : undefined)
    expect(withPattern(invade({ frame: near([1]) }), 'jungle-invade-death')).toBeDefined()
    expect(withPattern(invade({ frame: near([1, 4]) }), 'jungle-invade-death')).toBeUndefined()
  })
})

describe('pattern — jungle: the Dragon tanked to death (5:00–12:00)', () => {
  const S = DETECTOR_SPEC.dragonTank
  const tank = (o: { deathAt?: number; damage?: number; where?: P; killer?: number; assists?: number[] } = {}) => {
    const deathAt = o.deathAt ?? at(7)
    const k = Math.floor(deathAt / 60_000)
    return buildGame({ minutes: 14, me: 2, frame: (i, pid) => (pid === 2 && i === k ? { championStats: { health: 300, healthMax: 1000 } } : undefined), events: [
      kill(deathAt, 2, o.killer ?? 7, o.assists ?? [9], o.where ?? NEAR_DRAGON, { victimDamageReceived: [
        { type: 'MONSTER', name: 'sru_dragon_fire', participantId: 0, physicalDamage: o.damage ?? 700, magicDamage: 0, trueDamage: 0 },
        { type: 'OTHER', name: 'Champ7', participantId: 7, physicalDamage: 300, magicDamage: 0, trueDamage: 0 },
      ] }),
    ] })
  }
  it('the Dragon dealt 60 %+ of the max HP, inclusive', () => {
    expect(withPattern(tank(), 'jungle-dragon-tank-death')).toMatchObject({ facts: { dragonDamagePct: 70 } })
    expect(withPattern(tank({ damage: 600 }), 'jungle-dragon-tank-death')).toBeDefined()
    expect(withPattern(tank({ damage: 599 }), 'jungle-dragon-tank-death')).toBeUndefined()
  })
  it('from 5:00 to 12:00 inclusive, within 3000 of the pit, an enemy champion in the fight', () => {
    expect(withPattern(tank({ deathAt: S.fromSec * 1000 }), 'jungle-dragon-tank-death')).toBeDefined()
    expect(withPattern(tank({ deathAt: S.fromSec * 1000 - 1 }), 'jungle-dragon-tank-death')).toBeUndefined()
    expect(withPattern(tank({ deathAt: S.untilSec * 1000 }), 'jungle-dragon-tank-death')).toBeDefined()
    expect(withPattern(tank({ deathAt: S.untilSec * 1000 + 1 }), 'jungle-dragon-tank-death')).toBeUndefined()
    expect(withPattern(tank({ where: { x: DRAGON_PIT.x + 2999, y: DRAGON_PIT.y } }), 'jungle-dragon-tank-death')).toBeDefined()
    expect(withPattern(tank({ where: { x: DRAGON_PIT.x + 3000, y: DRAGON_PIT.y } }), 'jungle-dragon-tank-death')).toBeUndefined()
    expect(withPattern(tank({ killer: 0, assists: [] }), 'jungle-dragon-tank-death')).toBeUndefined()
  })
  it('one death, one reading: the same death is not also reported as an overchase', () => {
    // 2999 units east of the pit the 20 s before the death run through the river and the enemy side: an overchase by V4's rule.
    const far = { where: { x: DRAGON_PIT.x + 2999, y: DRAGON_PIT.y } }
    expect(patternsOf(tank(far))).toEqual(['jungle-dragon-tank-death'])
    expect(patternsOf(tank({ ...far, damage: 599 }))).toEqual(['jungle-overchase'])
  })
})

describe('pattern — jungle: compensation death next to an objective', () => {
  const S = DETECTOR_SPEC.compensation
  const NEAR_BARON: P = { x: BARON_PIT.x + 1000, y: BARON_PIT.y }
  const T = at(20)
  const DEATH: P = { x: NEAR_BARON.x + 200, y: NEAR_BARON.y }
  const comp = (o: { gap?: number; allyAt?: P; where?: P; assists?: number[]; baronAfter?: number | null; alliesNear?: number[] } = {}) => buildGame({ minutes: 25, me: 2,
    frame: (i, pid) => ((o.alliesNear ?? []).includes(pid) && (i === 19 || i === 20) ? { position: { x: DEATH.x + 500, y: DEATH.y } } : undefined),
    events: [
      kill(T - (o.gap ?? 10_000), 4, 7, [], o.allyAt ?? NEAR_BARON),
      kill(T, 2, 7, o.assists ?? [8, 9], o.where ?? DEATH),
      ...(o.baronAfter === null ? [] : [{ type: 'ELITE_MONSTER_KILL', timestamp: T + (o.baronAfter ?? 30_000), monsterType: 'BARON_NASHOR', killerTeamId: 200, killerId: 7, position: BARON_PIT }]),
    ] })
  it('an ally fell there within 15 s before; the jungler dies outnumbered and the enemy takes the objective', () => {
    expect(withPattern(comp(), 'jungle-compensation-death')).toMatchObject({ trigger: 'critical-death', facts: { deathGapSec: 10, objective: 'baron' } })
    expect(withPattern(comp({ gap: S.windowSec * 1000 }), 'jungle-compensation-death')).toBeDefined()
    expect(withPattern(comp({ gap: S.windowSec * 1000 + 1 }), 'jungle-compensation-death')).toBeUndefined()
    expect(withPattern(comp({ allyAt: { x: DEATH.x + S.allyRadius, y: DEATH.y } }), 'jungle-compensation-death')).toBeDefined()
    expect(withPattern(comp({ allyAt: { x: DEATH.x + S.allyRadius + 1, y: DEATH.y } }), 'jungle-compensation-death')).toBeUndefined()
  })
  it('2+ more enemies on the kill than allies alive around', () => {
    expect(withPattern(comp({ assists: [8] }), 'jungle-compensation-death')).toBeDefined() // 2 against 0
    expect(withPattern(comp({ assists: [] }), 'jungle-compensation-death')).toBeUndefined() // 1 against 0
    expect(withPattern(comp({ alliesNear: [1] }), 'jungle-compensation-death')).toBeDefined() // 3 against 1
    expect(withPattern(comp({ alliesNear: [1, 3] }), 'jungle-compensation-death')).toBeUndefined() // 3 against 2
  })
  it('the enemy takes that objective within 60 s, the death next to its pit', () => {
    expect(withPattern(comp({ baronAfter: S.objectiveWithinSec * 1000 }), 'jungle-compensation-death')).toBeDefined()
    expect(withPattern(comp({ baronAfter: S.objectiveWithinSec * 1000 + 1 }), 'jungle-compensation-death')).toBeUndefined()
    expect(withPattern(comp({ baronAfter: null }), 'jungle-compensation-death')).toBeUndefined()
    const far: P = { x: BARON_PIT.x + 2801, y: BARON_PIT.y }
    expect(withPattern(comp({ where: far, allyAt: far }), 'jungle-compensation-death')).toBeUndefined()
  })
})

describe('pattern — jungle: boots before 8:00 without a kill', () => {
  const S = DETECTOR_SPEC.earlyBoots
  const boots = (ts: number, extra: any[] = [], me = 2) => buildGame({ minutes: 10, me, events: [buy(10_000, me), buy(ts, me, S.itemId), ...extra] })
  it('bought before 8:00, the moment in the fountain', () => {
    expect(withPattern(boots(300_000), 'jungle-early-boots')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 300, zone: 'own-base', facts: { bootsSec: 300 } })
    expect(withPattern(boots(S.untilSec * 1000 - 1), 'jungle-early-boots')).toBeDefined()
    expect(withPattern(boots(S.untilSec * 1000), 'jungle-early-boots')).toBeUndefined()
  })
  it('a kill before them excuses them (not one after); other items and other roles do not count', () => {
    expect(withPattern(boots(300_000, [kill(200_000, 7, 2)]), 'jungle-early-boots')).toBeUndefined()
    expect(withPattern(boots(300_000, [kill(400_000, 7, 2)]), 'jungle-early-boots')).toBeDefined()
    expect(withPattern(buildGame({ minutes: 10, me: 2, events: [buy(300_000, 2, 1036)] }), 'jungle-early-boots')).toBeUndefined()
    expect(withPattern(boots(300_000, [], 1), 'jungle-early-boots')).toBeUndefined()
  })
})

describe('pattern — jungle: a side-lane T1 destroyed between 14:00 and 20:00', () => {
  const S = DETECTOR_SPEC.sideTower
  const tower = (ts: number, o: { lane?: string; owner?: number; killer?: number; first?: boolean } = {}) => ({ type: 'BUILDING_KILL', timestamp: ts, buildingType: 'TOWER_BUILDING',
    towerType: 'OUTER_TURRET', laneType: o.lane ?? 'TOP_LANE', teamId: o.owner ?? 200, killerId: o.killer ?? 2, position: { x: 4318, y: 13875 } })
  const game = (ts: number, o: Parameters<typeof tower>[1] = {}, first = true) => buildGame({ minutes: 25, me: 2,
    events: [...(first ? [tower(600_000, { lane: 'MID_LANE', killer: 3 })] : []), tower(ts, o)] })
  it('last-hit by the jungler after 14:00 (plates gone) and until 20:00, once a tower has fallen', () => {
    expect(withPattern(game(900_000), 'jungle-side-t1-destroyed')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 900, facts: { turretLane: 'TOP' } })
    expect(withPattern(game(S.fromSec * 1000), 'jungle-side-t1-destroyed')).toBeUndefined()
    expect(withPattern(game(S.fromSec * 1000 + 1), 'jungle-side-t1-destroyed')).toBeDefined()
    expect(withPattern(game(S.untilSec * 1000), 'jungle-side-t1-destroyed')).toBeDefined()
    expect(withPattern(game(S.untilSec * 1000 + 1), 'jungle-side-t1-destroyed')).toBeUndefined()
  })
  it('not the first tower, not the mid T1, not ours, not an ally\'s last hit', () => {
    expect(withPattern(game(900_000, {}, false), 'jungle-side-t1-destroyed')).toBeUndefined()
    expect(withPattern(game(900_000, { lane: 'MID_LANE' }), 'jungle-side-t1-destroyed')).toBeUndefined()
    expect(withPattern(game(900_000, { owner: 100, killer: 7 }), 'jungle-side-t1-destroyed')).toBeUndefined()
    expect(withPattern(game(900_000, { killer: 1 }), 'jungle-side-t1-destroyed')).toBeUndefined()
  })
})

describe('pattern — jungle: dead with the Eye of the Herald in their pocket (14:00–19:30)', () => {
  const S = DETECTOR_SPEC.heraldEye
  const P_ = 'jungle-herald-unused-death' as const
  // Riot logs the eye (item 3513) leaving its holder's inventory — used or expired — as ITEM_DESTROYED; the pick-up is not logged.
  const eyeGone = (ts: number, participantId: number) => ({ type: 'ITEM_DESTROYED', timestamp: ts, participantId, itemId: S.itemId })
  const game = (o: { heraldAt?: number; deathAt?: number; goneAt?: number | null; holder?: number; team?: number; killer?: number } = {}) => {
    const deathAt = o.deathAt ?? 1_000_000
    const team = o.team ?? 100
    return buildGame({ minutes: 25, me: 2, events: [
      { type: 'ELITE_MONSTER_KILL', timestamp: o.heraldAt ?? 930_000, monsterType: 'RIFTHERALD', killerTeamId: team, killerId: team === 100 ? 1 : 6, position: BARON_PIT },
      kill(deathAt, 2, o.killer ?? 8, o.killer === 0 ? [] : [9], { x: 6000, y: 9000 }),
      ...(o.goneAt === null ? [] : [eyeGone(o.goneAt ?? deathAt + 60_000, o.holder ?? 2)]),
    ] })
  }
  it('the eye left the jungler\'s inventory only after that death', () => {
    expect(withPattern(game(), P_)).toMatchObject({ trigger: 'critical-death', facts: { heraldAgoSec: 70 } })
    expect(withPattern(game({ goneAt: 1_000_001 }), P_)).toBeDefined()
    expect(withPattern(game({ goneAt: 1_000_000 }), P_)).toBeUndefined()
    expect(withPattern(game({ goneAt: 990_000 }), P_)).toBeUndefined() // used before dying
  })
  it('the jungler is the holder, of a Herald their team took; no logged use, no reading', () => {
    expect(withPattern(game({ holder: 1 }), P_)).toBeUndefined()
    expect(withPattern(game({ team: 200 }), P_)).toBeUndefined()
    expect(withPattern(game({ goneAt: null }), P_)).toBeUndefined()
  })
  it('not the Herald fight itself: 20 s or more after it fell (the eye lies on the ground that long)', () => {
    expect(withPattern(game({ heraldAt: 1_000_000 - S.pickupSec * 1000 }), P_)).toBeDefined()
    expect(withPattern(game({ heraldAt: 1_000_000 - S.pickupSec * 1000 + 1 }), P_)).toBeUndefined()
  })
  it('a death in a fight, from 14:00 to 19:30 inclusive', () => {
    expect(withPattern(game({ heraldAt: 800_000, deathAt: S.fromSec * 1000 }), P_)).toBeDefined()
    expect(withPattern(game({ heraldAt: 800_000, deathAt: S.fromSec * 1000 - 1 }), P_)).toBeUndefined()
    expect(withPattern(game({ deathAt: S.untilSec * 1000 }), P_)).toBeDefined()
    expect(withPattern(game({ deathAt: S.untilSec * 1000 + 1 }), P_)).toBeUndefined()
    expect(withPattern(game({ killer: 0 }), P_)).toBeUndefined()
  })
})

describe('pattern — jungle: fled an invade at very low HP (before 15:00)', () => {
  const S = DETECTOR_SPEC.fledInvade
  const fled = (o: { k?: number; mine?: number; theirs?: number; gap?: number; allyGap?: number | null; camps?: number; extra?: any[] } = {}) => {
    const k = o.k ?? 6
    return buildGame({ minutes: 18, me: 2,
      frame: (i, pid) => {
        if (i === k && pid === 2) return { ...hp(o.mine ?? 10), position: OUR_TOP_JUNGLE }
        if (i === k && pid === 7) return { ...hp(o.theirs ?? 80), position: { x: OUR_TOP_JUNGLE.x + (o.gap ?? 1000), y: OUR_TOP_JUNGLE.y }, jungleMinionsKilled: 30 }
        if (i === k + 1 && pid === 7) return { jungleMinionsKilled: 30 + (o.camps ?? 4) }
        if (i === k && pid === 1 && o.allyGap !== null) return { position: { x: OUR_TOP_JUNGLE.x, y: OUR_TOP_JUNGLE.y + (o.allyGap ?? 1500) } }
        return undefined
      }, events: o.extra ?? [] })
  }
  it('under 15 % HP against an enemy jungler above 70 %, both strict', () => {
    expect(withPattern(fled(), 'jungle-fled-invade')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: 360, facts: { hpPct: 10, opponentHpPct: 80 } })
    expect(withPattern(fled({ mine: S.hpPct }), 'jungle-fled-invade')).toBeUndefined()
    expect(withPattern(fled({ theirs: S.enemyHpPct }), 'jungle-fled-invade')).toBeUndefined()
  })
  it('the enemy jungler and an ally within 2000, alive 15 s later, the enemy jungler taking a camp, before 15:00', () => {
    expect(withPattern(fled({ gap: S.radius }), 'jungle-fled-invade')).toBeDefined()
    expect(withPattern(fled({ gap: S.radius + 1 }), 'jungle-fled-invade')).toBeUndefined()
    expect(withPattern(fled({ allyGap: S.radius + 1 }), 'jungle-fled-invade')).toBeUndefined()
    expect(withPattern(fled({ allyGap: null }), 'jungle-fled-invade')).toBeUndefined()
    expect(withPattern(fled({ extra: [kill(360_000 + S.aliveSec * 1000, 2, 7, [], OUR_TOP_JUNGLE)] }), 'jungle-fled-invade')).toBeUndefined()
    expect(withPattern(fled({ camps: S.campCs - 1 }), 'jungle-fled-invade')).toBeUndefined()
    expect(withPattern(fled({ k: S.untilSec / 60 - 1 }), 'jungle-fled-invade')).toBeDefined()
    expect(withPattern(fled({ k: S.untilSec / 60 }), 'jungle-fled-invade')).toBeUndefined()
  })
})

describe('pattern — jungle: outsmited in the pit', () => {
  const S = DETECTOR_SPEC.outsmite
  const dragon = { type: 'ELITE_MONSTER_KILL', timestamp: 400_000, monsterType: 'DRAGON', killerTeamId: 200, killerId: 7, position: DRAGON_PIT }
  const pit = (gap: number, me = 2) => buildGame({ minutes: 12, me,
    frame: (i, pid) => (pid === me && (i === 6 || i === 7) ? { position: { x: DRAGON_PIT.x + gap, y: DRAGON_PIT.y } } : undefined), events: [dragon] })
  it('the enemy takes the Dragon while the jungler, alive, stands within 900 of the pit', () => {
    expect(withPattern(pit(500), 'jungle-outsmited')).toMatchObject({ trigger: 'absent-objective', gameTimeSec: 390, facts: { objective: 'dragon', playerDistance: 500 } })
    expect(withPattern(pit(S.pitRadius - 1), 'jungle-outsmited')).toBeDefined()
    expect(withPattern(pit(S.pitRadius), 'jungle-outsmited')).toBeUndefined()
  })
  it('it is the one reading of that objective (no absence reported), for the jungler only', () => {
    expect(run(pit(500)).moments.filter((m) => m.trigger === 'absent-objective').map((m) => m.facts.pattern)).toEqual(['jungle-outsmited'])
    expect(withPattern(pit(500, 3), 'jungle-outsmited')).toBeUndefined()
  })
})

describe('pattern — mid: dead in lane right out of base (before 12:00)', () => {
  const S = DETECTOR_SPEC.aheadOfWave
  const back = (o: { shop?: number | null; deathAt?: number; where?: P; killer?: number; extra?: any[] } = {}) => buildGame({ minutes: 14, me: 3, events: [
    buy(10_000, 3), ...(o.shop === null ? [] : [buy(o.shop ?? 300_000, 3)]), kill(o.deathAt ?? 340_000, 3, o.killer ?? 8, [], o.where ?? MID_LANE), ...(o.extra ?? []),
  ] })
  it('at most 45 s after leaving base, in the mid lane', () => {
    expect(withPattern(back(), 'mid-ahead-of-wave-death')).toMatchObject({ trigger: 'critical-death', facts: { sinceBaseSec: 40 } })
    expect(withPattern(back({ deathAt: 300_000 + S.afterBaseSec * 1000 }), 'mid-ahead-of-wave-death')).toBeDefined()
    expect(withPattern(back({ deathAt: 300_000 + S.afterBaseSec * 1000 + 1 }), 'mid-ahead-of-wave-death')).toBeUndefined()
    expect(withPattern(back({ where: { x: 5000, y: 9500 } }), 'mid-ahead-of-wave-death')).toBeUndefined()
  })
  it('a respawn is a way out of base too; the starting items are not; before 12:00; killed by a champion', () => {
    expect(withPattern(back({ shop: null, deathAt: 330_000, extra: [kill(280_000, 3, 8, [], MID_LANE)] }), 'mid-ahead-of-wave-death')).toBeDefined()
    expect(withPattern(back({ shop: null, deathAt: 50_000 }), 'mid-ahead-of-wave-death')).toBeUndefined()
    expect(withPattern(back({ shop: S.untilSec * 1000 - 30_000, deathAt: S.untilSec * 1000 - 1000 }), 'mid-ahead-of-wave-death')).toBeDefined()
    expect(withPattern(back({ shop: S.untilSec * 1000 - 30_000, deathAt: S.untilSec * 1000 }), 'mid-ahead-of-wave-death')).toBeUndefined()
    expect(withPattern(back({ killer: 0 }), 'mid-ahead-of-wave-death')).toBeUndefined()
  })
  it('wins over the gank-timer reading when both apply', () => {
    expect(patternsOf(back({ shop: 160_000, deathAt: 200_000, killer: 7 }))).toEqual(['mid-ahead-of-wave-death'])
  })
})

describe('pattern — mid: caught in a reset trap (before 12:00)', () => {
  const S = DETECTOR_SPEC.resetTrap
  const trap = (o: { stats?: Record<string, number>; deathAt?: number; myShop?: number; enemyDied?: boolean } = {}) => buildGame({ minutes: 14, me: 3,
    frame: (i, pid) => (pid === 3 && i === 6 ? { championStats: { health: 200, healthMax: 1000, power: 300, powerMax: 400, ...(o.stats ?? {}) } } : undefined),
    events: [buy(10_000, 3), buy(10_000, 8), buy(400_000, 8), ...(o.myShop ? [buy(o.myShop, 3)] : []), ...(o.enemyDied ? [kill(370_000, 8, 3, [], MID_LANE)] : []),
      kill(o.deathAt ?? 450_000, 3, 8, [], MID_LANE)] })
  it('the enemy mid backed first; the player under 30 % HP stayed and died within 90 s', () => {
    expect(withPattern(trap(), 'mid-reset-trap-death')).toMatchObject({ facts: { resetResource: 'hp', resetLowPct: 20, enemyBackSec: 50 } })
    expect(withPattern(trap({ stats: { health: 300 } }), 'mid-reset-trap-death')).toBeUndefined()
    expect(withPattern(trap({ deathAt: 400_000 + S.withinSec * 1000 }), 'mid-reset-trap-death')).toBeDefined()
    expect(withPattern(trap({ deathAt: 400_000 + S.withinSec * 1000 + 1 }), 'mid-reset-trap-death')).toBeUndefined()
  })
  it('or under 30 % mana — a real mana pool, not energy', () => {
    expect(withPattern(trap({ stats: { health: 800, power: 100 } }), 'mid-reset-trap-death')).toMatchObject({ facts: { resetResource: 'mana', resetLowPct: 25 } })
    expect(withPattern(trap({ stats: { health: 800, power: 40, powerMax: 200 } }), 'mid-reset-trap-death')).toBeUndefined()
  })
  it('the player did not back meanwhile; the enemy back was a back, not a respawn', () => {
    expect(withPattern(trap({ myShop: 400_000 - S.stayedSec * 1000 }), 'mid-reset-trap-death')).toBeUndefined()
    expect(withPattern(trap({ myShop: 400_000 - S.stayedSec * 1000 - 1 }), 'mid-reset-trap-death')).toBeDefined()
    expect(withPattern(trap({ enemyDied: true }), 'mid-reset-trap-death')).toBeUndefined()
  })
})

describe('pattern — mid: lane given away (12+ CS behind at 6:00)', () => {
  const S = DETECTOR_SPEC.midWaveLoss
  const lane = (o: { behind?: number; slots?: number[]; at10?: number; extra?: any[] } = {}) => buildGame({ minutes: 14, me: 3,
    frame: (i, pid) => (pid === 3 && i === 6 ? { minionsKilled: 42 - (o.behind ?? 12) } : pid === 3 && i === 10 && o.at10 != null ? { minionsKilled: 70 - o.at10 } : undefined),
    events: [...(o.slots ?? [1, 2, 3]).map((s, n) => skillUp(30_000 + n * 60_000, 3, s)), ...(o.extra ?? [])] })
  it('12+ CS behind at 6:00 with one point in each spell at level 3', () => {
    expect(withPattern(lane(), 'mid-passive-wave-loss')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: S.atSec, facts: { csDiff6: -12 } })
    expect(withPattern(lane({ behind: 11 }), 'mid-passive-wave-loss')).toBeUndefined()
    expect(withPattern(lane({ slots: [1, 1, 2] }), 'mid-passive-wave-loss')).toBeUndefined()
    expect(withPattern(lane({ slots: [1, 2] }), 'mid-passive-wave-loss')).toBeUndefined()
  })
  it('2 takedowns before 6:00 pay for the CS (as at 10:00), 1 does not', () => {
    const takedowns = (n: number) => Array.from({ length: n }, (_, j) => kill(200_000 + j * 30_000, 8, 3, [], MID_LANE))
    expect(withPattern(lane({ extra: takedowns(S.takedowns - 1) }), 'mid-passive-wave-loss')).toBeDefined()
    expect(withPattern(lane({ extra: takedowns(S.takedowns) }), 'mid-passive-wave-loss')).toBeUndefined()
  })
  it('is the lane\'s CS story: the 10:00 deficit is not reported a second time', () => {
    const deficits = (g: Game) => run(g).moments.filter((m) => m.trigger === 'early-deficit').map((m) => m.facts.pattern ?? '10:00')
    expect(deficits(lane({ at10: 20 }))).toEqual(['mid-passive-wave-loss'])
    expect(deficits(lane({ at10: 20, slots: [1, 1, 2] }))).toEqual(['10:00'])
  })
})

describe('pattern — support: glued to the ADC after level 6', () => {
  const S = DETECTOR_SPEC.supportLeech
  const BOT: P = { x: 10500, y: 1500 }
  const leech = (o: { snapshots?: number; level?: number; extra?: any[]; me?: number } = {}) => buildGame({ minutes: 18, me: o.me ?? 5,
    frame: (i, pid) => {
      if (pid === 5 && i === 9) return { level: o.level ?? 6, position: BOT }
      if ((pid === 5 || pid === 4) && i >= 9 && i <= 15) return { position: pid === 5 && i - 9 >= (o.snapshots ?? 7) ? { x: 7000, y: 7000 } : BOT }
      return undefined
    }, events: [ward(60_000, 5), ...(o.extra ?? [])] })
  it('level 6 at 9:00 and next to the ADC in bot lane on 6 of the 7 snapshots (over 75 %)', () => {
    expect(withPattern(leech(), 'support-botlane-leech')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: S.fromSec, facts: { laneSnapshots: 7, kpPct: 0 } })
    expect(withPattern(leech({ snapshots: S.snapshots }), 'support-botlane-leech')).toBeDefined()
    expect(withPattern(leech({ snapshots: S.snapshots - 1 }), 'support-botlane-leech')).toBeUndefined()
    expect(withPattern(leech({ level: S.level - 1 }), 'support-botlane-leech')).toBeUndefined()
  })
  it('under 45 % kill participation at 15:00; supports only', () => {
    const kills = (mine: number, total: number) => Array.from({ length: total }, (_, n) => kill(600_000 + n * 10_000, 6 + (n % 5), 4, n < mine ? [5] : [], { x: 10000, y: 1000 }))
    expect(withPattern(leech({ extra: kills(1, 3) }), 'support-botlane-leech')).toMatchObject({ facts: { kpPct: 33 } })
    expect(withPattern(leech({ extra: kills(9, 20) }), 'support-botlane-leech')).toBeUndefined() // 45 %
    expect(withPattern(leech({ me: 4 }), 'support-botlane-leech')).toBeUndefined()
  })
})

describe('pattern — support: missing at the 3:30 Scuttle Crab', () => {
  const S = DETECTOR_SPEC.supportScuttle
  const scuttle = (o: { deathAt?: number; where?: P; supportAt?: P; extra?: any[] } = {}) => buildGame({ minutes: 8, me: 5,
    frame: (i, pid) => (pid === 5 && (i === 3 || i === 4) && o.supportAt ? { position: o.supportAt } : undefined),
    events: [ward(60_000, 5), kill(o.deathAt ?? 215_000, 2, 7, [10], o.where ?? BOT_RIVER), ...(o.extra ?? [])] })
  it('our jungler dead in the bot river from 3:25 to 3:50, the support more than 2000 away', () => {
    expect(withPattern(scuttle(), 'support-absent-scuttle')).toMatchObject({ trigger: 'absent-objective', gameTimeSec: 205 })
    expect(withPattern(scuttle({ deathAt: S.fromSec * 1000 }), 'support-absent-scuttle')).toBeDefined()
    expect(withPattern(scuttle({ deathAt: S.fromSec * 1000 - 1 }), 'support-absent-scuttle')).toBeUndefined()
    expect(withPattern(scuttle({ deathAt: S.untilSec * 1000 }), 'support-absent-scuttle')).toBeDefined()
    expect(withPattern(scuttle({ deathAt: S.untilSec * 1000 + 1 }), 'support-absent-scuttle')).toBeUndefined()
  })
  it('not when the support was close or got a takedown there, nor for a top-river death', () => {
    expect(withPattern(scuttle({ supportAt: { x: BOT_RIVER.x - 500, y: BOT_RIVER.y } }), 'support-absent-scuttle')).toBeUndefined()
    expect(withPattern(scuttle({ extra: [kill(220_000, 7, 5)] }), 'support-absent-scuttle')).toBeUndefined()
    expect(withPattern(scuttle({ where: { x: 5000, y: 9500 } }), 'support-absent-scuttle')).toBeUndefined()
  })
})
