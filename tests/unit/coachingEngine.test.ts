import { describe, it, expect } from 'vitest'
import { buildPlayerContext, type MistakeRecord } from '../../electron/main/assistant/features'
import {
  diagnose,
  impactOf,
  noisyOr,
  persistenceFactor,
  pickFocus,
  REPEAT_FACTOR,
  MAX_CONFIDENCE,
} from '../../electron/main/assistant/diagnosis'
import { PROBLEMS, problemForRule, problemForTag, problemById } from '../../electron/main/assistant/problems'
import { buildInsights } from '../../electron/main/assistant/report'
import { evaluateRules, RULES } from '../../electron/main/assistant/rules'
import { getAllFundamentals } from '../../src/lib/constants/fundamentals'
import { NOW, games, session } from './assistantFixtures'

const HOUR = 3600_000
const ctxOf = (gs: ReturnType<typeof games>) => buildPlayerContext({ games: gs, sessions: [session()], now: NOW })
const mistake = (slug: string, i: number): MistakeRecord => ({ id: `m-${slug}-${i}`, tagSlug: slug, tagLabel: slug, gameTimeSec: 600 })

describe('problem taxonomy', () => {
  it('maps every rule and never maps a rule or a tag twice', () => {
    const rules = PROBLEMS.flatMap((p) => p.rules)
    const tags = PROBLEMS.flatMap((p) => p.mistakeTags)
    expect(new Set(rules).size).toBe(rules.length)
    expect(new Set(tags).size).toBe(tags.length)
    // Mistake rules are routed by tag; every other rule belongs to a problem.
    for (const r of RULES) {
      if (r.id === 'recurring_mistake' || r.id === 'dominant_mistake') continue
      expect(rules, r.id).toContain(r.id)
    }
  })

  it('only points to fundamentals that exist', () => {
    const ids = new Set(getAllFundamentals().map((f) => f.id))
    for (const p of PROBLEMS) if (p.fundamentalId) expect(ids.has(p.fundamentalId), `${p.id} → ${p.fundamentalId}`).toBe(true)
  })

  it('routes mistake rules by the tag they matched, unknown tags to the catch-all', () => {
    expect(problemForTag('cs-deficit').id).toBe('farming')
    expect(problemForRule('recurring_mistake', 'caught-out').id).toBe('map-awareness')
    expect(problemForTag('brand-new-tag').id).toBe('other-mistakes')
    expect(problemById('laning')?.fundamentalId).toBe('trades')
  })
})

describe('scoring primitives', () => {
  it('noisy-OR reinforces concordant evidence and is capped', () => {
    expect(noisyOr([])).toBe(0)
    expect(noisyOr([0.6])).toBeCloseTo(0.6)
    expect(noisyOr([0.6, 0.5])).toBeCloseTo(0.8)
    expect(noisyOr([0.9, 0.9, 0.9])).toBe(MAX_CONFIDENCE)
  })

  it('persistence factor is 1 at 60 % and stays in a narrow band', () => {
    expect(persistenceFactor(0.6)).toBeCloseTo(1)
    expect(persistenceFactor(0)).toBeCloseTo(0.85)
    expect(persistenceFactor(1)).toBeCloseTo(1.1)
  })

  it('impact uses the personal win driver when available, the role prior otherwise', () => {
    const farming = problemById('farming')!
    expect(impactOf(farming, 'support', null)).toBe(0.7)
    expect(impactOf(farming, 'laner', null)).toBe(1.15)
    const drivers = { games: 20, drivers: [{ metric: 'csPerMin' as const, objectiveId: 'csing_pathing', coefficient: 1, importance: 0.4, direction: 'higher' as const }] }
    expect(impactOf(farming, 'support', drivers)).toBeCloseTo(1.6)
  })
})

describe('diagnosis', () => {
  // Early deaths in every game + a weak lane → two rules, one "laning" problem.
  const laningGames = () => games(8, () => ({ deathTimesSec: [200, 450, 1300], lane: { grade: 'D', numericScore: 28 }, deaths: 6 }))

  it('merges rules about the same problem into one diagnosis with combined confidence', () => {
    const ctx = ctxOf(laningGames())
    const matches = evaluateRules(RULES, ctx, { moment: 'session' })
    const ids = matches.map((m) => m.rule.id)
    expect(ids).toEqual(expect.arrayContaining(['early_deaths_pattern', 'lane_weak_pattern']))
    const d = diagnose(matches, ctx, { moment: 'session' })
    const laning = d.filter((x) => x.problem.id === 'laning')
    expect(laning).toHaveLength(1)
    expect(laning[0].support.length).toBeGreaterThanOrEqual(1)
    expect(laning[0].confidence).toBeGreaterThan(laning[0].lead.match.rule.confidence)
  })

  it('one insight per problem, the focus gets an objective and the support count', () => {
    const insights = buildInsights(ctxOf(laningGames()), { moment: 'session', drivers: null })
    const problems = insights.map((i) => i.problemId)
    expect(new Set(problems).size).toBe(problems.length)
    const focus = insights.filter((i) => i.focus)
    expect(focus).toHaveLength(1)
    expect(focus[0].problemId).toBe('laning')
    expect(focus[0].support).toBeGreaterThanOrEqual(1)
    expect(focus[0].action).not.toBeNull()
  })

  it('wellbeing guards outrank everything', () => {
    // 3 losses in a row, 2 h+ of play in the active session, plus early deaths.
    const gs = games(6, (i) => ({ win: false, ago: 0.4 * (i + 1), sessionId: 'live', deathTimesSec: [200, 450] }))
    const ctx = buildPlayerContext({ games: gs, sessions: [session({ id: 'live', status: 'active', date: NOW - 3 * HOUR })], now: NOW })
    const insights = buildInsights(ctx, { moment: 'session', drivers: null })
    expect(insights[0].ruleId).toBe('tilt_break')
    expect(insights.find((i) => i.focus)?.ruleId).not.toBe('tilt_break')
  })

  it('demotes advice repeated on 3+ previous days without new games', () => {
    const ctx = ctxOf(laningGames())
    const matches = evaluateRules(RULES, ctx, { moment: 'session' })
    const fresh = diagnose(matches, ctx, { moment: 'session' }).find((d) => d.problem.id === 'laning')!
    const history = { laning: { priorDays: 3, lastShownAt: NOW } } // shown after the newest game
    const stale = diagnose(matches, ctx, { moment: 'session', history }).find((d) => d.problem.id === 'laning')!
    expect(stale.repeated).toBe(true)
    expect(stale.score).toBeCloseTo(fresh.score * REPEAT_FACTOR)
    // A newer game is new evidence: no demotion.
    const older = { laning: { priorDays: 5, lastShownAt: NOW - 100 * HOUR } }
    expect(diagnose(matches, ctx, { moment: 'session', history: older }).find((d) => d.problem.id === 'laning')!.repeated).toBe(false)
    // Post-game is always about a new game.
    const pg = evaluateRules(RULES, ctx, { moment: 'post_game', gameId: ctx.games[0].gameId })
    expect(diagnose(pg, ctx, { moment: 'post_game', history }).every((d) => !d.repeated)).toBe(true)
  })

  it('AS2 / MX4: a tag in 4+ of the last 10 games becomes the objective of its problem', () => {
    const gs = games(10, (i) => ({ mistakes: i % 2 === 0 ? [mistake('unused-gold', i)] : [] }))
    const ctx = ctxOf(gs)
    const insights = buildInsights(ctx, { moment: 'weekly', drivers: null, limit: 6 })
    const gold = insights.find((i) => i.problemId === 'gold-management')
    expect(gold).toBeDefined()
    expect(['dominant_mistake', 'recurring_mistake']).toContain(gold!.ruleId)
    const d = diagnose(evaluateRules(RULES, ctx, { moment: 'weekly' }), ctx, { moment: 'weekly' })
    const goldDiag = d.find((x) => x.problem.id === 'gold-management')!
    expect([goldDiag.lead, ...goldDiag.support].map((s) => s.match.rule.id)).toEqual(expect.arrayContaining(['dominant_mistake', 'recurring_mistake']))
    // The dominant-mistake rule resolves to the problem's fundamental.
    const dom = buildInsights(ctx, { moment: 'weekly', drivers: null, rules: RULES.filter((r) => r.id === 'dominant_mistake') })
    expect(dom[0].action).toEqual({ type: 'objective', objectiveId: 'recall_timing' })
  })

  it('pickFocus skips habits and positives', () => {
    expect(pickFocus([])).toBeNull()
    const gs = games(8, (i) => ({ reviewed: i > 5, win: true }))
    const insights = buildInsights(ctxOf(gs), { moment: 'session', drivers: null, limit: 5 })
    for (const i of insights.filter((x) => x.focus)) expect(['review-habit', 'momentum', 'self-assessment', 'tilt-fatigue']).not.toContain(i.problemId)
  })
})
