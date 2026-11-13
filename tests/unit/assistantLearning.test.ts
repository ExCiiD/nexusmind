import { describe, it, expect } from 'vitest'
import {
  MAX_MULTIPLIER, MIN_MULTIPLIER, posteriorMean, ruleMultiplier, sampleBeta, seededRng, tallyVotes,
} from '../../electron/main/assistant/weights'
import { fitLogistic, predict, rankWinDrivers, sigmoid } from '../../electron/main/assistant/regression'
import { buildPlayerContext, computeGameFeatures } from '../../electron/main/assistant/features'
import { buildInsights } from '../../electron/main/assistant/report'
import { NOW, game, games, session } from './assistantFixtures'

describe('rule weights (Beta prior + Thompson sampling)', () => {
  it('seeded RNG is deterministic and uniform-ish', () => {
    const a = seededRng('player:2026-11-13')
    const b = seededRng('player:2026-11-13')
    const xs = Array.from({ length: 2000 }, () => a())
    expect(xs.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b()))
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(xs.reduce((s, x) => s + x, 0) / xs.length).toBeCloseTo(0.5, 1)
  })

  it('Beta samples have the right mean', () => {
    const rng = seededRng('beta')
    const xs = Array.from({ length: 4000 }, () => sampleBeta(8, 2, rng))
    expect(xs.reduce((s, x) => s + x, 0) / xs.length).toBeCloseTo(0.8, 1)
    // α < 1 branch
    const ys = Array.from({ length: 2000 }, () => sampleBeta(0.5, 0.5, rng))
    expect(ys.every((y) => y >= 0 && y <= 1)).toBe(true)
  })

  it('posterior mean moves with votes, multiplier stays bounded', () => {
    expect(posteriorMean(undefined)).toBe(0.5)
    expect(ruleMultiplier(undefined)).toBeCloseTo(1)
    expect(posteriorMean({ up: 6, down: 0 })).toBeCloseTo(0.8)
    expect(ruleMultiplier({ up: 100, down: 0 })).toBeLessThanOrEqual(MAX_MULTIPLIER)
    expect(ruleMultiplier({ up: 0, down: 100 })).toBeGreaterThanOrEqual(MIN_MULTIPLIER)
    expect(ruleMultiplier({ up: 0, down: 10 })).toBeLessThan(ruleMultiplier({ up: 10, down: 0 }))
  })

  it('tallies raw votes per rule', () => {
    expect(tallyVotes([
      { ruleId: 'a', vote: 1 }, { ruleId: 'a', vote: 1 }, { ruleId: 'a', vote: -1 }, { ruleId: 'b', vote: -1 },
    ])).toEqual({ a: { up: 2, down: 1 }, b: { up: 0, down: 1 } })
  })

  it('feedback re-orders two rules of similar priority', () => {
    // win_streak (45 × 0.8) and pg_lane_strong (50 × 0.75) score almost the same.
    const gs = games(10, (i) => ({ win: i < 3, lane: i === 0 ? { grade: 'A+', numericScore: 80 } : null }))
    const ctx = buildPlayerContext({ games: gs, sessions: [session()], now: NOW })
    const order = (votesByRule: Record<string, { up: number; down: number }>) =>
      buildInsights(ctx, { moment: 'post_game', gameId: gs[0].id, seed: 's', votesByRule, limit: 10 }).map((i) => i.ruleId)
    const likesStreak = order({ win_streak: { up: 12, down: 0 }, pg_lane_strong: { up: 0, down: 12 } })
    const likesLane = order({ win_streak: { up: 0, down: 12 }, pg_lane_strong: { up: 12, down: 0 } })
    expect(likesStreak.indexOf('win_streak')).toBeLessThan(likesStreak.indexOf('pg_lane_strong'))
    expect(likesLane.indexOf('pg_lane_strong')).toBeLessThan(likesLane.indexOf('win_streak'))
  })

  it('a wellbeing rule (fixedWeight) is not re-weighted by 👎', () => {
    const gs = games(4, (i) => ({ ago: 0.2 + i * 0.7, sessionId: 'live', win: false }))
    const ctx = buildPlayerContext({ games: gs, sessions: [session({ id: 'live', status: 'active' })], now: NOW })
    const ins = buildInsights(ctx, { moment: 'session', seed: 's', votesByRule: { tilt_break: { up: 0, down: 3 } } })
    expect(ins.map((i) => i.ruleId)).toContain('tilt_break')
  })
})

describe('local logistic regression', () => {
  it('sigmoid is stable at the extremes', () => {
    expect(sigmoid(0)).toBe(0.5)
    expect(sigmoid(1000)).toBe(1)
    expect(sigmoid(-1000)).toBe(0)
  })

  it('learns a separable relationship', () => {
    const X = Array.from({ length: 40 }, (_, i) => [i < 20 ? -1 - (i % 3) * 0.1 : 1 + (i % 3) * 0.1, (i * 7) % 5 - 2])
    const y = X.map((x) => (x[0] > 0 ? 1 : 0))
    const m = fitLogistic(X, y, { l2: 0.01, iterations: 1500 })
    expect(m.weights[0]).toBeGreaterThan(1)
    expect(Math.abs(m.weights[1])).toBeLessThan(Math.abs(m.weights[0]) / 3)
    expect(predict(m, [1, 0])).toBeGreaterThan(0.8)
    expect(predict(m, [-1, 0])).toBeLessThan(0.2)
  })

  it('ranks the fundamental that actually drives this player wins first', () => {
    // Wins come with low deaths; CS is noise.
    const gs = Array.from({ length: 30 }, (_, i) => {
      const win = i % 3 !== 0
      return computeGameFeatures(game({
        ago: i + 1,
        win,
        deaths: win ? 2 + (i % 2) : 8 + (i % 3),
        cs: 200 + ((i * 37) % 50),
        visionScore: 20 + ((i * 11) % 10),
      }))
    })
    const r = rankWinDrivers(gs)!
    expect(r.games).toBe(30)
    expect(r.drivers[0]).toMatchObject({ metric: 'deaths', direction: 'lower', objectiveId: 'tempo' })
    expect(r.drivers.reduce((s, d) => s + d.importance, 0)).toBeCloseTo(1)
  })

  it('refuses to rank with too few games or a one-sided record', () => {
    expect(rankWinDrivers(games(10).map(computeGameFeatures))).toBeNull()
    expect(rankWinDrivers(games(20, () => ({ win: true })).map(computeGameFeatures))).toBeNull()
  })
})

describe('feedback is monotone in the report', () => {
  it('a 👍 never lowers an insight score, a 👎 never raises it', () => {
    const gs = games(5, (i) => ({ deathTimesSec: i < 3 ? [100, 400] : [1500] }))
    const ctx = buildPlayerContext({ games: gs, sessions: [session()], now: NOW })
    const score = (up: number, down: number) =>
      buildInsights(ctx, { moment: 'session', votesByRule: { early_deaths_pattern: { up, down } } })
        .find((i) => i.ruleId === 'early_deaths_pattern')!.score
    const neutral = score(0, 0)
    expect(score(1, 0)).toBeGreaterThan(neutral)
    expect(score(0, 1)).toBeLessThan(neutral)
    expect(score(5, 0)).toBeGreaterThan(score(1, 0))
  })
})
