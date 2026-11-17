import { describe, it, expect } from 'vitest'
import { reviewStats, mainRole, topChampions, groupByDay, playerStatus, parseNote, composeNote } from '../../src/lib/playerDossier'
import type { PlayerSessionView, PlayerGameView } from '../../src/lib/collab'

let n = 0
const game = (champion: string, reviewed: boolean, role = 'MIDDLE'): PlayerGameView => ({
  id: `g${++n}`, matchId: `m${n}`, champion, role, win: true, kills: 1, deaths: 1, assists: 1, gameEndAt: null,
  review: reviewed ? ({ id: `r${n}` } as any) : null,
})
const session = (date: string, games: PlayerGameView[], objectiveIds: string[] = ['waves']): PlayerSessionView => ({ id: `s${++n}`, date, objectiveIds, status: null, sessionConclusion: null, games })

describe('player dossier', () => {
  const sessions = [
    session('2026-11-16T20:00:00', [game('Orianna', true), game('Syndra', true), game('Orianna', false)]),
    session('2026-11-15T22:00:00', Array.from({ length: 6 }, () => game('Ahri', false)), []),
  ]

  it('computes review discipline, main role and champion pool', () => {
    expect(reviewStats(sessions)).toEqual({ games: 9, reviewed: 2, pct: 22 })
    expect(mainRole(sessions)).toBe('MIDDLE')
    expect(topChampions(sessions)[0]).toBe('Ahri')
  })

  it('groups by day and flags a no-review marathon', () => {
    const days = groupByDay(sessions)
    expect(days.map((d) => d.status)).toEqual(['partial', 'alert'])
    expect(days[1]).toMatchObject({ games: 6, reviews: 0, objectiveIds: [] })
  })

  it('surfaces the recent alert in the header status', () => {
    const days = groupByDay(sessions)
    const s = playerStatus(days, reviewStats(sessions), Date.parse('2026-11-17T12:00:00'))
    expect(s).toMatchObject({ tone: 'warn', key: 'alert', games: 6 })
  })

  it('round-trips note tags', () => {
    expect(parseNote(composeNote('tilt', 'Stop after 3 losses'))).toEqual({ tag: 'tilt', text: 'Stop after 3 losses' })
    expect(parseNote('plain note')).toEqual({ tag: null, text: 'plain note' })
  })
})
