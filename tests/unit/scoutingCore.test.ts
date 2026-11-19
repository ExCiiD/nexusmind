import { describe, it, expect } from 'vitest'
import {
  participantFor, aggregateChampionPlays, winRateOf, kdaOf, mergeMatchIdsByRecency, teamListWhere, teamLinkReleaseWhere,
  aggregateMatchLike, matchLikeFromRiot, matchLikeFromCustom, indexMatchIds, sharedMatchIds, matchIdsByRegion, combinedSources,
} from '../../src/lib/scoutingCore'

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

// #7 (19/11/2026): Scouting listed the opponents of every team on the PC.
describe('teamListWhere', () => {
  it('always scopes to the local user', () => {
    expect(teamListWhere('u1')).toEqual({ userId: 'u1' })
    expect(teamListWhere('u1', { isOpponent: true })).toEqual({ userId: 'u1', isOpponent: true })
  })
  it('keeps only the opponents scouted for the chosen group', () => {
    expect(teamListWhere('u1', { isOpponent: true, groupId: 'g1' })).toEqual({ userId: 'u1', isOpponent: true, groupId: 'g1' })
  })
  it('can add the opponents created before groups existed', () => {
    expect(teamListWhere('u1', { isOpponent: true, groupId: 'g1', includeUnassigned: true }))
      .toEqual({ userId: 'u1', isOpponent: true, OR: [{ groupId: 'g1' }, { groupId: null }] })
  })
  it('ignores includeUnassigned without a group', () => {
    expect(teamListWhere('u1', { isOpponent: true, includeUnassigned: true })).toEqual({ userId: 'u1', isOpponent: true })
  })
})

describe('teamLinkReleaseWhere', () => {
  it('an own team takes the group from the other own team only', () => {
    expect(teamLinkReleaseWhere('u1', 't1', 'g1', false)).toEqual({ userId: 'u1', groupId: 'g1', isOpponent: false, NOT: { id: 't1' } })
  })
  it('an opponent releases nothing (many opponents per group)', () => {
    expect(teamLinkReleaseWhere('u1', 't1', 'g1', true)).toBeNull()
  })
})

// #41b (19/11/2026): the team stats aggregation, shared by the desktop and the web adapter.
describe('team stats (Stats collectives)', () => {
  const team = { id: 't', members: [
    { id: 'm1', displayName: 'Top', ign: 'TopGuy', role: 'TOP', puuid: 'p1' },
    { id: 'm2', displayName: 'Jgl', ign: 'JglGuy', role: 'JUNGLE', puuid: 'p2' },
  ] }
  const riot = (win: boolean) => ({ info: { gameDuration: 1800, participants: [
    { puuid: 'p1', teamId: 100, teamPosition: 'TOP', win, kills: 4, deaths: 2, assists: 6, totalMinionsKilled: 200, totalDamageDealtToChampions: 20000, goldEarned: 12000, championName: 'Renekton' },
    { puuid: 'p2', teamId: 100, teamPosition: 'JUNGLE', win, kills: 2, deaths: 1, assists: 8, neutralMinionsKilled: 150, totalDamageDealtToChampions: 10000, goldEarned: 10000, championName: 'Vi' },
    { puuid: 'x', teamId: 200, teamPosition: 'TOP', win: !win, kills: 1, deaths: 4, assists: 1 },
  ] } })

  it('aggregates averages, shares and champions per member', () => {
    const res = aggregateMatchLike(team, [matchLikeFromRiot(riot(true)), matchLikeFromRiot(riot(false))], 2)
    expect(res.matchCount).toBe(2)
    const top = res.players.find((p) => p.memberId === 'm1')!
    expect(top).toMatchObject({ gamesPlayed: 2, wins: 1, winRate: 50 })
    expect(top.averages.kda).toBe(5)
    expect(top.shares.damagePct).toBeCloseTo(66.67, 1)
    expect(top.byChampion).toEqual([{ championKey: 'Renekton', games: 2, wins: 1, winRate: 50 }])
  })
  it('matches custom games by name (no puuid) and skips empty or unreadable ones', () => {
    const custom = matchLikeFromCustom({ durationSec: 1500, participantsJson: JSON.stringify([
      { playerName: 'topguy', teamId: 200, teamPosition: 'TOP', win: true, kills: 3, deaths: 0, assists: 3, championName: 'Gnar' },
    ]) })
    const broken = matchLikeFromCustom({ durationSec: 1500, participantsJson: 'not json' })
    expect(broken.participants).toEqual([])
    const res = aggregateMatchLike(team, [custom, broken, matchLikeFromRiot(undefined)])
    expect(res.matchCount).toBe(1)
    expect(res.players.map((p) => p.memberId)).toEqual(['m1'])
  })
  it('finds the matches several members played and groups them by region', () => {
    const index = new Map<string, Set<string>>()
    indexMatchIds(index, 'p1', ['EUW1_1', 'EUW1_2'])
    indexMatchIds(index, 'p2', ['EUW1_2', 'EUW1_3'])
    expect(sharedMatchIds(index, 2)).toEqual(['EUW1_2'])
    expect([...matchIdsByRegion(['EUW1_2'], index, [{ puuid: 'p1', region: 'EUW1' }, { puuid: 'p2', region: null }])])
      .toEqual([['EUW1', ['EUW1_2']]])
  })
  it('counts what the combined numbers are made of', () => {
    expect(combinedSources(4, [{ gameType: 'scrim' }, { gameType: 'scrim' }, { gameType: 'tournament' }])).toEqual({ flex: 4, scrim: 2, tournament: 1 })
  })
})
