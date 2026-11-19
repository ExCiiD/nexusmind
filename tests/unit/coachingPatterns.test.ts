import { describe, it, expect } from 'vitest'
import { buildPlayerContext } from '../../electron/main/assistant/features'
import { evaluateRules, RULES } from '../../electron/main/assistant/rules'
import { buildInsights } from '../../electron/main/assistant/report'
import { NOW, game, games, session } from './assistantFixtures'

const HOUR = 3600_000
const ctxOf = (gs: ReturnType<typeof games>) => buildPlayerContext({ games: gs, sessions: [session()], now: NOW })
/** A fixed epoch ms `ago` hours back, at the given local hour. */
function at(hour: number, ago: number): number {
  const d = new Date(NOW - ago * HOUR)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

describe('AS3 — weak champion pool', () => {
  // 20 games, not 10: a new champion runs at ~44 % for ~20 games, and a 10-game winrate is mostly noise.
  it('fires for a champion with ≥ 20 games, < 40% winrate, and KDA below the player average', () => {
    const weak = games(20, () => ({ champion: 'Yasuo', win: false, kills: 1, deaths: 6, assists: 1, cs: 100 })) // kda = 2/6 ≈ 0.33
    const strong = games(10, () => ({ champion: 'Ahri', win: true, kills: 8, deaths: 2, assists: 6, cs: 220 })) // kda = 7
    const ctx = ctxOf([...weak, ...strong])
    const matches = evaluateRules(RULES, ctx, { moment: 'weekly' })
    const m = matches.find((x) => x.rule.id === 'weak_champion_pool')
    expect(m).toBeDefined()
    expect(m!.evidence.c0).toMatchObject({ champion: 'Yasuo', games: 20 })
    expect(Number(m!.evidence.c0.winrate)).toBe(0)
  })

  it('does not fire under 20 games, or when KDA is not below the personal average', () => {
    const fewGames = [
      ...games(15, () => ({ champion: 'Yasuo', win: false, kills: 1, deaths: 6, assists: 1 })),
      ...games(10, () => ({ champion: 'Ahri', win: true, kills: 8, deaths: 2, assists: 6 })),
    ]
    expect(evaluateRules(RULES, ctxOf(fewGames), { moment: 'weekly' }).some((m) => m.rule.id === 'weak_champion_pool')).toBe(false)

    // Losing record but a KDA that is NOT below personal average (all games are this champion, same KDA).
    const uniform = games(24, () => ({ champion: 'Yasuo', win: false, kills: 2, deaths: 4, assists: 2 }))
    expect(evaluateRules(RULES, ctxOf(uniform), { moment: 'weekly' }).some((m) => m.rule.id === 'weak_champion_pool')).toBe(false)
  })

  it('picks the worst-winrate champion when several qualify', () => {
    const worse = games(20, () => ({ champion: 'Worse', win: false, kills: 0, deaths: 8, assists: 0 }))
    const bad = games(20, (i) => ({ champion: 'Bad', win: i < 6, kills: 1, deaths: 5, assists: 1 }))
    const good = games(20, () => ({ champion: 'Good', win: true, kills: 9, deaths: 1, assists: 7 }))
    const m = evaluateRules(RULES, ctxOf([...worse, ...bad, ...good]), { moment: 'weekly' }).find((x) => x.rule.id === 'weak_champion_pool')
    expect(m!.evidence.c0.champion).toBe('Worse')
  })
})

describe('AS4 — bad hour performance', () => {
  it('fires when the overnight winrate is well below the overall winrate, with enough night and day games', () => {
    const night = Array.from({ length: 20 }, (_, i) => game({ endedAt: at(2, 100 + i), win: false }))
    const day = Array.from({ length: 20 }, (_, i) => game({ endedAt: at(14, 100 + i), win: true }))
    const m = evaluateRules(RULES, ctxOf([...night, ...day]), { moment: 'weekly' }).find((x) => x.rule.id === 'bad_hour_performance')
    expect(m).toBeDefined()
    expect(m!.evidence.c0).toMatchObject({ nightGames: 20, nightWinrate: 0, overallWinrate: 50 })
  })

  it('does not fire under the night-game minimum, without enough day games to compare, or when the gap is too small', () => {
    const fewNight = Array.from({ length: 15 }, (_, i) => game({ endedAt: at(2, 100 + i), win: false }))
    const day = Array.from({ length: 20 }, (_, i) => game({ endedAt: at(14, 100 + i), win: true }))
    expect(evaluateRules(RULES, ctxOf([...fewNight, ...day]), { moment: 'weekly' }).some((m) => m.rule.id === 'bad_hour_performance')).toBe(false)

    // 20 night games but only 10 day games: nothing reliable to compare them with.
    const night = Array.from({ length: 20 }, (_, i) => game({ endedAt: at(2, 100 + i), win: false }))
    const fewDay = Array.from({ length: 10 }, (_, i) => game({ endedAt: at(14, 100 + i), win: true }))
    expect(evaluateRules(RULES, ctxOf([...night, ...fewDay]), { moment: 'weekly' }).some((m) => m.rule.id === 'bad_hour_performance')).toBe(false)

    const closeNight = Array.from({ length: 20 }, (_, i) => game({ endedAt: at(2, 100 + i), win: i % 2 === 0 }))
    const closeDay = Array.from({ length: 20 }, (_, i) => game({ endedAt: at(14, 100 + i), win: i % 2 === 0 }))
    expect(evaluateRules(RULES, ctxOf([...closeNight, ...closeDay]), { moment: 'weekly' }).some((m) => m.rule.id === 'bad_hour_performance')).toBe(false)
  })
})

describe('AS5 — session fatigue', () => {
  it('fires when games 4+ of a session perform clearly worse than games 1-3, across enough sessions', () => {
    const gs: ReturnType<typeof game>[] = []
    for (let s = 1; s <= 4; s++) {
      for (let i = 0; i < 5; i++) {
        gs.push(game({
          sessionId: `s${s}`,
          ago: s * 20 + (5 - i) * 0.5, // oldest (i=0) first within the session
          cs: i < 3 ? 220 : 120, // strong early games, weak late games
          visionScore: i < 3 ? 30 : 10,
          deaths: i < 3 ? 2 : 7,
          kills: i < 3 ? 7 : 1,
        }))
      }
    }
    const m = evaluateRules(RULES, ctxOf(gs), { moment: 'weekly' }).find((x) => x.rule.id === 'session_fatigue')
    expect(m).toBeDefined()
    expect(m!.evidence.c0.sessions).toBe(4)
    expect(Number(m!.evidence.c0.gap)).toBeGreaterThan(0)
  })

  it('does not fire with too few qualifying sessions, or no real drop-off', () => {
    const oneSession = Array.from({ length: 5 }, (_, i) => game({ sessionId: 's1', ago: (5 - i) * 0.5, cs: i < 3 ? 220 : 100 }))
    expect(evaluateRules(RULES, ctxOf(oneSession), { moment: 'weekly' }).some((m) => m.rule.id === 'session_fatigue')).toBe(false)

    const gs: ReturnType<typeof game>[] = []
    for (let s = 1; s <= 4; s++) {
      for (let i = 0; i < 5; i++) gs.push(game({ sessionId: `s${s}`, ago: s * 20 + (5 - i) * 0.5, cs: 180, deaths: 4 }))
    }
    expect(evaluateRules(RULES, ctxOf(gs), { moment: 'weekly' }).some((m) => m.rule.id === 'session_fatigue')).toBe(false)
  })
})

describe('AS3/AS4/AS5 insights', () => {
  it('produce an insight with no suggested objective (informational patterns, not fundamentals)', () => {
    const night = Array.from({ length: 20 }, (_, i) => game({ endedAt: at(2, 100 + i), win: false }))
    const day = Array.from({ length: 20 }, (_, i) => game({ endedAt: at(14, 100 + i), win: true }))
    const insights = buildInsights(ctxOf([...night, ...day]), { moment: 'weekly', drivers: null, limit: 10 })
    const insight = insights.find((i) => i.ruleId === 'bad_hour_performance')
    expect(insight).toBeDefined()
    expect(insight!.action).toBeNull()
    expect(insight!.problemId).toBe('play-schedule')
  })
})
