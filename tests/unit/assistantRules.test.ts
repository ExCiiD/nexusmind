import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildPlayerContext } from '../../electron/main/assistant/features'
import { compare, evaluateRules, resolveParams, RULES, type Moment } from '../../electron/main/assistant/rules'
import { buildInsights, buildReport, neighbourObjective, pickVariant } from '../../electron/main/assistant/report'
import { getAllFundamentals } from '../../src/lib/constants/fundamentals'
import { NOW, game, games, session } from './assistantFixtures'

const ctxOf = (gs: ReturnType<typeof games>, sessions = [session()]) => buildPlayerContext({ games: gs, sessions, now: NOW })
const fired = (gs: ReturnType<typeof games>, moment: Moment, gameId?: string, sessions = [session()]) =>
  evaluateRules(RULES, ctxOf(gs, sessions), { moment, gameId }).map((m) => m.rule.id)

describe('rule definitions (data)', () => {
  it('has unique ids and sane priorities / confidences', () => {
    const ids = RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(RULES.length).toBeGreaterThanOrEqual(10)
    for (const r of RULES) {
      expect(r.priority).toBeGreaterThan(0)
      expect(r.priority).toBeLessThanOrEqual(100)
      expect(r.confidence).toBeGreaterThan(0)
      expect(r.confidence).toBeLessThanOrEqual(1)
      expect(r.variants).toBeGreaterThanOrEqual(2)
      expect(r.moments.length).toBeGreaterThan(0)
    }
  })

  it('is JSON-serialisable (rules are data, not code)', () => {
    expect(JSON.parse(JSON.stringify(RULES))).toEqual(RULES)
  })

  it('every phrasing variant exists in en and fr, and its params are provided', () => {
    for (const lang of ['en', 'fr']) {
      const locale = JSON.parse(readFileSync(join(process.cwd(), 'src', 'i18n', 'locales', `${lang}.json`), 'utf-8'))
      for (const r of RULES) {
        for (let v = 1; v <= r.variants; v++) {
          const text: string | undefined = locale.assistant?.rules?.[r.id]?.[`v${v}`]
          expect(text, `${lang} assistant.rules.${r.id}.v${v}`).toBeTypeOf('string')
          for (const [, p] of text!.matchAll(/{{(\w+)}}/g)) {
            expect(p === 'name' || Object.keys(r.params ?? {}).includes(p), `${lang} ${r.id}.v${v} uses {{${p}}}`).toBe(true)
          }
        }
        expect(locale.assistant.why[r.why.key], `${lang} why.${r.why.key}`).toBeTypeOf('string')
        if (r.action?.type === 'drill') expect(locale.assistant.drills[r.action.drillId]).toBeTypeOf('string')
      }
    }
  })

  it('suggested objectives are real fundamentals', () => {
    const ids = new Set(getAllFundamentals().map((f) => f.id))
    for (const r of RULES) if (r.action?.type === 'objective') expect(ids.has(r.action.objectiveId), r.id).toBe(true)
    for (const id of ids) {
      const n = neighbourObjective(id)
      if (n) expect(ids.has(n), `neighbour of ${id}`).toBe(true)
    }
  })

  it('compare handles every operator', () => {
    expect(compare(2, '>=', 2)).toBe(true)
    expect(compare(1, '>', 2)).toBe(false)
    expect(compare(1, '<', 2)).toBe(true)
    expect(compare(2, '<=', 1)).toBe(false)
    expect(compare(1, '==', 1)).toBe(true)
  })
})

describe('rules fire on the right patterns', () => {
  it('repeated early deaths: 3 of the last 5 games with 2+ deaths before 10 min', () => {
    const early = games(5, (i) => ({ deathTimesSec: i < 3 ? [200, 450, 1500] : [1500] }))
    expect(fired(early, 'session')).toContain('early_deaths_pattern')
    const fine = games(5, (i) => ({ deathTimesSec: i < 2 ? [200, 450] : [1500] }))
    expect(fired(fine, 'session')).not.toContain('early_deaths_pattern')
  })

  it('needs enough games with timeline data', () => {
    const noTimeline = games(5, (i) => ({ deathTimesSec: i < 4 ? [100, 200] : null }))
    expect(fired(noTimeline, 'session')).not.toContain('early_deaths_pattern')
  })

  it('tilt: 3 losses in a row and a session over 2 h → break', () => {
    const gs = games(4, (i) => ({ ago: 0.2 + i * 0.7, sessionId: 'live', win: false }))
    const live = [session({ id: 'live', status: 'active' })]
    const ids = fired(gs, 'session', undefined, live)
    expect(ids).toContain('tilt_break')
    const ins = buildInsights(ctxOf(gs, live), { moment: 'session' })
    expect(ins[0].ruleId).toBe('tilt_break') // highest priority, supersedes loss_streak (same group)
    expect(ins.map((i) => i.ruleId)).not.toContain('loss_streak')
    expect(ins[0].action).toEqual({ type: 'break', minutes: 15 })
    expect(ins[0].params.losses).toBe(4)
  })

  it('short losing streak without a long session → plain loss streak advice', () => {
    const gs = [0.4, 0.8, 1.2].map((ago) => game({ ago, durationSec: 1200, sessionId: 'live', win: false }))
    const ids = fired(gs, 'session', undefined, [session({ id: 'live', status: 'active' })])
    expect(ids).toContain('loss_streak')
    expect(ids).not.toContain('tilt_break')
  })

  it('self-score bias: reviews going up while objective stats go down', () => {
    const gs = games(12, (i) => i < 5
      ? { kpiScores: { k: 9 }, cs: 150, deaths: 8, visionScore: 12, kills: 1, assists: 2 }
      : { kpiScores: { k: 6 }, cs: 220, deaths: 3, visionScore: 28, kills: 6, assists: 6 })
    expect(fired(gs, 'weekly')).toContain('kpi_bias')
  })

  it('post-game bias: high self-score on a game below the personal average', () => {
    const gs = games(10, (i) => i === 0
      ? { kpiScores: { k: 9 }, cs: 120, deaths: 9, kills: 0, assists: 1, visionScore: 8 }
      : { kpiScores: { k: 6 } })
    expect(fired(gs, 'post_game', gs[0].id)).toContain('pg_self_bias')
  })

  it('objective repeated 4 sessions without progress → neighbour objective', () => {
    const sessions = [1, 2, 3, 4].map((i) => session({ id: `s${i}`, date: NOW - i * 86400_000, objectiveIds: ['csing_pathing'], selectedKpiIds: ['k'] }))
    const gs = games(8, (i) => ({ sessionId: `s${Math.floor(i / 2) + 1}`, kpiScores: { k: 5 } }))
    const ins = buildInsights(ctxOf(gs, sessions), { moment: 'session', limit: 10 })
    const stag = ins.find((i) => i.ruleId === 'objective_stagnation')!
    expect(stag).toBeDefined()
    expect(stag.action).toEqual({ type: 'objective', objectiveId: 'wave_management' })
    expect(stag.params).toMatchObject({ sessions: 4, objective: 'csing_pathing' })
    expect(stag.paramKinds.objective).toBe('objective')
  })

  it('vision dropping vs personal baseline', () => {
    const gs = games(15, (i) => ({ visionScore: i < 5 ? 10 : 30 + (i % 3) }))
    expect(fired(gs, 'weekly')).toContain('vision_drop')
  })

  it('CS trend down for a laner, ignored for a support', () => {
    const down = games(15, (i) => ({ cs: i < 5 ? 150 : 225 + (i % 3) * 3 }))
    expect(fired(down, 'session')).toContain('cs_trend_down')
    const supp = games(15, (i) => ({ role: 'UTILITY', cs: i < 5 ? 15 : 40 + (i % 3) }))
    expect(fired(supp, 'session')).not.toContain('cs_trend_down')
  })

  it('recurring mistake → re-watch the tagged moments, recordings first', () => {
    const tag = (gameTimeSec: number) => ({ id: `m${gameTimeSec}`, tagSlug: 'overstay', tagLabel: 'Overstay', gameTimeSec })
    const gs = games(5, (i) => ({
      mistakes: i < 3 ? [tag(300 + i)] : [],
      recordingId: i === 2 ? 'rec-2' : null,
    }))
    const ins = buildInsights(ctxOf(gs), { moment: 'weekly', limit: 10 })
    const rm = ins.find((i) => i.ruleId === 'recurring_mistake')!
    expect(rm.params).toMatchObject({ tag: 'Overstay', count: 3, n: 5 })
    expect(rm.action?.type).toBe('rewatch')
    if (rm.action?.type === 'rewatch') {
      expect(rm.action.clips).toHaveLength(3)
      expect(rm.action.clips[0]).toMatchObject({ recordingId: 'rec-2', gameTimeSec: 302 })
    }
  })

  it('early-death re-watch links point at deaths before 10 minutes', () => {
    const gs = games(5, (i) => ({ deathTimesSec: i < 3 ? [130, 480, 1500] : [1500], recordingId: `rec-${i}` }))
    const ins = buildInsights(ctxOf(gs), { moment: 'session' })
    const ed = ins.find((i) => i.ruleId === 'early_deaths_pattern')!
    expect(ed.action?.type).toBe('rewatch')
    if (ed.action?.type === 'rewatch') {
      expect(ed.action.clips.every((c) => c.gameTimeSec < 600)).toBe(true)
      expect(ed.action.clips.length).toBeLessThanOrEqual(4)
    }
  })

  it('post-game rules look at the target game, not later ones', () => {
    const gs = games(10, (i) => ({ deathTimesSec: i === 3 ? [100, 300] : [1500] }))
    expect(fired(gs, 'post_game', gs[3].id)).toContain('pg_early_deaths')
    expect(fired(gs, 'post_game', gs[0].id)).not.toContain('pg_early_deaths')
    expect(fired(gs, 'post_game', 'unknown-game')).toEqual([])
  })

  it('celebrates a win streak and a strong lane', () => {
    const gs = games(6, (i) => ({ win: i < 3, lane: i === 0 ? { grade: 'A+', numericScore: 80 } : null }))
    const ids = fired(gs, 'post_game', gs[0].id)
    expect(ids).toEqual(expect.arrayContaining(['win_streak', 'pg_lane_strong']))
  })
})

describe('report', () => {
  it('post-game: at most 3 points, each explained, with a stable key', () => {
    const gs = games(10, (i) => i === 0
      ? { deathTimesSec: [100, 300, 500], deaths: 9, cs: 120, visionScore: 5, win: false }
      : { win: i % 2 === 0 })
    const r = buildReport(ctxOf(gs), { moment: 'post_game', gameId: gs[0].id, playerName: 'Ari' })
    expect(r.insights.length).toBeGreaterThan(0)
    expect(r.insights.length).toBeLessThanOrEqual(3)
    for (const i of r.insights) {
      expect(i.key).toBe(`${i.ruleId}:${gs[0].id}`)
      expect(i.why.key).toMatch(/^assistant\.why\./)
      expect(i.messageKey).toMatch(new RegExp(`^assistant\\.rules\\.${i.ruleId}\\.v\\d$`))
      expect(i.params.name).toBe('Ari')
    }
    expect(r.intro).toMatchObject({ params: { name: 'Ari', n: 10 } })
    // Sorted by score.
    expect([...r.insights].sort((a, b) => b.score - a.score)).toEqual(r.insights)
  })

  it('says when there is not enough data', () => {
    expect(buildReport(ctxOf(games(2)), { moment: 'session' }).intro.key).toMatch(/^assistant\.intro\.notEnough\.v\d$/)
  })

  it('weekly: summary vs previous week', () => {
    const gs = [
      ...games(4, (i) => ({ ago: 24 * (i + 1), win: i < 3 })),
      ...games(2, (i) => ({ ago: 24 * (8 + i), win: false })),
    ]
    const r = buildReport(ctxOf(gs), { moment: 'weekly' })
    expect(r.summary).toMatchObject({ games: 4, wins: 3, winrate: 75, previousGames: 2, previousWinrate: 0 })
    expect(r.drivers).toBeNull() // < 15 games
  })

  it('keeps the same wording on the same day and passes votes through', () => {
    const gs = games(5, () => ({ win: true }))
    const a = buildInsights(ctxOf(gs), { moment: 'session', seed: 'day1' })
    const b = buildInsights(ctxOf(gs), { moment: 'session', seed: 'day1', votesByKey: { [a[0].key]: -1 } })
    expect(b[0].messageKey).toBe(a[0].messageKey)
    expect(b[0].vote).toBe(-1)
    expect(pickVariant('x', 3)).toBe(pickVariant('x', 3))
    expect(pickVariant('x', 1)).toBe(1)
  })

  it('formats params with the requested precision', () => {
    const gs = games(6, () => ({ deaths: 7 }))
    const m = evaluateRules(RULES, ctxOf(gs), { moment: 'weekly' }).find((x) => x.rule.id === 'high_deaths_trend')!
    expect(resolveParams(m).params).toEqual({ avg: 7, n: 5 })
  })
})
