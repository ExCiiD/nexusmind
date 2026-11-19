import { describe, it, expect } from 'vitest'
import { clock, friezeTicks, joinPickOrder, moveItem, pct, pickOrderSides, signedClockDiff, signedGold, toTeamObjectivesFilters } from '../../src/lib/analystViews'
import { dossierInputOf } from '../../src/components/analyst/DossierView'
import type { OpponentDossierView } from '../../src/lib/analyst'

// #40: the analyst screens' display helpers (the data and its computations are the Back-end's contract and Cores).
describe('formatting', () => {
  it('clock, signed timing gap, signed gold, 0-1 share as percent', () => {
    expect(clock(522)).toBe('08:42')
    expect(signedClockDiff(460, 535)).toBe('−1:15')
    expect(signedClockDiff(600, 560)).toBe('+0:40')
    expect(signedGold(1240)).toMatch(/^\+1.240$/)
    expect(signedGold(-300)).toBe('−300')
    expect(pct(0.615)).toBeCloseTo(61.5)
    expect(pct(null)).toBeNull()
  })

  it('frieze ticks every 5 minutes inside the game', () => {
    expect(friezeTicks(31 * 60)).toEqual([5, 10, 15, 20, 25, 30])
    expect(friezeTicks(25 * 60)).toEqual([5, 10, 15, 20])
  })
})

describe('toTeamObjectivesFilters', () => {
  const now = new Date('2026-11-19T12:00:00Z')
  const base = { sources: ['scrim' as const], side: 'blue' as const }
  it('turns the period into dates', () => {
    expect(toTeamObjectivesFilters({ ...base, period: '7d' }, now)).toEqual({ ...base, from: '2026-11-12' })
    expect(toTeamObjectivesFilters({ ...base, period: '30d' }, now)).toEqual({ ...base, from: '2026-10-20' })
    expect(toTeamObjectivesFilters({ ...base, period: 'season' }, now)).toEqual({ ...base, from: '2026-01-01' })
    expect(toTeamObjectivesFilters({ ...base, period: 'custom', from: '2026-11-01' }, now)).toEqual({ ...base, from: '2026-11-01' })
  })
})

describe('dossierInputOf', () => {
  const view = { opponentName: 'Aegis', scoutNotes: 'Scaling comp', dossier: null } as unknown as OpponentDossierView
  it('pre-fills "How they play" from the scouting notes when no dossier is saved', () => {
    expect(dossierInputOf(view)).toEqual({ opponentName: 'Aegis', howTheyPlay: 'Scaling comp', suggestedBans: [], gamePlan: null })
  })
  it('keeps the saved dossier otherwise (even an emptied field)', () => {
    const saved = { ...view, dossier: { opponentName: 'Aegis', howTheyPlay: null, suggestedBans: ['Zeri'], gamePlan: 'Punish bot' } } as unknown as OpponentDossierView
    expect(dossierInputOf(saved)).toEqual({ opponentName: 'Aegis', howTheyPlay: null, suggestedBans: ['Zeri'], gamePlan: 'Punish bot' })
  })
})

describe('pick order (§ 11)', () => {
  const p = (...names: string[]) => names.map((champion) => ({ champion }))
  const ours = p('Gnar', 'Sejuani', 'Orianna', 'Varus', 'Braum')
  const theirs = p('Jax', 'LeeSin', 'Syndra', 'Ezreal', 'Rakan')

  it('without a stored order: each side in role order, ours on our side', () => {
    expect(pickOrderSides(null, 'red', ours, theirs)).toEqual({ blue: theirs.map((x) => x.champion), red: ours.map((x) => x.champion) })
  })

  it('joins along B1 R1 R2 B2 B3 R3 R4 B4 B5 R5, and splits back', () => {
    const blue = ['Orianna', 'Gnar', 'Sejuani', 'Braum', 'Varus']
    const red = ['Syndra', 'LeeSin', 'Rakan', 'Jax', 'Ezreal']
    const order = joinPickOrder(blue, red)
    expect(order).toEqual(['Orianna', 'Syndra', 'LeeSin', 'Gnar', 'Sejuani', 'Rakan', 'Jax', 'Braum', 'Varus', 'Ezreal'])
    expect(pickOrderSides(order, 'blue', ours, theirs)).toEqual({ blue, red })
  })

  it('a stored order that no longer matches the picks falls back to role order', () => {
    const stale = ['Ahri', 'Syndra', 'LeeSin', 'Gnar', 'Sejuani', 'Rakan', 'Jax', 'Braum', 'Varus', 'Ezreal']
    expect(pickOrderSides(stale, 'blue', ours, theirs).blue).toEqual(ours.map((x) => x.champion))
  })

  it('moves an item, clamped to the list', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 9)).toEqual(['b', 'c', 'a'])
  })
})
