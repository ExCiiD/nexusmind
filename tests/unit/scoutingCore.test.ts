import { describe, it, expect } from 'vitest'
import { participantFor, aggregateChampionPlays, winRateOf, kdaOf, mergeMatchIdsByRecency } from '../../src/lib/scoutingCore'

function match(puuid: string, championName: string, teamPosition: string, win: boolean, k = 0, d = 0, a = 0) {
  return { info: { participants: [{ puuid, championName, teamPosition, win, kills: k, deaths: d, assists: a }] } }
}

describe('participantFor', () => {
  it('finds the participant matching puuid', () => {
    const p = participantFor(match('P1', 'Renekton', 'TOP', true, 5, 2, 3), 'P1')
    expect(p?.championName).toBe('Renekton')
  })

  it('returns null when the puuid is not in the match', () => {
    expect(participantFor(match('P1', 'Renekton', 'TOP', true), 'P2')).toBeNull()
  })
})

describe('aggregateChampionPlays', () => {
  it('counts games, wins and kda components per champion+role, normalizing Riot role names', () => {
    const matches = new Map([
      ['m1', match('P1', 'Renekton', 'TOP', true, 5, 2, 3)],
      ['m2', match('P1', 'Renekton', 'TOP', false, 1, 4, 2)],
    ])
    const { agg, sameRoleCount, failed } = aggregateChampionPlays(matches, ['m1', 'm2'], 'P1')
    const entry = agg.get('Renekton|TOP')
    expect(entry).toMatchObject({ count: 2, wins: 1, kills: 6, deaths: 6, assists: 5 })
    expect(sameRoleCount).toBe(2)
    expect(failed).toBe(0)
  })

  it('records each champion’s first and last game, and the span of every analysed game', () => {
    const at = (t: number, m: ReturnType<typeof match>) => ({ info: { ...m.info, gameStartTimestamp: t } })
    const matches = new Map([
      ['m1', at(3_000, match('P1', 'Renekton', 'TOP', true))],
      ['m2', at(1_000, match('P1', 'Renekton', 'TOP', false))],
      ['m3', at(500, match('P1', 'Jinx', 'BOTTOM', true))],
    ])
    const { agg, history } = aggregateChampionPlays(matches, ['m1', 'm2', 'm3'], 'P1', { roleOnly: true, memberRole: 'TOP' })
    expect(agg.get('Renekton|TOP')).toMatchObject({ firstAt: 1_000, lastAt: 3_000 })
    // The off-role game is not counted, but it still tells how far back the data looks.
    expect(history).toEqual({ from: 500, to: 3_000 })
  })

  it('normalizes Riot MIDDLE/BOTTOM/UTILITY to MID/ADC/SUPPORT', () => {
    const matches = new Map([['m1', match('P1', 'Azir', 'MIDDLE', true)]])
    const { agg } = aggregateChampionPlays(matches, ['m1'], 'P1')
    expect(agg.has('Azir|MID')).toBe(true)
  })

  it('filters out off-role games when roleOnly is set', () => {
    const matches = new Map([['m1', match('P1', 'Jinx', 'BOTTOM', true)]])
    const { agg, sameRoleCount } = aggregateChampionPlays(matches, ['m1'], 'P1', { roleOnly: true, memberRole: 'TOP' })
    expect(agg.size).toBe(0)
    expect(sameRoleCount).toBe(0)
  })

  it('counts a missing (uncached) match as failed, not as a 0-game entry', () => {
    const matches = new Map<string, any>()
    const { agg, failed } = aggregateChampionPlays(matches, ['m1'], 'P1')
    expect(agg.size).toBe(0)
    expect(failed).toBe(1)
  })
})

describe('mergeMatchIdsByRecency (E15 incremental scout)', () => {
  it('dedupes overlapping ids and sorts most-recent-first by the embedded timestamp', () => {
    const previous = ['EUW1_100', 'EUW1_300']
    const freshlyListed = ['EUW1_300', 'EUW1_500']
    expect(mergeMatchIdsByRecency(freshlyListed, previous)).toEqual(['EUW1_500', 'EUW1_300', 'EUW1_100'])
  })

  it('returns the other list unchanged when one side is empty', () => {
    expect(mergeMatchIdsByRecency([], ['EUW1_100'])).toEqual(['EUW1_100'])
    expect(mergeMatchIdsByRecency(['EUW1_100'], [])).toEqual(['EUW1_100'])
  })
})

describe('winRateOf / kdaOf', () => {
  it('computes a rounded percentage win rate', () => {
    expect(winRateOf({ wins: 1, count: 3 })).toBe(33)
  })

  it('returns 0 for a zero-game entry instead of dividing by zero', () => {
    expect(winRateOf({ wins: 0, count: 0 })).toBe(0)
  })

  it('computes (kills+assists)/max(1,deaths), never dividing by zero deaths', () => {
    expect(kdaOf({ kills: 6, assists: 4, deaths: 0 })).toBe(10)
    expect(kdaOf({ kills: 6, assists: 4, deaths: 2 })).toBe(5)
  })
})
