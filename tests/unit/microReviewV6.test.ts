/**
 * V6 brief (roles): the 5 AscendCodex fiches, the QCM cards they get, and the four role detectors (seven
 * patterns), each threshold tested on both sides of its boundary. Also the brief's engine-wide guarantees:
 * no duplicate fiche or trigger, no unofficial video, no outside creator / coach / player name anywhere.
 * The checks that run over every pattern and context (V5 to V6) live in microReviewV5.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { CODEX, CODEX_ALIASES, codexById, codexFor } from '../../src/lib/microReview/codex'
import {
  buildQcm, optionsFor, QCM_CONTEXTS, CODEX_SUPPORT_EARLY, CODEX_TEAM_SYNC, CODEX_ADC_MIDGAME, CODEX_JUNGLE_DISCIPLINE,
  CODEX_LEVEL_SPIKE, CODEX_OBJ_SETUP, CODEX_131, CODEX_BARON, CODEX_SINGLE_THREAT,
} from '../../src/lib/microReview/smartQcm'
import {
  analyzeGame, DETECTOR_SPEC, GARBAGE_CEILING_EXEMPT, MOMENT_PATTERNS, type CriticalMoment, type MomentFacts, type MomentPattern,
} from '../../src/lib/microReview/anomalyDetector'
import { GARBAGE_HIGH, GARBAGE_LOW } from '../../src/lib/microReview/winProbability'
import { BARON_PIT, BASE_BOX, DRAGON_PIT, inBaseBox, laneOf, territoryOf, zoneOf } from '../../src/lib/microReview/geometry'
import { buildGame, at } from './microReviewFixtures'

const V6_ADC_LANE = 'codex_adc_wave_support_synergy_14gold_trap_1300g_buy_mid_rotation'
const V6_IDS = [CODEX_SUPPORT_EARLY, CODEX_TEAM_SYNC, V6_ADC_LANE, CODEX_ADC_MIDGAME, CODEX_JUNGLE_DISCIPLINE]
/** The brief's qcmTrigger.condition → the detector patterns that implement it → the fiche of choice [1]. */
const V6_TRIGGERS: Record<string, { patterns: MomentPattern[]; fiche: string }> = {
  SUPPORT_EARLY_BUSH_OR_STACK_MISMANAGEMENT: { patterns: ['support-no-early-ward', 'support-level2-allin'], fiche: CODEX_SUPPORT_EARLY },
  GANKED_WHILE_TEAM_RESETTING_OR_MUTUAL_LOW_HP_RECALL: { patterns: ['gank-during-team-reset', 'low-hp-recall-before-objective'], fiche: CODEX_TEAM_SYNC },
  // Wave position, item charges and last-hits are not in Riot's timeline: no detector, the fiche answers its tag.
  ADC_WAVE_MISMATCH_OR_CS_TUNNEL_DURING_ENGAGE: { patterns: [], fiche: V6_ADC_LANE },
  ADC_SOLO_SIDELANE_REOPEN_OR_IDLE_MID: { patterns: ['adc-solo-sidelane-reopen'], fiche: CODEX_ADC_MIDGAME },
  JUNGLE_RECALLED_DURING_BARON_OR_FORCED_INHIB_DIVE: { patterns: ['jungle-baron-recall', 'inhib-forced-dive'], fiche: CODEX_JUNGLE_DISCIPLINE },
}

const moment = (facts: MomentFacts, trigger: CriticalMoment['trigger'] = 'critical-death', over: Partial<CriticalMoment> = {}): CriticalMoment => ({
  key: `${trigger}@200`, trigger, gameTimeSec: 200, severity: 0.3, position: null, zone: null, lane: null, territory: null,
  winProbBefore: 0.5, winProbAfter: 0.45, facts, ...over,
})

// ── Codex: audit, mapping, content ───────────────────────────────────────

describe('AscendCodex — V6 audit: nothing duplicated', () => {
  it('the 5 V6 ids are fiches of their own: no id, alias or headline collision', () => {
    // 61 after V6; later briefs add more (the current total is pinned in the latest brief's test file).
    expect(CODEX.length).toBeGreaterThanOrEqual(61)
    for (const id of V6_IDS) {
      expect(CODEX.filter((e) => e.id === id), id).toHaveLength(1)
      expect(CODEX_ALIASES[id], id).toBeUndefined()
    }
    expect(new Set(CODEX.map((e) => e.headline.fr)).size).toBe(CODEX.length)
  })
  it('each brief trigger is its own pattern(s), shared with no other trigger and no older pattern', () => {
    const v6 = Object.values(V6_TRIGGERS).flatMap((t) => t.patterns)
    const older = MOMENT_PATTERNS.slice(0, MOMENT_PATTERNS.indexOf('support-no-early-ward'))
    expect(new Set(MOMENT_PATTERNS).size).toBe(MOMENT_PATTERNS.length)
    expect(new Set(v6).size).toBe(v6.length)
    for (const p of v6) expect(older, p).not.toContain(p)
    expect(new Set(Object.values(V6_TRIGGERS).map((t) => t.fiche)).size).toBe(5)
  })
})

describe('AscendCodex — V6 fiches', () => {
  it.each([
    [CODEX_SUPPORT_EARLY, 'UTILITY', 'early', 'bad-positioning', ['forgot-trinket', 'bad-trade'], 'kp', 'vision_setup'],
    [CODEX_TEAM_SYNC, 'any', 'early', 'caught-out', ['overstay', 'cs-deficit', 'bad-trade'], 'kp', 'wave_management'],
    [V6_ADC_LANE, 'BOTTOM', 'early', 'bad-positioning', ['unused-gold', 'overstay', 'caught-out'], 'dmgm', 'trades'],
    [CODEX_ADC_MIDGAME, 'BOTTOM', 'mid', 'caught-out', ['overstay', 'bad-positioning'], 'kp', 'decision_making'],
    [CODEX_JUNGLE_DISCIPLINE, 'JUNGLE', 'early', 'overstay', ['bad-positioning', 'death-before-objective'], 'kp', 'cooldown_tracking'],
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
  it('keeps every number and technique of the brief', () => {
    const fr = (id: string) => { const e = codexById(id)!; return `${e.headline.fr} ${e.tacticalRule.fr} ${e.drillObjective.fr}` }
    expect(fr(CODEX_SUPPORT_EARLY)).toMatch(/1er buisson \(défensif\) dès 1:00/)
    expect(fr(CODEX_SUPPORT_EARLY)).toMatch(/2 premiers mêlées de la 2e wave/)
    expect(fr(CODEX_SUPPORT_EARLY)).toMatch(/AFTERSHOCK \(20 s de cooldown\)/)
    expect(fr(CODEX_SUPPORT_EARLY)).toMatch(/Draven\/Leona contre Smolder\/Janna/)
    expect(fr(CODEX_TEAM_SYNC)).toMatch(/50 % PV et l'ennemi à 30 %/)
    expect(fr(CODEX_TEAM_SYNC)).toMatch(/plus de 80 % PV/)
    expect(fr(CODEX_TEAM_SYNC)).toMatch(/1-CASTER HOLD/)
    expect(fr(CODEX_TEAM_SYNC)).toMatch(/projectiles alliés/)
    expect(fr(V6_ADC_LANE)).toMatch(/6 contre 4/)
    expect(fr(V6_ADC_LANE)).toMatch(/1225 g = 35 AD/)
    expect(fr(V6_ADC_LANE)).toMatch(/1300 g \(15 AD\)/)
    expect(fr(V6_ADC_LANE)).toMatch(/14 GOLDS/)
    expect(fr(V6_ADC_LANE)).toMatch(/Jinx/)
    expect(fr(CODEX_ADC_MIDGAME)).toMatch(/7\. recall conscient/)
    expect(fr(CODEX_ADC_MIDGAME)).toMatch(/1 à 2 s de vision/)
    expect(fr(CODEX_ADC_MIDGAME)).toMatch(/une seule wave bot avant de remonter mid/)
    expect(fr(CODEX_JUNGLE_DISCIPLINE)).toMatch(/Épée longue \(\+10 AD\)/)
    // 26.1: the Scuttle Crab spawns at 2:55 (was 3:30) — docs/RECHERCHE_CONNAISSANCES.md.
    expect(fr(CODEX_JUNGLE_DISCIPLINE)).toMatch(/Carapateur top juste après son apparition de 2:55/)
    expect(fr(CODEX_JUNGLE_DISCIPLINE)).toMatch(/100 s de cooldown/)
    expect(fr(CODEX_JUNGLE_DISCIPLINE)).toMatch(/3000 g en poche/)
  })
  it('answer their tags for their role ("Autre cause…") without displacing any other role\'s fiche', () => {
    expect(codexFor('bad-positioning', 'BOTTOM', 'early')!.id).toBe(V6_ADC_LANE)
    expect(codexFor('caught-out', 'BOTTOM', 'mid')!.id).toBe(CODEX_ADC_MIDGAME)
    expect(codexFor('forgot-trinket', 'UTILITY', 'early')!.id).toBe(CODEX_SUPPORT_EARLY)
    expect(codexFor('bad-positioning', 'UTILITY', 'early')!.id).toBe(CODEX_SUPPORT_EARLY)
    expect(codexFor('bad-positioning', 'TOP', 'early')!.id).toBe('codex_mechanics_lane_quadrants_minion_wall')
    expect(codexFor('caught-out', 'TOP', 'early')!.id).toBe('codex_vision_jungle_tracking_math_timers')
    expect(codexFor('caught-out', 'TOP', 'mid')!.id).toBe('caught-any-mid')
    expect(codexFor('overstay', 'JUNGLE', 'early')!.id).toBe('codex_jgl_pathing_integrity_reset_cycle')
    expect(codexFor('overstay', 'TOP', 'early')!.role).not.toBe('JUNGLE')
  })
})

describe('V6 — confidentiality and terminology', () => {
  const NAMES = /\bcoach ?k\b|mysterias|bizyze|booshi|kirei|\bfaker\b/i
  const locale = (lang: string) => JSON.parse(readFileSync(new URL(`../../src/i18n/locales/${lang}.json`, import.meta.url), 'utf8'))
  it('no outside coach, creator or player name in the Codex, the micro-review code or its texts', () => {
    expect(JSON.stringify(CODEX)).not.toMatch(NAMES)
    for (const lang of ['fr', 'en']) {
      const json = locale(lang)
      expect(JSON.stringify(json.microReview), lang).not.toMatch(NAMES)
      expect(JSON.stringify(json.codex), lang).not.toMatch(NAMES)
    }
    const dir = new URL('../../src/lib/microReview/', import.meta.url)
    for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(NAMES)
  })
  it('the V6 fiches carry no video; the micro-review texts keep the LoL jargon in English', () => {
    for (const id of V6_IDS) expect(codexById(id)!.videoExamples).toEqual([])
    expect(JSON.stringify(locale('fr').microReview)).not.toMatch(/\bvagues?\b|temps de recharge/i)
  })
})

// ── QCM ───────────────────────────────────────────────────────────────────

describe('SmartQCMGenerator — V6 cards', () => {
  it.each([
    [{ pattern: 'support-no-early-ward' }, 'early-deficit', 'forgot-trinket', 'supportEarly', CODEX_SUPPORT_EARLY, 'supportNoWard'],
    [{ pattern: 'support-level2-allin', myLevel: 1, enemyLevel: 2 }, 'critical-death', 'bad-positioning', 'supportEarly', CODEX_SUPPORT_EARLY, 'supportLevel2'],
    [{ pattern: 'gank-during-team-reset', alliesHome: 2 }, 'critical-death', 'caught-out', 'pressureDesync', CODEX_TEAM_SYNC, 'teamResetGank'],
    [{ pattern: 'low-hp-recall-before-objective', recallHpPct: 30, spawnInSec: 20, objective: 'dragon', alliesDown: 2 }, 'absent-objective', 'bad-trade', 'tradeRecall', CODEX_TEAM_SYNC, 'tradeRecall'],
    [{ pattern: 'adc-solo-sidelane-reopen', sinceBaseSec: 70 }, 'critical-death', 'caught-out', 'adcReopen', CODEX_ADC_MIDGAME, 'adcReopen'],
    [{ pattern: 'jungle-baron-recall', alliesDown: 2 }, 'absent-objective', 'overstay', 'baronRecall', CODEX_JUNGLE_DISCIPLINE, 'baronRecall'],
    [{ pattern: 'inhib-forced-dive', inhibGapSec: 8 }, 'critical-death', 'overstay', 'inhibDive', CODEX_JUNGLE_DISCIPLINE, 'inhibDive'],
  ] as const)('%o → choice [1] is the brief\'s fiche', (facts, trigger, tag, reason, codexId, head) => {
    const card = buildQcm(moment(facts as MomentFacts, trigger))
    expect(card.options[0]).toMatchObject({ outcome: 'mistake', tagSlug: tag, reason, codexId })
    expect(card.options).toHaveLength(3)
    expect(card.summary.head.key).toBe(head)
  })
  it('each brief trigger: one context per pattern, whose choice [1] is that trigger\'s fiche', () => {
    for (const [condition, { patterns, fiche }] of Object.entries(V6_TRIGGERS)) for (const pattern of patterns) {
      const card = buildQcm(moment({ pattern }))
      expect(card.contexts, condition).toHaveLength(1)
      expect(card.options[0].codexId, `${condition} / ${pattern}`).toBe(fiche)
    }
  })
  it('the second reading is the older fiche that covers the overlapping concept', () => {
    const second = (facts: MomentFacts) => buildQcm(moment(facts)).options[1]
    expect(second({ pattern: 'support-level2-allin' })).toMatchObject({ reason: 'levelSpike', codexId: CODEX_LEVEL_SPIKE })
    expect(second({ pattern: 'low-hp-recall-before-objective' })).toMatchObject({ reason: 'setupFail', codexId: CODEX_OBJ_SETUP })
    expect(second({ pattern: 'adc-solo-sidelane-reopen' })).toMatchObject({ reason: 'assignment131', codexId: CODEX_131 })
    expect(second({ pattern: 'jungle-baron-recall' })).toMatchObject({ reason: 'baronSiege', codexId: CODEX_BARON })
    expect(second({ pattern: 'inhib-forced-dive' })).toMatchObject({ reason: 'singleThreat', codexId: CODEX_SINGLE_THREAT })
  })
  it('a way out that does not count wherever the play can be right', () => {
    const exits = [['support-no-early-ward', 'trinketSaved'], ['low-hp-recall-before-objective', 'forcedRecall'], ['adc-solo-sidelane-reopen', 'crossMapPressure'],
      ['jungle-baron-recall', 'forcedRecall'], ['inhib-forced-dive', 'endPush']] as const
    for (const [pattern, reason] of exits) expect(buildQcm(moment({ pattern })).options.at(-1), pattern).toMatchObject({ outcome: 'justified', reason })
  })
  it('summaries carry only what the detector proved', () => {
    expect(buildQcm(moment({ pattern: 'support-level2-allin', myLevel: 1, enemyLevel: 2, junglerInvolved: true })).summary.head)
      .toEqual({ key: 'supportLevel2Gank', params: { mine: 1, theirs: 2 } })
    expect(buildQcm(moment({ pattern: 'low-hp-recall-before-objective', recallHpPct: 31, spawnInSec: 22, objective: 'grubs', opponentHpPct: 44, alliesDown: 3 }, 'absent-objective')).summary)
      .toMatchObject({ head: { key: 'tradeRecall', params: { pct: 31, sec: 22, objective: 'grubs' } }, extras: [{ key: 'opponentHp', params: { pct: 44 } }, { key: 'alliesDown', params: { count: 3 } }] })
    expect(buildQcm(moment({ pattern: 'adc-solo-sidelane-reopen', sinceBaseSec: 64, midInBase: true })).summary)
      .toMatchObject({ head: { key: 'adcReopen', params: { sec: 64 } }, extras: [{ key: 'midInBase' }] })
    expect(buildQcm(moment({ pattern: 'jungle-baron-recall', alliesDown: 2, goldInPocket: 3100 }, 'absent-objective')).summary.extras)
      .toEqual([{ key: 'alliesDown', params: { count: 2 } }, { key: 'gold', params: { gold: 3100 } }])
    expect(buildQcm(moment({ pattern: 'gank-during-team-reset', alliesHome: 3 })).summary.extras).toEqual([{ key: 'alliesHome', params: { n: 3 } }])
    expect(buildQcm(moment({ pattern: 'inhib-forced-dive', inhibGapSec: 9 })).summary.head).toEqual({ key: 'inhibDive', params: { sec: 9 } })
  })
  it('every linked fiche of every context exists and records one of its own tags', () => {
    for (const c of QCM_CONTEXTS) for (const facts of [{}, { hpPct: 20 }, { secondsSinceOwnPlay: 10 }, { playerWarded: true }]) {
      for (const o of optionsFor(c, facts).filter((x) => x.codexId)) {
        const e = codexById(o.codexId!)
        expect(e, `${c} → ${o.codexId}`).not.toBeNull()
        expect([e!.mistakeSlug, ...(e!.mistakeSlugs ?? [])], `${c} → ${o.codexId}`).toContain(o.tagSlug)
      }
    }
  })
})

// ── Detector: the four role detectors ─────────────────────────────────────

type Game = ReturnType<typeof buildGame>
type P = { x: number; y: number }
type FrameFn = (i: number, pid: number) => Record<string, unknown> | undefined
const run = (g: Game) => analyzeGame(g.match, g.timeline, g.selector)!
const withPattern = (g: Game, pattern: MomentPattern) => run(g).moments.find((m) => m.facts.pattern === pattern)
const patternsOf = (g: Game) => run(g).moments.map((m) => m.facts.pattern)
const kill = (ts: number, victimId: number, killerId: number, assists: number[] = [], position?: P) =>
  ({ type: 'CHAMPION_KILL', timestamp: ts, victimId, killerId, assistingParticipantIds: assists, ...(position ? { position } : {}) })
const levelUp = (ts: number, participantId: number, level: number) => ({ type: 'LEVEL_UP', timestamp: ts, participantId, level })
const buy = (ts: number, participantId: number) => ({ type: 'ITEM_PURCHASED', timestamp: ts, participantId, itemId: 1036 })
const ward = (ts: number, creatorId: number, wardType = 'YELLOW_TRINKET') => ({ type: 'WARD_PLACED', timestamp: ts, creatorId, wardType })
const hp = (pct: number) => ({ championStats: { health: pct * 10, healthMax: 1000 } })
// Participants 1–5 blue (top, jungle, mid, ADC, support), 6–10 red in the same order. Places as seen by blue:
const BOT_OWN: P = { x: 10500, y: 1500 }
const TOP_ENEMY: P = { x: 3000, y: 13500 }
const BOT_ENEMY: P = { x: 13500, y: 3000 }
const MID_LANE: P = { x: 7000, y: 7000 }
const ENEMY_BASE: P = { x: 12500, y: 12500 }
const FORWARD: P = { x: 11000, y: 9000 }
const OWN_JUNGLE: P = { x: 3500, y: 7500 }
const NEAR_DRAGON: P = { x: DRAGON_PIT.x + 500, y: DRAGON_PIT.y }
const NEAR_BARON: P = { x: BARON_PIT.x, y: BARON_PIT.y + 500 }

describe('detector — the V6 numbers and places', () => {
  it('are the ones of the brief, and the spawn timers measured on cached games', () => {
    expect(DETECTOR_SPEC.supportEarly).toEqual({ wardBySec: 70, deathFromSec: 90, deathToSec: 125 })
    expect(DETECTOR_SPEC.teamReset).toEqual({ untilSec: 840, lookbackSec: 15, alliesHome: 2 })
    expect(DETECTOR_SPEC.tradeRecall).toMatchObject({ untilSec: 840, hpPct: 40, beforeSpawnSec: 35 })
    expect(DETECTOR_SPEC.adcReopen).toMatchObject({ fromSec: 840, withinSec: 45 })
    expect(DETECTOR_SPEC.baronRecall).toMatchObject({ kda: 3, alliesForward: 3 })
    expect(DETECTOR_SPEC.inhibDive).toEqual({ withinSec: 15 })
    expect(DETECTOR_SPEC.spawns).toEqual({ firstDragonSec: 300, dragonRespawnSec: 300, grubsSec: 480 })
    expect(BASE_BOX).toEqual({ blueMax: 2000, redMin: 12800 })
  })
  it('reads the places it relies on', () => {
    expect([territoryOf(TOP_ENEMY, 100), laneOf(TOP_ENEMY), territoryOf(BOT_ENEMY, 100), laneOf(BOT_ENEMY)]).toEqual(['enemy', 'TOP', 'enemy', 'BOT'])
    expect([territoryOf(OWN_JUNGLE, 100), laneOf(OWN_JUNGLE), territoryOf(FORWARD, 100), zoneOf(ENEMY_BASE, 100), zoneOf(MID_LANE, 100)])
      .toEqual(['own', 'JUNGLE', 'enemy', 'enemy-base', 'mid-lane'])
    expect([inBaseBox({ x: 1999, y: 1999 }, 100), inBaseBox({ x: 2000, y: 100 }, 100), inBaseBox({ x: 12801, y: 12801 }, 200), inBaseBox({ x: 12800, y: 14000 }, 200)])
      .toEqual([true, false, true, false])
  })
})

describe('pattern — support: the level-2 fight lost (1:30–2:05)', () => {
  const S = DETECTOR_SPEC.supportEarly
  const fight = (o: { deathAt?: number; ups?: Array<[number, number, number]>; killer?: number; assists?: number[]; me?: number } = {}) => buildGame({
    minutes: 8, me: o.me ?? 5,
    events: [...(o.ups ?? [[85_000, 9, 2]]).map(([t, id, lvl]) => levelUp(t, id, lvl)), kill(o.deathAt ?? at(1, 45), o.me ?? 5, o.killer ?? 9, o.assists ?? [10], BOT_OWN)],
  })
  it('killed below the level of an enemy in the fight (LEVEL_UP events)', () => {
    expect(withPattern(fight(), 'support-level2-allin')).toMatchObject({ trigger: 'critical-death', gameTimeSec: 105, facts: { myLevel: 1, enemyLevel: 2 } })
    expect(withPattern(fight(), 'support-level2-allin')!.facts.junglerInvolved).toBeUndefined()
    expect(withPattern(fight({ ups: [[80_000, 5, 2], [85_000, 9, 2]] }), 'support-level2-allin')).toBeUndefined()
    expect(withPattern(fight({ ups: [[80_000, 5, 2], [85_000, 9, 2], [100_000, 9, 3]] }), 'support-level2-allin')).toMatchObject({ facts: { myLevel: 2, enemyLevel: 3 } })
  })
  it('from 1:30 to 2:05, both inclusive', () => {
    expect(withPattern(fight({ deathAt: S.deathFromSec * 1000 }), 'support-level2-allin')).toBeDefined()
    expect(withPattern(fight({ deathAt: S.deathFromSec * 1000 - 1 }), 'support-level2-allin')).toBeUndefined()
    expect(withPattern(fight({ deathAt: S.deathToSec * 1000 }), 'support-level2-allin')).toBeDefined()
    expect(withPattern(fight({ deathAt: S.deathToSec * 1000 + 1 }), 'support-level2-allin')).toBeUndefined()
  })
  it('a gank (enemy jungler in the fight) or an all-in; a support only; an enemy champion in the fight', () => {
    expect(withPattern(fight({ assists: [7] }), 'support-level2-allin')).toMatchObject({ facts: { junglerInvolved: true } })
    expect(withPattern(fight({ me: 4 }), 'support-level2-allin')).toBeUndefined()
    expect(withPattern(fight({ killer: 0, assists: [] }), 'support-level2-allin')).toBeUndefined()
  })
})

describe('pattern — support: no ward of their own by 1:10', () => {
  const S = DETECTOR_SPEC.supportEarly
  const lane = (events: any[] = [], me = 5) => buildGame({ minutes: 6, me, events })
  it('a moment at 1:10; a ward placed at 1:10 or before cancels it', () => {
    expect(withPattern(lane(), 'support-no-early-ward')).toMatchObject({ trigger: 'early-deficit', gameTimeSec: S.wardBySec })
    expect(withPattern(lane([ward(S.wardBySec * 1000, 5)]), 'support-no-early-ward')).toBeUndefined()
    expect(withPattern(lane([ward(S.wardBySec * 1000 + 1, 5)]), 'support-no-early-ward')).toBeDefined()
    expect(withPattern(lane([ward(40_000, 5, 'CONTROL_WARD')]), 'support-no-early-ward')).toBeUndefined()
  })
  it('champion objects (UNDEFINED) and other players\' wards do not count', () => {
    expect(withPattern(lane([ward(60_000, 5, 'UNDEFINED')]), 'support-no-early-ward')).toBeDefined()
    expect(withPattern(lane([ward(60_000, 4)]), 'support-no-early-ward')).toBeDefined()
  })
  it('a support alive until 1:10 only, never another role', () => {
    expect(withPattern(lane([kill(60_000, 5, 9, [], BOT_OWN)]), 'support-no-early-ward')).toBeUndefined()
    expect(withPattern(lane([], 4), 'support-no-early-ward')).toBeUndefined()
  })
  it('after a level-2 death the missing ward is the same story: one support moment, not two', () => {
    expect(patternsOf(buildGame({ minutes: 8, me: 5, events: [levelUp(85_000, 9, 2), kill(at(1, 45), 5, 9, [10], BOT_OWN)] }))).toEqual(['support-level2-allin'])
  })
})

describe('pattern — ganked while the team resets (before 14:00)', () => {
  const S = DETECTOR_SPEC.teamReset
  const DEATH = at(5, 10)
  const gank = (o: { me?: number; where?: P; deathAt?: number; killer?: number; assists?: number[]; home?: Array<[number, number]>; frame?: FrameFn; extra?: any[] } = {}) => {
    const deathAt = o.deathAt ?? DEATH
    const me = o.me ?? 1
    return buildGame({ minutes: 16, me, frame: o.frame, events: [
      ...(o.home ?? [[deathAt - 10_000, 2], [deathAt - 5_000, 5]]).map(([t, id]) => buy(t, id)),
      kill(deathAt, me, o.killer ?? 7, o.assists ?? [6], o.where ?? TOP_ENEMY), ...(o.extra ?? []),
    ] })
  }
  it('2+ allies in base (a purchase) in the 15 s before, inclusive', () => {
    expect(withPattern(gank(), 'gank-during-team-reset')).toMatchObject({ trigger: 'critical-death', facts: { alliesHome: 2 } })
    expect(withPattern(gank({ home: [[DEATH - S.lookbackSec * 1000, 2], [DEATH - 5_000, 5]] }), 'gank-during-team-reset')).toBeDefined()
    expect(withPattern(gank({ home: [[DEATH - S.lookbackSec * 1000 - 1, 2], [DEATH - 5_000, 5]] }), 'gank-during-team-reset')).toBeUndefined()
    expect(withPattern(gank({ home: [[DEATH - 5_000, 5]] }), 'gank-during-team-reset')).toBeUndefined()
  })
  it('a snapshot on the fountain platform counts as being in base', () => {
    const atHome: FrameFn = (i, pid) => (i === 5 && (pid === 2 || pid === 5) ? { position: { x: 1000, y: 1000 } } : undefined)
    expect(withPattern(gank({ home: [], frame: atHome, deathAt: at(5, 15) }), 'gank-during-team-reset')).toBeDefined()
    expect(withPattern(gank({ home: [], frame: atHome, deathAt: at(5, 16) }), 'gank-during-team-reset')).toBeUndefined()
  })
  it('the jungler or a bot laner among them; an ally who is dead is not resetting', () => {
    const adc = { me: 4, where: BOT_ENEMY, assists: [9] }
    expect(withPattern(gank({ ...adc, home: [[DEATH - 5_000, 1], [DEATH - 5_000, 3]] }), 'gank-during-team-reset')).toBeUndefined()
    expect(withPattern(gank({ ...adc, home: [[DEATH - 5_000, 1], [DEATH - 5_000, 5]] }), 'gank-during-team-reset')).toBeDefined()
    expect(withPattern(gank({ extra: [kill(DEATH - 2_000, 2, 8, [], MID_LANE)] }), 'gank-during-team-reset')).toBeUndefined()
  })
  it('a gank, in the enemy half of the player\'s own lane, before 14:00', () => {
    expect(withPattern(gank({ killer: 6, assists: [] }), 'gank-during-team-reset')).toBeUndefined()
    expect(withPattern(gank({ where: { x: 1500, y: 9000 } }), 'gank-during-team-reset')).toBeUndefined()
    expect(withPattern(gank({ where: BOT_ENEMY }), 'gank-during-team-reset')).toBeUndefined()
    expect(withPattern(gank({ deathAt: S.untilSec * 1000 - 1000 }), 'gank-during-team-reset')).toBeDefined()
    expect(withPattern(gank({ deathAt: S.untilSec * 1000 }), 'gank-during-team-reset')).toBeUndefined()
  })
  it('wins over the gank-timer reading when both apply', () => {
    expect(patternsOf(gank({ deathAt: at(2, 30) }))).toEqual(['gank-during-team-reset'])
  })
})

describe('pattern — forced back before an objective (before 14:00)', () => {
  const S = DETECTOR_SPEC.tradeRecall
  const SPAWN = DETECTOR_SPEC.spawns.firstDragonSec * 1000
  const P_ = 'low-hp-recall-before-objective' as const
  const recallGame = (o: { shop?: number; mine?: number; theirs?: number | null; where?: P; deaths?: any[]; extra?: any[] } = {}) => {
    const shop = o.shop ?? 285_000
    const fi = Math.floor((shop - S.channelSec * 1000) / 60_000)
    return buildGame({ minutes: 16, me: 3,
      frame: (i, pid) => {
        if (i === fi && pid === 3) return { ...hp(o.mine ?? 30), position: o.where ?? MID_LANE }
        if (i === fi && pid === 8 && o.theirs !== null) return hp(o.theirs ?? 50)
        return undefined
      },
      events: [buy(shop, 3), ...(o.deaths ?? [kill(shop + 20_000, 2, 7, [9], NEAR_DRAGON), kill(shop + 23_000, 4, 9, [7], NEAR_DRAGON)]), ...(o.extra ?? [])] })
  }
  it('under 40 % HP, the lane opponent under 60 % on the same snapshot', () => {
    expect(withPattern(recallGame(), P_)).toMatchObject({
      trigger: 'absent-objective', gameTimeSec: 277, facts: { objective: 'dragon', recallHpPct: 30, opponentHpPct: 50, spawnInSec: 23, alliesDown: 2, nearestPit: 'dragon' },
    })
    expect(withPattern(recallGame({ mine: S.hpPct - 1 }), P_)).toBeDefined()
    expect(withPattern(recallGame({ mine: S.hpPct }), P_)).toBeUndefined()
    expect(withPattern(recallGame({ theirs: S.opponentHpPct - 1 }), P_)).toBeDefined()
    expect(withPattern(recallGame({ theirs: S.opponentHpPct }), P_)).toBeUndefined()
    expect(withPattern(recallGame({ theirs: null }), P_)).toBeUndefined()
  })
  it('the back starts 0 to 35 s before the spawn (8 s of channel before the first purchase)', () => {
    const shopAt = (secBeforeSpawn: number) => SPAWN - secBeforeSpawn * 1000 + S.channelSec * 1000
    expect(withPattern(recallGame({ shop: shopAt(S.beforeSpawnSec) }), P_)).toMatchObject({ facts: { spawnInSec: 35 } })
    expect(withPattern(recallGame({ shop: shopAt(S.beforeSpawnSec) - 1 }), P_)).toBeUndefined()
    expect(withPattern(recallGame({ shop: shopAt(0) }), P_)).toMatchObject({ facts: { spawnInSec: 0 } })
    expect(withPattern(recallGame({ shop: shopAt(0) + 1 }), P_)).toBeUndefined()
  })
  it('a fight lost at that pit before the player is back (30 s after the purchase)', () => {
    expect(withPattern(recallGame({ deaths: [kill(305_000, 2, 7, [], NEAR_DRAGON), kill(306_000, 7, 2, [], NEAR_DRAGON)] }), P_)).toBeUndefined()
    expect(withPattern(recallGame({ deaths: [kill(285_000 + S.returnSec * 1000, 2, 7, [], NEAR_DRAGON)] }), P_)).toMatchObject({ facts: { alliesDown: 1 } })
    expect(withPattern(recallGame({ deaths: [kill(285_000 + S.returnSec * 1000 + 1, 2, 7, [], NEAR_DRAGON)] }), P_)).toBeUndefined()
    expect(withPattern(recallGame({ deaths: [kill(305_000, 2, 7, [], MID_LANE), kill(306_000, 4, 7, [], MID_LANE)] }), P_)).toBeUndefined()
  })
  it('a real back: alive the minute before, out of base on the snapshot, the first purchase of the visit', () => {
    expect(withPattern(recallGame({ extra: [kill(250_000, 3, 8, [], MID_LANE)] }), P_)).toBeUndefined()
    expect(withPattern(recallGame({ where: { x: 1000, y: 1000 } }), P_)).toBeUndefined()
    // A second purchase 27 s later belongs to the same visit: one back, dated by the first purchase (both would be
    // valid backs on their own, and 27 s apart is enough for two moments to survive the 25 s spacing).
    const visit = run(recallGame({ shop: 273_000, extra: [buy(300_000, 3)] })).moments.filter((m) => m.facts.pattern === P_)
    expect(visit.map((m) => m.gameTimeSec)).toEqual([265])
  })
  it('the Voidgrubs at 8:00 and the next dragon (5:00 after a kill) count too', () => {
    const grubs = buildGame({ minutes: 16, me: 3, frame: (i, pid) => (i === 7 && pid === 3 ? { ...hp(25), position: MID_LANE } : i === 7 && pid === 8 ? hp(45) : undefined),
      events: [buy(470_000, 3), kill(490_000, 1, 7, [], NEAR_BARON), kill(492_000, 2, 7, [], NEAR_BARON)] })
    expect(withPattern(grubs, P_)).toMatchObject({ facts: { objective: 'grubs', nearestPit: 'baron', spawnInSec: 18 } })
    const dragonKill = { type: 'ELITE_MONSTER_KILL', timestamp: 400_000, monsterType: 'DRAGON', killerTeamId: 100, killerId: 2, position: DRAGON_PIT }
    const second = buildGame({ minutes: 16, me: 3, frame: (i, pid) => (i === 11 && pid === 3 ? { ...hp(25), position: MID_LANE } : i === 11 && pid === 8 ? hp(45) : undefined),
      events: [dragonKill, buy(690_000, 3), kill(700_000, 1, 7, [], NEAR_DRAGON), kill(702_000, 2, 7, [], NEAR_DRAGON)] })
    expect(withPattern(second, P_)).toMatchObject({ facts: { objective: 'dragon', spawnInSec: 18 } })
  })
  it('claims the enemy objective of that fight: one absent moment, not two', () => {
    const enemyDragon = { type: 'ELITE_MONSTER_KILL', timestamp: 340_000, monsterType: 'DRAGON', killerTeamId: 200, killerId: 7, position: DRAGON_PIT }
    const absents = (g: Game) => run(g).moments.filter((m) => m.trigger === 'absent-objective').map((m) => m.facts.pattern ?? 'absent')
    expect(absents(recallGame({ extra: [enemyDragon] }))).toEqual([P_])
    // Without the forced back the same objective is an absent moment of its own (the claim is what removes it above).
    expect(absents(recallGame({ mine: 80, extra: [enemyDragon] }))).toEqual(['absent'])
  })
})

describe('pattern — ADC re-opening a side lane alone (after 14:00)', () => {
  const S = DETECTOR_SPEC.adcReopen
  const DEATH = at(20)
  const P_ = 'adc-solo-sidelane-reopen' as const
  const reopen = (o: { shop?: number | null; deathAt?: number; where?: P; frame?: FrameFn; extra?: any[] } = {}) => {
    const deathAt = o.deathAt ?? DEATH
    return buildGame({ minutes: 30, me: 4, frame: o.frame,
      events: [...(o.shop === null ? [] : [buy(o.shop ?? deathAt - 80_000, 4)]), kill(deathAt, 4, 6, [], o.where ?? TOP_ENEMY), ...(o.extra ?? [])] })
  }
  it('dead alone in a side lane across the river, at most 45 s of walk + 45 s after leaving base', () => {
    expect(withPattern(reopen(), P_)).toMatchObject({ trigger: 'critical-death', facts: { sinceBaseSec: 80 } })
    expect(withPattern(reopen({ shop: DEATH - (S.walkSec + S.withinSec) * 1000 }), P_)).toBeDefined()
    expect(withPattern(reopen({ shop: DEATH - (S.walkSec + S.withinSec) * 1000 - 1 }), P_)).toBeUndefined()
    expect(withPattern(reopen({ where: BOT_ENEMY }), P_)).toBeDefined()
  })
  it('a respawn is a way out of base too', () => {
    // Dead at 19:00 at level 10: back 33.6 s later, i.e. 26 s before the second death.
    expect(withPattern(reopen({ shop: null, extra: [kill(at(19), 4, 7, [], { x: 1000, y: 1000 })] }), P_)).toMatchObject({ facts: { sinceBaseSec: 26 } })
    expect(withPattern(reopen({ shop: null }), P_)).toBeUndefined()
  })
  it('after 14:00 only, with no ally around, across the river, in a side lane, for the ADC only', () => {
    expect(withPattern(reopen({ deathAt: S.fromSec * 1000 }), P_)).toBeUndefined()
    expect(withPattern(reopen({ deathAt: S.fromSec * 1000 + 1000 }), P_)).toBeDefined()
    const ally: FrameFn = (i, pid) => (pid === 5 && (i === 19 || i === 20) ? { position: { x: TOP_ENEMY.x + 300, y: TOP_ENEMY.y } } : undefined)
    expect(withPattern(reopen({ frame: ally }), P_)).toBeUndefined()
    expect(withPattern(reopen({ where: { x: 1500, y: 9000 } }), P_)).toBeUndefined()
    expect(withPattern(reopen({ where: { x: 9500, y: 9500 } }), P_)).toBeUndefined()
    expect(withPattern(buildGame({ minutes: 30, me: 1, events: [buy(DEATH - 80_000, 1), kill(DEATH, 1, 6, [], TOP_ENEMY)] }), P_)).toBeUndefined()
  })
  it('notes the mid laner in base meanwhile, and wins over the isolated front-tempo reading', () => {
    expect(withPattern(reopen({ extra: [buy(DEATH - 30_000, 3)] }), P_)).toMatchObject({ facts: { midInBase: true } })
    expect(withPattern(reopen(), P_)!.facts.midInBase).toBeUndefined()
    const DEEP: P = { x: 13700, y: 8000 }
    expect(patternsOf(reopen({ where: DEEP }))).toEqual([P_])
    expect(patternsOf(reopen({ where: DEEP, shop: null }))).toEqual(['tempo-front-isolated'])
  })
})

describe('pattern — the fed jungler away during the Baron buff', () => {
  const S = DETECTOR_SPEC.baronRecall
  const BARON = at(25)
  const T0 = at(26)
  const P_ = 'jungle-baron-recall' as const
  const baronKill = (team: number) => ({ type: 'ELITE_MONSTER_KILL', timestamp: BARON, monsterType: 'BARON_NASHOR', killerTeamId: team, killerId: team === 100 ? 2 : 7, position: BARON_PIT })
  const baronGame = (o: { t0?: number; down?: number[]; forward?: number[]; shop?: number | null; baronTeam?: number; frame?: FrameFn; gold?: number; extra?: any[] } = {}) => {
    const t0 = o.t0 ?? T0
    const k = Math.floor(t0 / 60_000)
    const forward = o.forward ?? [1, 3, 4]
    return buildGame({ minutes: 32, me: 2,
      frame: (i, pid) => ({
        ...(forward.includes(pid) && (i === k || i === k + 1) ? { position: FORWARD } : {}),
        ...(o.frame?.(i, pid) ?? {}),
        ...(pid === 2 && i === 25 && o.gold != null ? { totalGold: o.gold } : {}),
      }),
      events: [baronKill(o.baronTeam ?? 100), ...(o.shop === null ? [] : [buy(o.shop ?? t0 - 10_000, 2)]),
        ...(o.down ?? [1, 3]).map((v, n) => kill(t0 + n * 5_000, v, 8, [9], FORWARD)), ...(o.extra ?? [])] })
  }
  it('2+ allies dead in the enemy half, 3+ forward, while the jungler is in base', () => {
    expect(withPattern(baronGame(), P_)).toMatchObject({ trigger: 'absent-objective', gameTimeSec: 1542, facts: { alliesDown: 2, alliedBaron: true } })
    expect(withPattern(baronGame({ down: [1] }), P_)).toBeUndefined()
    expect(withPattern(baronGame({ forward: [1, 3] }), P_)).toBeUndefined()
  })
  it('during the 3-minute buff of a Baron of ours', () => {
    expect(withPattern(baronGame({ t0: BARON + 180_000 }), P_)).toBeDefined()
    expect(withPattern(baronGame({ t0: BARON + 180_001 }), P_)).toBeUndefined()
    expect(withPattern(baronGame({ baronTeam: 200 }), P_)).toBeUndefined()
  })
  it('ahead = KDA above 3, or 10 000 g spent', () => {
    expect(withPattern(baronGame({ gold: 10_299 }), P_)).toBeUndefined() // 9 999 g spent, no kill
    expect(withPattern(baronGame({ gold: 10_300 }), P_)).toBeDefined() // 10 000 g spent
    const takedowns = (n: number) => Array.from({ length: n }, (_, j) => kill(at(10 + j), 6 + (j % 5), 2, [], MID_LANE))
    expect(withPattern(baronGame({ gold: 5_000, extra: takedowns(4) }), P_)).toBeDefined() // KDA 4
    expect(withPattern(baronGame({ gold: 5_000, extra: takedowns(3) }), P_)).toBeUndefined() // KDA 3
  })
  it('out of the fight: a purchase from 30 s before to 15 s after it broke out, or clearing their own jungle', () => {
    expect(withPattern(baronGame({ shop: T0 - S.awayBeforeSec * 1000 }), P_)).toBeDefined()
    expect(withPattern(baronGame({ shop: T0 - S.awayBeforeSec * 1000 - 1 }), P_)).toBeUndefined()
    expect(withPattern(baronGame({ shop: T0 + S.awayAfterSec * 1000 }), P_)).toBeDefined()
    expect(withPattern(baronGame({ shop: T0 + S.awayAfterSec * 1000 + 1 }), P_)).toBeUndefined()
    const clearing = (camps: number): FrameFn => (i, pid) => (pid === 2 && (i === 26 || i === 27) ? { position: OWN_JUNGLE, jungleMinionsKilled: i === 26 ? 100 : 100 + camps } : undefined)
    expect(withPattern(baronGame({ shop: null, frame: clearing(4) }), P_)).toBeDefined()
    expect(withPattern(baronGame({ shop: null, frame: clearing(0) }), P_)).toBeUndefined()
    expect(withPattern(baronGame({ extra: [kill(T0 + 2_000, 8, 4, [2], FORWARD)] }), P_)).toBeUndefined()
  })
  it('claims the fight: the late-recall tempo line does not report it a second time', () => {
    // Three allies die high on the tempo line at 26:30 while the jungler is back in base. Their purchase 10 s into the
    // fight dates the recall 32 s after the tempo-line anchor (fight − 30 s): without the claim both moments would survive.
    const t0 = at(26, 30)
    const lateRecall: FrameFn = (i, pid) => (pid === 2 && i === 26 ? { currentGold: 2000 } : pid === 2 && i === 27 ? { position: { x: 500, y: 500 } } : undefined)
    const fight = { t0, down: [1, 3, 4], shop: t0 + 10_000, frame: lateRecall }
    const both = (g: Game) => patternsOf(g).filter((p) => p === P_ || p === 'tempo-late-recall')
    expect(both(baronGame(fight))).toEqual([P_])
    expect(both(baronGame({ ...fight, baronTeam: 200 }))).toEqual(['tempo-late-recall'])
  })
})

describe('pattern — the jungler diving after an inhibitor', () => {
  const S = DETECTOR_SPEC.inhibDive
  const INHIB = at(30)
  const P_ = 'inhib-forced-dive' as const
  const dive = (o: { me?: number; deathAt?: number; where?: P; team?: number; frame?: FrameFn } = {}) => buildGame({ minutes: 35, me: o.me ?? 2, frame: o.frame, events: [
    { type: 'BUILDING_KILL', timestamp: INHIB, buildingType: 'INHIBITOR_BUILDING', teamId: o.team ?? 200, killerId: 1, laneType: 'MID_LANE', position: { x: 11598, y: 11667 } },
    kill(o.deathAt ?? INHIB + 10_000, o.me ?? 2, 8, [9], o.where ?? ENEMY_BASE),
  ] })
  it('dead in the enemy base within 15 s after an enemy inhibitor fell, inclusive', () => {
    expect(withPattern(dive(), P_)).toMatchObject({ trigger: 'critical-death', facts: { inhibGapSec: 10 } })
    expect(withPattern(dive({ deathAt: INHIB + S.withinSec * 1000 }), P_)).toBeDefined()
    expect(withPattern(dive({ deathAt: INHIB + S.withinSec * 1000 + 1 }), P_)).toBeUndefined()
    expect(withPattern(dive({ deathAt: INHIB }), P_)).toBeUndefined()
  })
  it('the enemy\'s inhibitor, in their base, for the jungler only; it wins over the front-tempo reading', () => {
    expect(withPattern(dive({ team: 100 }), P_)).toBeUndefined()
    expect(withPattern(dive({ where: { x: 9500, y: 9500 } }), P_)).toBeUndefined()
    expect(withPattern(dive({ me: 1 }), P_)).toBeUndefined()
    expect(patternsOf(dive())).toEqual([P_])
    expect(patternsOf(dive({ deathAt: INHIB + 16_000 }))).toEqual(['tempo-front-isolated'])
  })

  describe('garbage time: kept above 85 % (throwing a won game is the mistake), the 18 % floor still applies', () => {
    // Every blue player 2 000 g ahead (or behind) of the default fixture gold: P(win) far above 0.85 (or under 0.18).
    const lead = (perPlayer: number): FrameFn => (i, pid) => (pid <= 5 ? { totalGold: 500 + i * 400 + perPlayer } : undefined)
    it('exactly the two jungle patterns', () => {
      expect([...GARBAGE_CEILING_EXEMPT].sort()).toEqual(['inhib-forced-dive', 'jungle-baron-recall'])
    })
    it('the dive after an inhibitor, while every other reading of the game is dropped', () => {
      const m = withPattern(dive({ frame: lead(2000) }), P_)!
      expect(m.winProbBefore!).toBeGreaterThan(GARBAGE_HIGH)
      // Same game, a death that is not that dive (16 s after the inhibitor): garbage time, dropped as before.
      const other = run(dive({ frame: lead(2000), deathAt: INHIB + 16_000 }))
      expect(other.moments).toEqual([])
      expect(other.garbageDiscarded).toBeGreaterThan(0)
      // A game already lost stays out, whatever the pattern.
      const lost = run(dive({ frame: lead(-2000) }))
      expect(lost.winProb[30]).toBeLessThan(GARBAGE_LOW)
      expect(lost.moments.map((x) => x.facts.pattern)).not.toContain(P_)
      expect(lost.garbageDiscarded).toBeGreaterThan(0)
    })
    it('the jungler away during the Baron buff', () => {
      const t0 = at(26)
      const forward: FrameFn = (i, pid) => ({ ...([1, 3, 4].includes(pid) && (i === 26 || i === 27) ? { position: FORWARD } : {}), ...(lead(2000)(i, pid) ?? {}) })
      const g = buildGame({ minutes: 32, me: 2, frame: forward, events: [
        { type: 'ELITE_MONSTER_KILL', timestamp: at(25), monsterType: 'BARON_NASHOR', killerTeamId: 100, killerId: 2, position: BARON_PIT },
        buy(t0 - 10_000, 2), kill(t0, 1, 8, [9], FORWARD), kill(t0 + 5_000, 3, 8, [9], FORWARD),
      ] })
      expect(withPattern(g, 'jungle-baron-recall')!.winProbBefore!).toBeGreaterThan(GARBAGE_HIGH)
    })
  })
})
