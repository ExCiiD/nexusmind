/**
 * Fundamentals — the Nov. 2026 research numbers (docs/RECHERCHE_CONNAISSANCES.md) and the EN/FR mirror.
 */
import { describe, it, expect } from 'vitest'
import { FUNDAMENTALS, getFundamentalById } from '../../src/lib/constants/fundamentals'
import { FUNDAMENTALS_FR } from '../../src/lib/constants/fundamentals.fr'

const shape = (cats: typeof FUNDAMENTALS) =>
  cats.map((c) => [c.id, c.fundamentals.map((f) => [f.id, f.kpis.map((k) => k.id), (f.subcategories ?? []).map((s) => [s.id, s.kpis.map((k) => k.id)])])])
const kpi = (cats: typeof FUNDAMENTALS, fundamentalId: string, kpiId: string) =>
  cats.flatMap((c) => c.fundamentals).find((f) => f.id === fundamentalId)!.kpis.find((k) => k.id === kpiId)!

describe('fundamentals — research upgrade', () => {
  it('French mirrors English: same categories, fundamentals, KPIs and subcategories, in the same order', () => {
    expect(shape(FUNDAMENTALS_FR)).toEqual(shape(FUNDAMENTALS))
  })

  it('decision making gains the respawn-window KPI in both languages', () => {
    expect(getFundamentalById('decision_making')!.kpis.map((k) => k.id)).toContain('respawn_window_conversion')
    expect(kpi(FUNDAMENTALS_FR, 'decision_making', 'respawn_window_conversion').label).toBe('Conversion des timers de respawn')
  })

  it('carries the checkable 2026 numbers', () => {
    const cases: Array<[string, string, RegExp, RegExp]> = [
      ['tempo', 'death_regulation', /under 8 %.*14 % or more/, /sous 8 %.*14 % ou plus/],
      ['jungle_tracking', 'camp_timer_knowledge', /0:55.*2:55/, /0:55.*2:55/],
      ['level_up_timers', 'level_2_spike', /9th in the bot lane duo/, /9e en duo bot lane/],
      ['resilience', 'loss_streak_recovery', /30 minutes.*two losses/, /trentaine de minutes.*deux défaites/],
      ['recall_timing', 'objective_sync_recall', /T-1:30.*45-75 s/, /T-1:30.*45 à 75 s/],
      ['summoner_spells', 'tp_macro', /390 s/, /390 s/],
      ['vision_setup', 'pink_ward_usage', /40 g/, /40 g/],
    ]
    for (const [f, k, en, fr] of cases) {
      expect(kpi(FUNDAMENTALS, f, k).description, `${f}/${k}`).toMatch(en)
      expect(kpi(FUNDAMENTALS_FR, f, k).description, `${f}/${k} fr`).toMatch(fr)
    }
  })

  it('keeps LoL jargon in English in the French text', () => {
    const fr = JSON.stringify(FUNDAMENTALS_FR)
    expect(fr).not.toMatch(/\bvagues?\b|temps de recharge|contre-gank/i)
  })
})
