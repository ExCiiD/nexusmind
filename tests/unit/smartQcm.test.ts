import { describe, it, expect } from 'vitest'
import { buildQcm, contextsOf, choiceStats, promotedTag, countsAgainstPlayer, optionsFor, LOW_ENERGY_TAG, CODEX_TEMPO, CODEX_JUNGLE_CYCLE, CODEX_JUNGLE_INVADE, CODEX_OBJ_SETUP, CODEX_131, CODEX_BARON, type PastAnswer } from '../../src/lib/microReview/smartQcm'
import { codexById } from '../../src/lib/microReview/codex'
import { ruleFor } from '../../src/lib/microReview/objectiveVerification'
import {
  CODEX_TEMPO_LINES, CODEX_WAVE_SIDE, CODEX_SINGLE_THREAT, CODEX_TEMPO_WINDOW, CODEX_SLOW_FAST, CODEX_TRACKING, CODEX_TRADING, CODEX_FIGHTS,
  CODEX_3_TEMPOS, CODEX_ASYMMETRY, CODEX_CHOKEPOINT, CODEX_ARCHETYPES, CODEX_ROAM_CHECK, CODEX_LOW_ENERGY, ecoDeficit, type QcmContext,
} from '../../src/lib/microReview/smartQcm'

const ALL_CONTEXTS: QcmContext[] = ['objective', 'gold', 'isolated', 'duel', 'teamfight', 'absent', 'early-cs', 'early-xp', 'hesitation', 'jungle-cycle',
  'jungle-passive', 'rotation', 'baron-siege', 'tempo-recall', 'tempo-front', 'gank-timer', 'carry-first', 'jungle-window', 'bad-rotation', 'duel-early', 'outnumbered',
  'chokepoint', 'mid-roam', 'eco-tempo', 'side-overextend', 'early-3v3', 'low-energy']
import type { CriticalMoment, MomentFacts } from '../../src/lib/microReview/anomalyDetector'
import { tagFamily } from '../../src/lib/mistakeInsights'

const moment = (facts: MomentFacts, trigger: CriticalMoment['trigger'] = 'critical-death'): CriticalMoment => ({
  key: `${trigger}@1528`, trigger, gameTimeSec: 1528, severity: 0.3,
  position: { x: 5600, y: 10000 }, zone: 'top-river', lane: 'JUNGLE', territory: 'enemy',
  winProbBefore: 0.52, winProbAfter: 0.38, facts,
})

describe('contextsOf', () => {
  it('reads an objective death with gold in pocket as two contexts', () => {
    expect(contextsOf(moment({ nearObjective: true, objectiveLost: 'baron', goldInPocket: 1650, alliesNearby: 0, enemiesInvolved: 3 })))
      .toEqual(['objective', 'gold', 'isolated'])
  })
  it('separates duel, isolated and teamfight by allies / enemies', () => {
    expect(contextsOf(moment({ alliesNearby: 0, enemiesInvolved: 1 }))).toEqual(['duel'])
    expect(contextsOf(moment({ alliesNearby: 0, enemiesInvolved: 2 }))).toEqual(['isolated'])
    expect(contextsOf(moment({ alliesNearby: 2, enemiesInvolved: 3 }))).toEqual(['teamfight'])
  })
  it('treats a death right after the player\'s own play as a gold/overstay read', () => {
    expect(contextsOf(moment({ secondsSinceOwnPlay: 12, alliesNearby: 1, enemiesInvolved: 2 }))).toEqual(['gold', 'teamfight'])
  })
  it('does not call a lost tower an "objective" fight', () => {
    expect(contextsOf(moment({ nearObjective: true, objectiveLost: 'tower', alliesNearby: 0, enemiesInvolved: 1 }))).toEqual(['duel'])
  })
  it('maps the other triggers', () => {
    expect(contextsOf(moment({ objective: 'dragon' }, 'absent-objective'))).toEqual(['absent'])
    expect(contextsOf(moment({ csDiff10: -22, xpDiff10: -500 }, 'early-deficit'))).toEqual(['early-cs', 'early-xp'])
  })
})

describe('buildQcm', () => {
  it('gives 3 options — the best guess of the two first contexts, then the justified way out — with a factual summary', () => {
    const card = buildQcm(moment({ nearObjective: true, objectiveLost: 'baron', objectiveLostAfterSec: 30, goldInPocket: 1650, alliesNearby: 1, enemiesInvolved: 3, wardedLast60s: false }))
    expect(card.contexts).toEqual(['objective', 'gold', 'teamfight'])
    expect(card.options.map((o) => o.id)).toEqual(['no-ward-pre-obj', 'overstay', 'justified:stealAttempt'])
    expect(card.summary.head).toEqual({ key: 'deathObjective', params: { sec: 30, objective: 'baron' } })
    expect(card.summary.extras[0]).toEqual({ key: 'gold', params: { gold: 1650 } })
    expect(card.summary.extras).toHaveLength(2)
  })

  it('always keeps a justified way out when one of the contexts has one — a second context never crowds it out', () => {
    const card = buildQcm(moment({ nearObjective: true, objectiveLost: 'dragon', alliesNearby: 2, enemiesInvolved: 2, goldInPocket: 200 }))
    expect(card.contexts).toEqual(['objective', 'teamfight'])
    expect(card.options.map((o) => o.id)).toEqual(['no-ward-pre-obj', 'bad-positioning', 'justified:stealAttempt'])
    const isolated = buildQcm(moment({ alliesNearby: 0, enemiesInvolved: 3 }))
    expect(isolated.options.at(-1)).toMatchObject({ outcome: 'justified', tagSlug: null, reason: 'crossMapPressure' })
    // The way out comes from the first context that has one: "gold" has none, the teamfight does.
    const gold = buildQcm(moment({ goldInPocket: 1650, alliesNearby: 2, enemiesInvolved: 3 }))
    expect(gold.contexts).toEqual(['gold', 'teamfight'])
    expect(gold.options.map((o) => o.id)).toEqual(['overstay', 'bad-positioning', 'justified:goodEngage'])
    // No context with a way out (gold + 1v1): three diagnoses.
    const duel = buildQcm(moment({ goldInPocket: 1650, alliesNearby: 0, enemiesInvolved: 1 }))
    expect(duel.options.map((o) => o.outcome)).toEqual(['mistake', 'mistake', 'mistake'])
  })
  it('every justified way out of the matrix is reachable on some card', () => {
    const wanted = new Set(ALL_CONTEXTS.flatMap((c) => optionsFor(c)).filter((o) => o.outcome === 'justified').map((o) => o.id))
    const seen = new Set<string>()
    const see = (m: CriticalMoment) => { for (const o of buildQcm(m).options) seen.add(o.id) }
    for (const nearObjective of [false, true]) for (const objectiveLost of [null, 'baron', 'tower'] as const) for (const alliedBaron of [false, true])
      for (const hpPct of [undefined, 20]) for (const goldInPocket of [0, 1650]) for (const alliesNearby of [0, 1, 2]) for (const enemiesInvolved of [1, 2, 4])
        for (const gameTimeSec of [6 * 60, 16 * 60, 30 * 60]) for (const zone of ['mid-lane', 'top-lane', 'enemy-jungle'] as const) for (const territory of ['own', 'enemy'] as const) {
          see({ ...moment({ nearObjective, objectiveLost, alliedBaron, hpPct, goldInPocket, alliesNearby, enemiesInvolved }), gameTimeSec, zone, territory })
        }
    for (const pattern of ['tempo-hesitation', 'tempo-late-recall', 'pit-chokepoint'] as const) see(moment({ pattern, objective: 'dragon' }, 'absent-objective'))
    see(moment({ objective: 'dragon' }, 'absent-objective'))
    for (const pattern of ['jungle-overchase', 'jungle-passive-clear', 'jungle-window-unpunished', 'bad-rotation', 'mid-roam-plates'] as const) see(moment({ pattern }, 'early-deficit'))
    for (const pattern of ['tempo-front-isolated', 'fed-carry-first', 'pit-chokepoint'] as const) see(moment({ pattern }))
    expect([...wanted].filter((id) => !seen.has(id))).toEqual([])
  })
  it('every context offers at least two diagnoses, and at most one way out', () => {
    for (const c of ALL_CONTEXTS.filter((x) => x !== 'low-energy')) {
      const list = optionsFor(c)
      expect(list, c).toHaveLength(3)
      expect(list.filter((o) => o.outcome === 'mistake').length, c).toBeGreaterThanOrEqual(2)
      expect(list.slice(0, 2).every((o) => o.outcome === 'mistake'), c).toBe(true)
      expect(new Set(list.map((o) => o.id)).size, c).toBe(3)
    }
  })

  it('only uses existing Mistake Library tags', () => {
    const known = new Set(['no-ward-pre-obj', 'bad-wave-sync', 'overstay', 'unused-gold', 'late-back', 'caught-out', 'forgot-trinket', 'bad-trade', 'bad-threat-assessment', 'bad-positioning', 'no-vision-objective', 'face-checked', 'cs-deficit', 'xp-deficit', 'bad-lane-opening', 'death-before-objective', 'wasted-summoner'])
    for (const c of ALL_CONTEXTS) {
      for (const o of [...optionsFor(c), ...optionsFor(c, { nearObjective: true })]) {
        if (o.tagSlug) {
          expect(known.has(o.tagSlug)).toBe(true)
          expect(['deaths', 'vision', 'tempo', 'mechanics']).toContain(tagFamily(o.tagSlug, ''))
        }
      }
    }
  })

  it('uses face-checked away from objectives and no-vision-objective near them', () => {
    expect(optionsFor('teamfight', { nearObjective: false })[1].tagSlug).toBe('face-checked')
    expect(optionsFor('teamfight', { nearObjective: true })[1].tagSlug).toBe('no-vision-objective')
  })

  it('summarises absent and early moments', () => {
    const absent = buildQcm(moment({ objective: 'dragon', playerDistance: 6420, wardsElsewhere: 0 }, 'absent-objective'))
    expect(absent.summary.head).toEqual({ key: 'absent', params: { objective: 'dragon' } })
    expect(absent.summary.extras).toEqual([{ key: 'distance', params: { distance: 6400 } }, { key: 'noWardAtAll' }])
    const early = buildQcm(moment({ csDiff10: -21, xpDiff10: -120, opponentChampion: 'Darius' }, 'early-deficit'))
    expect(early.summary.head).toEqual({ key: 'early', params: { opponent: 'Darius' } })
    expect(early.options[0].tagSlug).toBe('cs-deficit')
  })
})

describe('local learning', () => {
  const answers: PastAnswer[] = [
    { role: 'JUNGLE', champion: 'LeeSin', tagSlug: 'bad-positioning', viaOther: false },
    { role: 'JUNGLE', champion: 'LeeSin', tagSlug: 'bad-positioning', viaOther: false },
    { role: 'JUNGLE', champion: 'LeeSin', tagSlug: 'wasted-summoner', viaOther: true },
    { role: 'JUNGLE', champion: 'LeeSin', tagSlug: 'wasted-summoner', viaOther: true },
    { role: 'JUNGLE', champion: 'Viego', tagSlug: 'whiff-skillshot', viaOther: true },
    { role: 'MIDDLE', champion: 'LeeSin', tagSlug: 'bad-kiting', viaOther: true },
    { role: 'JUNGLE', champion: 'LeeSin', tagSlug: null, viaOther: false },
  ]

  it('counts choices per (role, champion) and per role', () => {
    const s = choiceStats(answers, 'JUNGLE', 'leesin')
    expect(s.champ['bad-positioning']).toEqual({ count: 2, viaOther: 0 })
    expect(s.champ['wasted-summoner']).toEqual({ count: 2, viaOther: 2 })
    expect(s.role['whiff-skillshot']).toEqual({ count: 1, viaOther: 1 })
    expect(s.champ['bad-kiting']).toBeUndefined()
  })

  it('promotes a tag picked twice through "Autre cause…" for this champion', () => {
    const s = choiceStats(answers, 'JUNGLE', 'LeeSin')
    expect(promotedTag(s, [])).toBe('wasted-summoner')
    expect(promotedTag(s, ['wasted-summoner'])).toBeNull()
    expect(promotedTag(choiceStats(answers.slice(0, 3), 'JUNGLE', 'LeeSin'), [])).toBeNull()
  })

  it('promotes on role-wide habit at 3 picks', () => {
    const role: PastAnswer[] = ['A', 'B', 'C'].map((c) => ({ role: 'TOP', champion: c, tagSlug: 'bad-kiting', viaOther: true }))
    expect(promotedTag(choiceStats(role, 'TOP', 'Z'), [])).toBe('bad-kiting')
  })

  it('reorders by habit and swaps in the promoted tag, keeping the justified option', () => {
    const s = choiceStats(answers, 'JUNGLE', 'LeeSin')
    const card = buildQcm(moment({ alliesNearby: 2, enemiesInvolved: 3 }), s)
    expect(card.options.map((o) => o.id)).toEqual(['bad-positioning', 'wasted-summoner', 'justified:goodEngage'])
    expect(card.options[1]).toMatchObject({ promoted: true, reason: 'habit', outcome: 'mistake' })
  })
})

describe('justified outcome', () => {
  it('never counts against the player', () => {
    expect(countsAgainstPlayer('justified')).toBe(false)
    expect(countsAgainstPlayer('mistake')).toBe(true)
    expect(countsAgainstPlayer('custom')).toBe(true)
  })
})

describe('Codex-linked diagnoses (qcmTrigger of each fiche)', () => {
  const first = (m: CriticalMoment) => buildQcm(m).options[0]

  it('tempo vs tower greed: missed cross-map / late recall → overstay', () => {
    const card = buildQcm(moment({ objective: 'dragon', pattern: 'tempo-hesitation', towerGreed: true }, 'absent-objective'))
    expect(card.options[0]).toMatchObject({ tagSlug: 'overstay', reason: 'tempoGreed', codexId: CODEX_TEMPO })
    expect(card.summary.head.key).toBe('towerGreed')
    expect(buildQcm(moment({ objective: 'baron', pattern: 'tempo-hesitation', approachedBy: 2100 }, 'absent-objective')).summary.head.key).toBe('hesitation')
  })
  it('objective setup: enemy dragon without setup → no-ward-pre-obj', () => {
    expect(first(moment({ objective: 'dragon' }, 'absent-objective'))).toMatchObject({ tagSlug: 'no-ward-pre-obj', reason: 'setupFail', codexId: CODEX_OBJ_SETUP })
    // The matrix row of a death near a lost objective: setup fiche, tempo fiche, justified steal.
    expect(optionsFor('objective').map((o) => o.codexId ?? o.id)).toEqual([CODEX_OBJ_SETUP, CODEX_TEMPO, 'justified:stealAttempt'])
    const death = buildQcm(moment({ nearObjective: true, objectiveLost: 'dragon', alliesNearby: 0, enemiesInvolved: 1 }))
    expect(death.contexts).toEqual(['objective', 'duel'])
    expect(death.options.map((o) => o.codexId ?? o.id)).toEqual([CODEX_OBJ_SETUP, 'bad-trade', 'justified:stealAttempt'])
  })
  it('hesitation: the second reading is the vision — unless the player did ward the pit', () => {
    const facts: MomentFacts = { objective: 'dragon', pattern: 'tempo-hesitation', approachedBy: 1500 }
    expect(buildQcm(moment(facts, 'absent-objective')).options.map((o) => o.id)).toEqual(['overstay', 'no-ward-pre-obj', 'justified:notContestable'])
    expect(buildQcm(moment({ ...facts, playerWarded: true }, 'absent-objective')).options.map((o) => [o.id, o.reason])).toEqual([
      ['overstay', 'tempoGreed'], ['bad-wave-sync', 'absentNoRotate'], ['justified:notContestable', 'notContestable']])
  })
  it('tempo line: one fiche, read from its two ends', () => {
    // In base while the team fights: recalled late / sat on the gold — never "alone at the front".
    const recall = buildQcm(moment({ pattern: 'tempo-late-recall', goldInPocket: 1600, alliesHigh: 3 }, 'absent-objective'))
    expect(recall.contexts).toEqual(['tempo-recall'])
    expect(recall.options.map((o) => [o.tagSlug, o.reason])).toEqual([['overstay', 'tempoLineDesync'], ['late-back', 'lateReset'], [null, 'tempoTradeOk']])
    // Dead alone ahead of the team: "alone on front tempo" is the second reading.
    const front = buildQcm(moment({ pattern: 'tempo-front-isolated', alliesHome: 3, alliesNearby: 0, enemiesInvolved: 2 }))
    expect(front.contexts).toEqual(['tempo-front'])
    expect(front.options.map((o) => [o.tagSlug, o.reason])).toEqual([['overstay', 'tempoLineDesync'], ['caught-out', 'frontAlone'], [null, 'crossMapPressure']])
    expect(front.options[0].codexId).toBe(CODEX_TEMPO_LINES)
  })
  it('jungle: broken cycle → overstay, passive clear → cs-deficit', () => {
    for (const pattern of ['jungle-overchase', 'jungle-counter-tempo'] as const) {
      expect(first(moment({ pattern }, 'early-deficit'))).toMatchObject({ tagSlug: 'overstay', reason: 'cycleBreak', codexId: CODEX_JUNGLE_CYCLE })
    }
    const passive = buildQcm(moment({ pattern: 'jungle-passive-clear', botGoldLead: 420, xpDiffJungle: -60 }, 'early-deficit'))
    expect(passive.options[0]).toMatchObject({ tagSlug: 'cs-deficit', reason: 'passiveClear', codexId: CODEX_JUNGLE_INVADE })
    expect(passive.summary).toMatchObject({ head: { key: 'passiveClear' }, extras: [{ key: 'botLead', params: { gold: 420 } }] })
  })
  it('mid game rotation death in the jungle → 1-3-1 assignment', () => {
    const m = { ...moment({ alliesNearby: 0, enemiesInvolved: 2 }), gameTimeSec: 18 * 60, zone: 'enemy-jungle' as const }
    expect(contextsOf(m)).toEqual(['rotation', 'isolated'])
    expect(first(m)).toMatchObject({ tagSlug: 'bad-positioning', reason: 'assignment131', codexId: CODEX_131 })
  })
  it('death under allied Baron → Baron siege', () => {
    const card = buildQcm(moment({ alliedBaron: true, alliesNearby: 1, enemiesInvolved: 3 }))
    expect(card.contexts[0]).toBe('baron-siege')
    expect(card.options[0]).toMatchObject({ tagSlug: 'bad-positioning', reason: 'baronSiege', codexId: CODEX_BARON })
    expect(card.summary.extras[0]).toEqual({ key: 'underBaron' })
  })
  it('keeps the Codex-linked option first and never swaps it out for a habit', () => {
    const habit: PastAnswer[] = [
      ...Array(4).fill({ role: 'JUNGLE', champion: 'Vi', tagSlug: 'cs-deficit', viaOther: false }),
      ...Array(2).fill({ role: 'JUNGLE', champion: 'Vi', tagSlug: 'whiff-skillshot', viaOther: true }),
    ]
    const card = buildQcm(moment({ pattern: 'jungle-overchase' }, 'early-deficit'), choiceStats(habit, 'JUNGLE', 'Vi'))
    expect(card.options.map((o) => o.id)).toEqual(['overstay', 'whiff-skillshot', 'justified:invadeWorth'])
  })
  it('every linked fiche exists and records one of its own tags', () => {
    for (const c of ALL_CONTEXTS) {
      for (const o of [...optionsFor(c), ...optionsFor(c, { secondsSinceOwnPlay: 10 })].filter((x) => x.codexId)) {
        const e = codexById(o.codexId!)
        expect(e, o.codexId).not.toBeNull()
        expect([e!.mistakeSlug, ...(e!.mistakeSlugs ?? [])]).toContain(o.tagSlug)
      }
    }
  })
})

describe('V3 fiches — qcmTrigger options', () => {
  const card = (facts: MomentFacts, trigger: CriticalMoment['trigger'] = 'critical-death', gameTimeSec = 1528) => buildQcm({ ...moment(facts, trigger), gameTimeSec })

  it.each([
    [{ pattern: 'tempo-late-recall', goldInPocket: 1600, alliesHigh: 4 }, 'absent-objective', 'overstay', 'tempoLineDesync', CODEX_TEMPO_LINES, 'tempoLateRecall'],
    [{ pattern: 'tempo-front-isolated', alliesHome: 3, alliesNearby: 0, enemiesInvolved: 2 }, 'critical-death', 'overstay', 'tempoLineDesync', CODEX_TEMPO_LINES, 'tempoFront'],
    [{ pattern: 'gank-timer', gankWindow: 2, deepWard: false }, 'critical-death', 'caught-out', 'gankTimer', CODEX_TRACKING, 'gankTimer2'],
    [{ pattern: 'fed-carry-first', goldSharePct: 31, killStreak: 4 }, 'critical-death', 'bad-positioning', 'singleThreat', CODEX_SINGLE_THREAT, 'fedCarryFirst'],
    [{ pattern: 'jungle-window-unpunished', playerDistance: 9100 }, 'early-deficit', 'cs-deficit', 'tempoWindowUnused', CODEX_TEMPO_WINDOW, 'tempoWindowUnpunished'],
    [{ pattern: 'bad-rotation', csLost: 10, xpLost: 400 }, 'early-deficit', 'cs-deficit', 'waveRotation', CODEX_SLOW_FAST, 'badRotation'],
  ] as const)('%o → choice [1] is the linked fiche', (facts, trigger, tag, reason, codexId, head) => {
    const c = card(facts as MomentFacts, trigger)
    expect(c.options[0]).toMatchObject({ tagSlug: tag, reason, codexId })
    expect(c.summary.head.key).toBe(head)
  })
  it('early 1v1 death → trading laws and wave side', () => {
    const c = card({ alliesNearby: 0, enemiesInvolved: 1 }, 'critical-death', 7 * 60)
    expect(c.contexts).toEqual(['duel-early'])
    expect(c.options.map((o) => o.codexId)).toEqual([CODEX_TRADING, CODEX_WAVE_SIDE, CODEX_ARCHETYPES])
    expect(c.options.map((o) => o.tagSlug)).toEqual(['bad-trade', 'bad-positioning', 'bad-threat-assessment'])
  })
  it('outnumbered skirmish before 25 min → choosing fights', () => {
    const c = card({ alliesNearby: 1, enemiesInvolved: 3 }, 'critical-death', 12 * 60)
    expect(c.contexts).toEqual(['outnumbered'])
    expect(c.options[0]).toMatchObject({ reason: 'badFightChoice', codexId: CODEX_FIGHTS })
  })
  it('death right after cashing a play → one tempo window used twice', () => {
    const c = card({ secondsSinceOwnPlay: 12, alliesNearby: 1, enemiesInvolved: 2 })
    expect(c.options[0]).toMatchObject({ tagSlug: 'overstay', reason: 'doubleSpend', codexId: CODEX_TEMPO_WINDOW })
  })
})

describe('V4 fiches — qcmTrigger options', () => {
  const at = (facts: MomentFacts, over: Partial<CriticalMoment> = {}, trigger: CriticalMoment['trigger'] = 'critical-death') => ({ ...moment(facts, trigger), ...over })

  it('choke point: support in the pit → bad-positioning with the choke-point fiche', () => {
    const c = buildQcm(at({ pattern: 'pit-chokepoint', nearestPit: 'baron', alliesDown: 3 }))
    expect(c.contexts).toEqual(['chokepoint'])
    expect(c.options[0]).toMatchObject({ tagSlug: 'bad-positioning', reason: 'chokePoint', codexId: CODEX_CHOKEPOINT })
    expect(c.options.at(-1)).toMatchObject({ outcome: 'justified', reason: 'pitRole' })
    expect(c.summary).toMatchObject({ head: { key: 'chokePoint', params: { objective: 'baron' } }, extras: [{ key: 'alliesDown', params: { count: 3 } }] })
    expect(buildQcm(at({ pattern: 'pit-chokepoint', nearestPit: 'dragon' }, {}, 'absent-objective')).summary.head.params).toEqual({ objective: 'dragon' })
  })
  it('losing mid roam → cs-deficit with the roam-check fiche', () => {
    const c = buildQcm(at({ pattern: 'mid-roam-plates', platesLost: 2, csLost: 14, roamSide: 'bot' }, {}, 'early-deficit'))
    expect(c.options[0]).toMatchObject({ tagSlug: 'cs-deficit', reason: 'roamCheck', codexId: CODEX_ROAM_CHECK })
    expect(c.summary).toMatchObject({ head: { key: 'midRoamBot' }, extras: [{ key: 'platesLost', params: { count: 2 } }, { key: 'csLost', params: { cs: 14 } }] })
    expect(buildQcm(at({ pattern: 'mid-roam-plates', roamSide: 'top' }, {}, 'early-deficit')).summary.head.key).toBe('midRoamTop')
  })
  it('real economic tempo: low HP, 2+ levels behind, or 1 level behind in a 1v1', () => {
    expect(ecoDeficit({ hpPct: 34 })).toBe(true)
    expect(ecoDeficit({ hpPct: 35 })).toBe(false)
    expect(ecoDeficit({ levelDeficit: 2, enemiesInvolved: 3 })).toBe(true)
    expect(ecoDeficit({ levelDeficit: 1, enemiesInvolved: 3 })).toBe(false)
    expect(ecoDeficit({ levelDeficit: 1, enemiesInvolved: 1 })).toBe(true)
    expect(ecoDeficit({})).toBe(false)
    const c = buildQcm(at({ hpPct: 22, hpSnapshotAgeSec: 40, levelDeficit: 2, alliesNearby: 1, enemiesInvolved: 2 }, { gameTimeSec: 20 * 60, zone: 'mid-lane' }))
    expect(c.contexts).toEqual(['eco-tempo', 'teamfight'])
    expect(c.options[0]).toMatchObject({ tagSlug: 'bad-positioning', reason: 'ecoTempo', codexId: CODEX_3_TEMPOS })
    expect(c.summary.extras).toEqual([{ key: 'hpBefore', params: { pct: 22, sec: 40 } }, { key: 'levelDeficit', params: { count: 2 } }])
  })
  it('side lane past the river after 15 min, alone → pressure asymmetry / mid priority', () => {
    const m = at({ alliesNearby: 0, enemiesInvolved: 2 }, { gameTimeSec: 19 * 60, zone: 'top-lane', territory: 'enemy' })
    expect(contextsOf(m)).toEqual(['side-overextend', 'isolated'])
    expect(buildQcm(m).options[0]).toMatchObject({ tagSlug: 'caught-out', reason: 'asymmetryMidPrio', codexId: CODEX_ASYMMETRY })
    // Before 15:00, on the player's own half, or with an ally: not this reading.
    expect(contextsOf({ ...m, gameTimeSec: 14 * 60 + 59 })).not.toContain('side-overextend')
    expect(contextsOf({ ...m, territory: 'own' })).not.toContain('side-overextend')
    expect(contextsOf(at({ alliesNearby: 1, enemiesInvolved: 2 }, { gameTimeSec: 19 * 60, zone: 'top-lane', territory: 'enemy' }))).not.toContain('side-overextend')
  })
  it('early death against 2+ enemies → the 3v3 half of the archetype fiche', () => {
    const c = buildQcm(at({ alliesNearby: 0, enemiesInvolved: 2 }, { gameTimeSec: 6 * 60, zone: 'mid-lane' }))
    expect(c.contexts).toEqual(['early-3v3'])
    expect(c.options[0]).toMatchObject({ tagSlug: 'bad-trade', reason: 'archetype3v3', codexId: CODEX_ARCHETYPES })
    // After the laning phase the same death is a plain "isolated" one.
    expect(contextsOf(at({ alliesNearby: 0, enemiesInvolved: 2 }, { gameTimeSec: 14 * 60, zone: 'mid-lane' }))).toEqual(['isolated'])
  })
  it('low-energy game: the protocol is choice [2] of every death, never of another trigger', () => {
    const death = at({ alliesNearby: 0, enemiesInvolved: 3 }, { gameTimeSec: 20 * 60, zone: 'mid-lane' })
    const plain = buildQcm(death)
    const low = buildQcm(death, undefined, { lowEnergy: true })
    expect(plain.options.some((o) => o.codexId === CODEX_LOW_ENERGY)).toBe(false)
    expect(low.options).toHaveLength(3)
    expect(low.options[0]).toEqual(plain.options[0])
    // 'caught-out' is already choice [1] ("isolated"): the protocol is another reading of the same tag, with its own id.
    expect(plain.options[0]).toMatchObject({ id: 'caught-out', reason: 'noMinimap' })
    expect(low.options[1]).toMatchObject({ id: 'caught-out#lowEnergy', tagSlug: 'caught-out', reason: 'lowEnergy', codexId: CODEX_LOW_ENERGY })
    expect(low.contexts[1]).toBe('low-energy')
    expect(new Set(low.options.map((o) => o.id)).size).toBe(3)
    // Keeps the justified way out, drops the plain mistake.
    expect(low.options[2]).toMatchObject({ outcome: 'justified' })
    const absent = buildQcm(at({ objective: 'dragon' }, {}, 'absent-objective'), undefined, { lowEnergy: true })
    expect(absent.options.some((o) => o.codexId === CODEX_LOW_ENERGY)).toBe(false)
  })
  it('low-energy game: on a card of three fiches, the protocol replaces the last one', () => {
    const duel = buildQcm(at({ alliesNearby: 0, enemiesInvolved: 1 }, { gameTimeSec: 7 * 60, zone: 'mid-lane' }), undefined, { lowEnergy: true })
    expect(duel.options.map((o) => o.tagSlug)).toEqual(['bad-trade', 'caught-out', 'bad-positioning'])
    expect(duel.options.map((o) => o.codexId)).toEqual([CODEX_TRADING, CODEX_LOW_ENERGY, CODEX_WAVE_SIDE])
  })
  it('low-energy game: the diagnosis always records the same tag, the one its session objective is checked against', () => {
    expect(LOW_ENERGY_TAG).toBe('caught-out')
    expect(ruleFor('resilience')).toMatchObject({ id: 'low-energy' })
    expect(ruleFor('resilience')!.tags).toContain(LOW_ENERGY_TAG)
    expect(codexById(CODEX_LOW_ENERGY)!.mistakeSlug).toBe(LOW_ENERGY_TAG)
    const shapes: Array<[MomentFacts, Partial<CriticalMoment>]> = [
      [{ alliesNearby: 0, enemiesInvolved: 1 }, { gameTimeSec: 7 * 60, zone: 'mid-lane' }], // three fiches, none on caught-out
      [{ alliesNearby: 0, enemiesInvolved: 3 }, { gameTimeSec: 20 * 60, zone: 'mid-lane' }], // caught-out already choice [1]
      [{ alliesNearby: 2, enemiesInvolved: 4 }, { gameTimeSec: 30 * 60 }],
      [{ alliesNearby: 0, enemiesInvolved: 2, hpPct: 20 }, { gameTimeSec: 19 * 60, zone: 'top-lane', territory: 'enemy' }], // eco-tempo + side-overextend + isolated
      [{ pattern: 'gank-timer', gankWindow: 1 }, { gameTimeSec: 150 }],
    ]
    for (const [facts, over] of shapes) {
      const plain = buildQcm(at(facts, over))
      const low = buildQcm(at(facts, over), undefined, { lowEnergy: true })
      expect(low.options[1]).toMatchObject({ id: 'caught-out#lowEnergy', tagSlug: LOW_ENERGY_TAG, codexId: CODEX_LOW_ENERGY })
      // Choice [1] and the justified way out (when there is one) are untouched.
      expect(low.options[0]).toEqual(plain.options[0])
      expect(low.options.filter((o) => o.outcome === 'justified')).toEqual(plain.options.filter((o) => o.outcome === 'justified'))
    }
  })
  it('never produces two options with the same id, and always 3 options on a death', () => {
    const shapes: MomentFacts[] = [
      { alliesNearby: 0, enemiesInvolved: 1 }, { alliesNearby: 0, enemiesInvolved: 3 }, { alliesNearby: 2, enemiesInvolved: 4 },
      { nearObjective: true, objectiveLost: 'baron', goldInPocket: 1650, alliesNearby: 0, enemiesInvolved: 2, hpPct: 20, levelDeficit: 2, secondsSinceOwnPlay: 10 },
      { alliedBaron: true, alliesNearby: 1, enemiesInvolved: 3 }, { pattern: 'gank-timer', gankWindow: 1 }, { pattern: 'fed-carry-first' }, { pattern: 'tempo-front-isolated' },
    ]
    for (const facts of shapes) for (const t of [5 * 60, 16 * 60, 30 * 60]) for (const lowEnergy of [false, true]) {
      const c = buildQcm(at(facts, { gameTimeSec: t }), undefined, { lowEnergy })
      expect(c.options).toHaveLength(3)
      expect(new Set(c.options.map((o) => o.id)).size).toBe(3)
    }
  })
})
