/**
 * Assistant rules added from the Nov. 2026 research (docs/moteur/RECHERCHE_CONNAISSANCES.md): time spent dead, control
 * wards, and role vision benchmarks. Each threshold is tested on both sides of its boundary.
 */
import { describe, it, expect } from 'vitest'
import { buildPlayerContext } from '../../electron/main/assistant/features'
import { evaluateRules, resolveParams, RULES, type Moment } from '../../electron/main/assistant/rules'
import { problemForRule } from '../../electron/main/assistant/problems'
import { buildInsights } from '../../electron/main/assistant/report'
import { NOW, game, games, session } from './assistantFixtures'

const NEW_RULES = ['dead_time_high', 'pg_dead_time_high', 'support_control_wards_low', 'control_wards_never', 'support_vision_benchmark', 'jungle_vision_benchmark',
  'two_loss_stop', 'movement_break', 'new_champion_learning']
const ctxOf = (gs: ReturnType<typeof games>) => buildPlayerContext({ games: gs, sessions: [session()], now: NOW })
const fired = (gs: ReturnType<typeof games>, moment: Moment, gameId?: string) => evaluateRules(RULES, ctxOf(gs), { moment, gameId }).map((m) => m.rule.id)
/** 30-minute games: a share of the game dead → seconds. */
const deadFor = (pct: number) => Math.round(1800 * pct / 100)

describe('research rules — definitions', () => {
  it('are registered once, mapped to their problem, and keep the rule-engine contract', () => {
    for (const id of NEW_RULES) {
      expect(RULES.filter((r) => r.id === id), id).toHaveLength(1)
    }
    expect(problemForRule('dead_time_high').id).toBe('deaths')
    expect(problemForRule('pg_dead_time_high').id).toBe('deaths')
    for (const id of ['support_control_wards_low', 'control_wards_never', 'support_vision_benchmark', 'jungle_vision_benchmark']) {
      expect(problemForRule(id).id, id).toBe('vision')
    }
    expect(problemForRule('two_loss_stop').id).toBe('tilt-fatigue')
    expect(problemForRule('movement_break').id).toBe('tilt-fatigue')
    expect(problemForRule('new_champion_learning').id).toBe('champion-pool')
  })
})

describe('time spent dead', () => {
  it('dead_time_high: recent mean of 14 % or more over 5+ games', () => {
    expect(fired(games(6, () => ({ timeDeadSec: deadFor(14) })), 'session')).toContain('dead_time_high')
    expect(fired(games(6, () => ({ timeDeadSec: deadFor(13) })), 'session')).not.toContain('dead_time_high')
    // Too few games with the data.
    expect(fired(games(6, (i) => ({ timeDeadSec: i < 4 ? deadFor(20) : null })), 'session')).not.toContain('dead_time_high')
  })

  it('dead_time_high says how much and over how many games', () => {
    const m = evaluateRules(RULES, ctxOf(games(6, () => ({ timeDeadSec: deadFor(16) }))), { moment: 'weekly' }).find((x) => x.rule.id === 'dead_time_high')!
    expect(resolveParams(m).params).toEqual({ pct: 16, n: 5 })
  })

  it('pg_dead_time_high: 17 % or more in this game, and well above the player\'s usual', () => {
    const spike = games(7, (i) => ({ timeDeadSec: i === 0 ? deadFor(20) : deadFor(7 + (i % 3)) }))
    expect(fired(spike, 'post_game', spike[0].id)).toContain('pg_dead_time_high')
    const under = games(7, (i) => ({ timeDeadSec: i === 0 ? deadFor(16) : deadFor(5 + (i % 3)) }))
    expect(fired(under, 'post_game', under[0].id)).not.toContain('pg_dead_time_high')
    // 20 % dead, but that is this player's usual: no spike.
    const usual = games(7, (i) => ({ timeDeadSec: deadFor(19 + (i % 3)) }))
    expect(fired(usual, 'post_game', usual[0].id)).not.toContain('pg_dead_time_high')
  })

  it('merges with the other death signals into one "deaths" message', () => {
    const gs = games(8, () => ({ timeDeadSec: deadFor(18), deaths: 8, deathTimesSec: [400, 800, 1000, 1200, 1300, 1400, 1500, 1600] }))
    const insights = buildInsights(ctxOf(gs), { moment: 'weekly', drivers: null })
    const deaths = insights.filter((i) => i.problemId === 'deaths')
    expect(deaths).toHaveLength(1)
    expect(deaths[0].support).toBeGreaterThanOrEqual(1)
  })
})

describe('control wards', () => {
  it('support_control_wards_low: a support under 2 per game on average', () => {
    expect(fired(games(6, () => ({ role: 'UTILITY', controlWardsBought: 1 })), 'session')).toContain('support_control_wards_low')
    expect(fired(games(6, () => ({ role: 'UTILITY', controlWardsBought: 2 })), 'session')).not.toContain('support_control_wards_low')
    expect(fired(games(6, () => ({ role: 'MIDDLE', controlWardsBought: 0 })), 'session')).not.toContain('support_control_wards_low')
  })

  it('control_wards_never: a laner or jungler with none in 4 of the last 5 games', () => {
    expect(fired(games(5, (i) => ({ controlWardsBought: i === 0 ? 1 : 0 })), 'session')).toContain('control_wards_never')
    expect(fired(games(5, (i) => ({ role: 'JUNGLE', controlWardsBought: i < 4 ? 0 : 2 })), 'session')).toContain('control_wards_never')
    expect(fired(games(5, (i) => ({ controlWardsBought: i < 2 ? 1 : 0 })), 'session')).not.toContain('control_wards_never')
    expect(fired(games(5, () => ({ role: 'UTILITY', controlWardsBought: 0 })), 'session')).not.toContain('control_wards_never')
    // Unknown counts are not zeros.
    expect(fired(games(5, () => ({ controlWardsBought: null })), 'session')).not.toContain('control_wards_never')
  })
})

describe('sessions, breaks and champion experience', () => {
  const live = [session({ id: 'live', status: 'active' })]
  const firedLive = (gs: ReturnType<typeof games>, moment: Moment = 'session', gameId?: string) =>
    evaluateRules(RULES, buildPlayerContext({ games: gs, sessions: live, now: NOW }), { moment, gameId }).map((m) => m.rule.id)

  it('two_loss_stop: two losses in a row inside the current session, superseded by the 3-loss advice', () => {
    const two = [0.3, 0.8].map((ago) => game({ ago, durationSec: 1500, sessionId: 'live', win: false }))
    expect(firedLive(two)).toContain('two_loss_stop')
    // One loss in this session, the other in a previous one: not a streak of this session.
    const split = [game({ ago: 0.3, durationSec: 1500, sessionId: 'live', win: false }), game({ ago: 30, sessionId: 'old', win: false })]
    expect(firedLive(split)).not.toContain('two_loss_stop')
    const one = [game({ ago: 0.3, durationSec: 1500, sessionId: 'live', win: false }), game({ ago: 0.8, durationSec: 1500, sessionId: 'live', win: true })]
    expect(firedLive(one)).not.toContain('two_loss_stop')
    // Three losses: the stronger loss-streak advice leads the same group, with a 30-minute break.
    const three = [0.3, 0.8, 1.3].map((ago) => game({ ago, durationSec: 1500, sessionId: 'live', win: false }))
    const ins = buildInsights(buildPlayerContext({ games: three, sessions: live, now: NOW }), { moment: 'session', drivers: null })
    const tilt = ins.filter((i) => i.problemId === 'tilt-fatigue')
    expect(tilt).toHaveLength(1)
    expect(tilt[0].ruleId).toBe('loss_streak')
    expect(tilt[0].action).toEqual({ type: 'break', minutes: 30 })
  })

  it('long_session: from the 4th game of a session', () => {
    const four = [0.2, 0.7, 1.2, 1.7].map((ago, i) => game({ ago, durationSec: 1500, sessionId: 'live', win: i % 2 === 0 }))
    expect(firedLive(four)).toContain('long_session')
    expect(firedLive(four.slice(0, 3))).not.toContain('long_session')
  })

  it('movement_break: an hour of continuous play over 2+ games', () => {
    const hour = [0.1, 0.6].map((ago) => game({ ago, durationSec: 1800, sessionId: 'live', win: true }))
    expect(firedLive(hour)).toContain('movement_break')
    const short = [game({ ago: 0.1, durationSec: 1500, sessionId: 'live', win: true })]
    expect(firedLive(short)).not.toContain('movement_break')
  })

  it('new_champion_learning: a game on a champion with fewer than 5 earlier games', () => {
    const history = games(8, (i) => ({ champion: i === 0 ? 'Azir' : 'Ahri' }))
    expect(fired(history, 'post_game', history[0].id)).toContain('new_champion_learning')
    const m = evaluateRules(RULES, ctxOf(history), { moment: 'post_game', gameId: history[0].id }).find((x) => x.rule.id === 'new_champion_learning')!
    expect(resolveParams(m).params).toEqual({ champion: 'Azir', count: 1 })
    // The 6th game on the champion is no longer "new".
    const known = games(8, () => ({ champion: 'Ahri' }))
    expect(fired(known, 'post_game', known[0].id)).not.toContain('new_champion_learning')
    const fifth = games(8, (i) => ({ champion: i < 5 ? 'Azir' : 'Ahri' }))
    expect(fired(fifth, 'post_game', fifth[0].id)).toContain('new_champion_learning')
  })
})

describe('role vision benchmarks', () => {
  it('support_vision_benchmark: a support under 1.8 vision score per minute', () => {
    expect(fired(games(6, () => ({ role: 'UTILITY', visionScore: 51 })), 'session')).toContain('support_vision_benchmark') // 1.7/min
    expect(fired(games(6, () => ({ role: 'UTILITY', visionScore: 54 })), 'session')).not.toContain('support_vision_benchmark') // 1.8/min
    expect(fired(games(6, () => ({ role: 'JUNGLE', visionScore: 30 })), 'session')).not.toContain('support_vision_benchmark')
  })

  it('jungle_vision_benchmark: a jungler under 0.7 vision score per minute', () => {
    expect(fired(games(6, () => ({ role: 'JUNGLE', visionScore: 18 })), 'session')).toContain('jungle_vision_benchmark') // 0.6/min
    expect(fired(games(6, () => ({ role: 'JUNGLE', visionScore: 21 })), 'session')).not.toContain('jungle_vision_benchmark') // 0.7/min
    expect(fired(games(6, () => ({ role: 'MIDDLE', visionScore: 12 })), 'session')).not.toContain('jungle_vision_benchmark')
  })
})
