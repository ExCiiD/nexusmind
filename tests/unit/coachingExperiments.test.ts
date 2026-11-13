import { describe, it, expect } from 'vitest'
import { buildPlayerContext, type MistakeRecord } from '../../electron/main/assistant/features'
import {
  baselineFor,
  criterionForProblem,
  evaluateCriterion,
  evaluateExperiment,
  graduatedFundamentals,
  outcomeVotes,
  problemForObjective,
  problemOutcomes,
  MASTERED_FACTOR,
  type ExperimentInput,
  type FinishedExperiment,
} from '../../electron/main/assistant/experiments'
import { diagnose } from '../../electron/main/assistant/diagnosis'
import { problemById } from '../../electron/main/assistant/problems'
import { buildInsights, neighbourObjective } from '../../electron/main/assistant/report'
import { evaluateRules, type Rule } from '../../electron/main/assistant/rules'
import { NOW, games, session } from './assistantFixtures'

const HOUR = 3600_000
const DAY = 24 * HOUR
const ctxOf = (gs: ReturnType<typeof games>) => buildPlayerContext({ games: gs, sessions: [session()], now: NOW })
const mistake = (slug: string): MistakeRecord => ({ id: `m-${slug}-${Math.random()}`, tagSlug: slug, tagLabel: 'Unused gold', gameTimeSec: 700 })

/** Games after `startedAt` (newest first): i-th game has `deaths` deaths. */
function after(deaths: number[], startedAt: number) {
  return games(deaths.length, (i) => ({ deaths: deaths[i], ago: (NOW - startedAt) / HOUR - (deaths.length - i) * 0.5 }))
}

const exp = (over: Partial<ExperimentInput> = {}): ExperimentInput => ({
  problemId: 'deaths',
  criterion: { kind: 'metric', metric: 'deaths', op: '<=', target: 4 },
  baseline: { mean: 7, games: 10 },
  windowGames: 5,
  startedAt: NOW - 10 * HOUR,
  ...over,
})

describe('criteria', () => {
  it('builds a reachable criterion from the player baseline', () => {
    const ctx = ctxOf(games(10, () => ({ deaths: 7, cs: 180 }))) // 6 CS/min
    expect(criterionForProblem(problemById('deaths')!, ctx)).toEqual({ kind: 'metric', metric: 'deaths', op: '<=', target: 6 })
    expect(criterionForProblem(problemById('farming')!, ctx)).toEqual({ kind: 'metric', metric: 'csPerMin', op: '>=', target: 6.5 })
    expect(criterionForProblem(problemById('laning')!, ctx)).toMatchObject({ metric: 'deathsBefore14', target: 1 })
    expect(criterionForProblem(problemById('gold-management')!, ctx)).toEqual({ kind: 'noMistake', tags: ['unused-gold', 'late-back'] })
    expect(criterionForProblem(problemById('gold-management')!, ctx, 'unused-gold', 'Unused gold')).toEqual({ kind: 'noMistake', tags: ['unused-gold'], label: 'Unused gold' })
  })

  it('has nothing measurable for habits, or farming as a support', () => {
    const support = ctxOf(games(6, () => ({ role: 'UTILITY' })))
    expect(criterionForProblem(problemById('farming')!, support)).toBeNull()
    expect(criterionForProblem(problemById('tilt-fatigue')!, support)).toBeNull()
    expect(criterionForProblem(problemById('review-habit')!, support)).toBeNull()
  })

  it('maps a session objective to its problem', () => {
    expect(problemForObjective('csing_pathing')?.id).toBe('farming')
    expect(problemForObjective('resilience')).toBeNull() // wellbeing: no experiment
    expect(problemForObjective('nope')).toBeNull()
  })

  it('skips games without data; a game without parsed timeline is not "clean"', () => {
    const [g] = ctxOf(games(1, () => ({ deathTimesSec: null, mistakes: [] }))).games
    expect(evaluateCriterion({ kind: 'noMistake', tags: ['unused-gold'] }, g)).toBeNull()
    expect(evaluateCriterion({ kind: 'metric', metric: 'deathsBefore14', op: '<=', target: 1 }, g)).toBeNull()
    const [h] = ctxOf(games(1, () => ({ mistakes: [mistake('unused-gold')] }))).games
    expect(evaluateCriterion({ kind: 'noMistake', tags: ['unused-gold'] }, h)).toEqual({ passed: false, value: 1 })
  })

  it('baseline = mean of the metric, or share of games with the tag', () => {
    const gs = ctxOf(games(4, (i) => ({ deaths: 4 + i, mistakes: i < 1 ? [mistake('unused-gold')] : [] }))).games
    expect(baselineFor({ kind: 'metric', metric: 'deaths', op: '<=', target: 4 }, gs)).toEqual({ mean: 5.5, games: 4 })
    expect(baselineFor({ kind: 'noMistake', tags: ['unused-gold'] }, gs)).toEqual({ rate: 0.25, games: 4 })
  })
})

describe('verdicts', () => {
  const ctxWith = (deaths: number[]) => ctxOf(after(deaths, NOW - 10 * HOUR)).games

  it('counts only games after the start, oldest first, up to the window', () => {
    const before = games(3, (i) => ({ deaths: 0, ago: 20 + i }))
    const p = evaluateExperiment(exp(), ctxOf([...after([9, 9], NOW - 10 * HOUR), ...before]).games)
    expect(p.counted).toBe(2)
    expect(p.done).toBe(false)
    expect(p.verdict).toBeNull()
  })

  it('acquired when the criterion holds in ≥ 70 % of the games', () => {
    const p = evaluateExperiment(exp(), ctxWith([2, 3, 4, 9, 4]))
    expect(p).toMatchObject({ done: true, counted: 5, passes: 4, passRate: 0.8, verdict: 'acquired' })
  })

  it('progressing when clearly better than the baseline but not consistent', () => {
    // baseline 7, target 4 → half-way 5.5; mean 5.4, passes 2/5
    expect(evaluateExperiment(exp(), ctxWith([4, 4, 6, 6, 7])).verdict).toBe('progressing')
  })

  it('no effect otherwise', () => {
    expect(evaluateExperiment(exp(), ctxWith([8, 7, 9, 3, 7])).verdict).toBe('no_effect')
  })

  it('tag experiments: progressing when the tag shows up 30 % less often', () => {
    const gs = ctxOf(games(5, (i) => ({ ago: 1 + i, mistakes: i < 2 ? [mistake('unused-gold')] : [] }))).games
    const base = exp({ criterion: { kind: 'noMistake', tags: ['unused-gold'] }, baseline: { rate: 0.8, games: 10 } })
    expect(evaluateExperiment(base, gs).verdict).toBe('progressing') // 3/5 clean, fail rate 0.4 ≤ 0.56
    expect(evaluateExperiment({ ...base, baseline: { rate: 0.5, games: 10 } }, gs).verdict).toBe('no_effect')
  })
})

describe('outcomes', () => {
  const f = (verdict: FinishedExperiment['verdict'], daysAgo: number, over: Partial<FinishedExperiment> = {}): FinishedExperiment =>
    ({ problemId: 'farming', fundamentalId: 'csing_pathing', ruleId: 'cs10_low', verdict, endedAt: NOW - daysAgo * DAY, ...over })

  it('mastered = recent acquired verdict; stuck = two no-effect in a row', () => {
    expect(problemOutcomes([f('acquired', 2)], NOW).farming).toEqual({ mastered: true, stuck: false })
    expect(problemOutcomes([f('acquired', 30)], NOW).farming.mastered).toBe(false)
    expect(problemOutcomes([f('no_effect', 1), f('no_effect', 5)], NOW).farming.stuck).toBe(true)
    expect(problemOutcomes([f('no_effect', 1), f('progressing', 5)], NOW).farming.stuck).toBe(false)
  })

  it('graduated after two acquired in a row on the same fundamental', () => {
    expect(graduatedFundamentals([f('acquired', 1), f('acquired', 9)])).toEqual(['csing_pathing'])
    expect(graduatedFundamentals([f('acquired', 1), f('no_effect', 9)])).toEqual([])
    expect(graduatedFundamentals([f('no_effect', 1), f('acquired', 5), f('acquired', 9)])).toEqual([])
  })

  it('verdicts become votes on the prescribing rule', () => {
    const v = outcomeVotes([f('acquired', 1), f('progressing', 3), f('no_effect', 5), f('acquired', 6, { ruleId: null })], { cs10_low: { up: 1, down: 0 } })
    expect(v.cs10_low).toEqual({ up: 4, down: 1 })
  })

  it('a mastered problem steps aside; a stuck focus suggests another angle', () => {
    // A farming rule that fires on these games (low CS/min in 3 of the last 5).
    const rule: Rule = {
      id: 'cs10_low', moments: ['session'], tone: 'warning', priority: 60, confidence: 0.7,
      when: [{ kind: 'count', metric: 'csPerMin', op: '<', value: 6, atLeast: 3, of: 5 }],
      variants: 2, why: { key: 'lastGames' },
    }
    const ctx = ctxOf(games(8, () => ({ cs: 150 }))) // 5 CS/min, mid laner
    const matches = evaluateRules([rule], ctx, { moment: 'session' })
    const base = diagnose(matches, ctx, { moment: 'session' })[0]
    const mastered = diagnose(matches, ctx, { moment: 'session', outcomes: { farming: { mastered: true, stuck: false } } })[0]
    expect(mastered.mastered).toBe(true)
    expect(mastered.score).toBeCloseTo(base.score * MASTERED_FACTOR)

    const [plain] = buildInsights(ctx, { moment: 'session', drivers: null, rules: [rule] })
    expect(plain).toMatchObject({ focus: true, canExperiment: true, action: { type: 'objective', objectiveId: 'csing_pathing' } })
    const [stuck] = buildInsights(ctx, { moment: 'session', drivers: null, rules: [rule], outcomes: { farming: { mastered: false, stuck: true } } })
    expect(stuck.action).toEqual({ type: 'objective', objectiveId: neighbourObjective('csing_pathing') })
    expect(neighbourObjective('csing_pathing')).not.toBe('csing_pathing')
  })
})
