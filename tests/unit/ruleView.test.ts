import { describe, expect, it } from 'vitest'
import { emptyRuleCounts, sumRuleCounts, type RuleCounts } from '@/lib/objectiveRuleFigures'
import { heroOf, ownSplitOf, ruleRoleOf } from '@/lib/ruleView'

/** One ADC game in a context: `ours` of `n` own-lane objectives read (the headline and the context figures are both filled, as the engine does). */
function adcGame(context: 'team' | 'soloQ', ours: number, n: number): RuleCounts {
  const c = emptyRuleCounts()
  c.games = 1
  c.prio.own = { lane: 'BOT', n, tally: { ours, oursProven: ours, even: n - ours, theirs: 0, unknown: 0 } }
  c.byContext[context] = { games: 1, own: { n, tally: { ours, oursProven: ours, even: n - ours, theirs: 0, unknown: 0 } }, dropped: { ...c.byContext[context].dropped } }
  return c
}

describe('ruleView own-lane split', () => {
  it('the headline is the sum of the team and soloQ figures, team first', () => {
    const sum = sumRuleCounts([adcGame('team', 2, 3), adcGame('soloQ', 1, 4)])!
    const hero = heroOf(sum, 'ADC')
    const rows = ownSplitOf(sum, 'ADC')!
    expect(rows.map((r) => r.key)).toEqual(['team', 'soloQ'])
    expect(rows.map((r) => `${r.num} / ${r.n}`)).toEqual(['2 / 3', '1 / 4'])
    expect(rows.reduce((n, r) => n + r.num, 0)).toBe(hero.num)
    expect(rows.reduce((n, r) => n + r.n, 0)).toBe(hero.den)
    expect([hero.num, hero.den]).toEqual([3, 7])
  })
  it('no split with one context only, nor for the roles without an own-lane figure', () => {
    expect(ownSplitOf(sumRuleCounts([adcGame('team', 2, 3)])!, 'ADC')).toBeNull()
    const both = sumRuleCounts([adcGame('team', 2, 3), adcGame('soloQ', 1, 4)])!
    expect(ownSplitOf(both, 'JUNGLE')).toBeNull()
    expect(ownSplitOf(both, 'SUPPORT')).toBeNull()
    expect(ownSplitOf(both, null)).toBeNull()
    expect(ownSplitOf(both, ruleRoleOf('BOTTOM'))).not.toBeNull()
  })
})
