import { describe, it, expect } from 'vitest'
import {
  resolveOurTeamId, buildSideStats, buildHeaderSummary, buildDuelRows, matchParticipantToMember,
  type RiotMatchParticipant,
} from '../../src/lib/teamSessionStatsCore'

function participant(overrides: Partial<RiotMatchParticipant>): RiotMatchParticipant {
  return {
    puuid: 'puuid-default',
    teamId: 100,
    teamPosition: 'TOP',
    championName: 'Garen',
    kills: 5, deaths: 2, assists: 3,
    win: true,
    totalMinionsKilled: 150, neutralMinionsKilled: 10,
    totalDamageDealtToChampions: 20000, totalDamageTaken: 15000,
    timeCCingOthers: 20, visionScore: 30,
    wardsPlaced: 10, wardsKilled: 2, detectorWardsPurchased: 1,
    goldEarned: 12000, champExperience: 10000,
    riotIdGameName: 'PlayerOne', riotIdTagline: 'EUW',
    ...overrides,
  }
}

describe('resolveOurTeamId', () => {
  it('picks the side whose participants match the most member Riot IDs', () => {
    const participants = [
      participant({ teamId: 100, riotIdGameName: 'Alice' }),
      participant({ teamId: 100, riotIdGameName: 'Bob' }),
      participant({ teamId: 200, riotIdGameName: 'Mallory' }),
    ]
    expect(resolveOurTeamId(participants, ['Alice#EUW', 'Bob#EUW'])).toBe(100)
  })

  it('returns null when no participant matches any member Riot ID', () => {
    const participants = [participant({ teamId: 100, riotIdGameName: 'Stranger' })]
    expect(resolveOurTeamId(participants, ['Alice#EUW'])).toBeNull()
  })

  it('ignores the #tag suffix and is case-insensitive', () => {
    const participants = [participant({ teamId: 200, riotIdGameName: 'aLiCe' })]
    expect(resolveOurTeamId(participants, ['Alice#EUW1'])).toBe(200)
  })
})

describe('matchParticipantToMember', () => {
  it('matches by game-name, ignoring the tag and case', () => {
    const p = participant({ riotIdGameName: 'aLiCe' })
    const members = [{ userId: 'u1', riotId: 'Alice#EUW', displayName: 'Alice D.' }]
    expect(matchParticipantToMember(p, members)?.userId).toBe('u1')
  })

  it('returns undefined when nobody matches', () => {
    const p = participant({ riotIdGameName: 'Nobody' })
    const members = [{ userId: 'u1', riotId: 'Alice#EUW', displayName: 'Alice D.' }]
    expect(matchParticipantToMember(p, members)).toBeUndefined()
  })
})

describe('buildSideStats', () => {
  it('produces a single-game SynergyPlayerStats row per participant', () => {
    const p = participant({})
    const [row] = buildSideStats([p], 1800, (pp) => ({ id: pp.puuid, displayName: pp.riotIdGameName! }))
    expect(row.gamesPlayed).toBe(1)
    expect(row.winRate).toBe(100)
    expect(row.averages.kda).toBeCloseTo((5 + 3) / 2)
    expect(row.averages.cs).toBe(160)
    expect(row.role).toBe('TOP')
    expect(row.byChampion).toEqual([{ championKey: 'Garen', games: 1, wins: 1, winRate: 100 }])
  })

  it('computes shares relative to the side total, not a hardcoded denominator', () => {
    const p1 = participant({ puuid: 'p1', goldEarned: 10000, riotIdGameName: 'A' })
    const p2 = participant({ puuid: 'p2', goldEarned: 30000, riotIdGameName: 'B' })
    const [r1, r2] = buildSideStats([p1, p2], 1800, (pp) => ({ id: pp.puuid, displayName: pp.riotIdGameName! }))
    expect(r1.shares.goldPct).toBeCloseTo(25)
    expect(r2.shares.goldPct).toBeCloseTo(75)
  })

  it('returns an empty array for an empty or zero-duration match', () => {
    expect(buildSideStats([], 1800, (p) => ({ id: p.puuid, displayName: 'x' }))).toEqual([])
    expect(buildSideStats([participant({})], 0, (p) => ({ id: p.puuid, displayName: 'x' }))).toEqual([])
  })
})

describe('buildHeaderSummary', () => {
  it('sums kills/deaths/assists/gold/vision/damage per side', () => {
    const our = buildSideStats(
      [participant({ puuid: 'o1', kills: 5 }), participant({ puuid: 'o2', kills: 3 })],
      1800, (p) => ({ id: p.puuid, displayName: p.riotIdGameName! }),
    )
    const enemy = buildSideStats(
      [participant({ puuid: 'e1', teamId: 200, kills: 1, win: false })],
      1800, (p) => ({ id: p.puuid, displayName: p.riotIdGameName! }),
    )
    const header = buildHeaderSummary(our, enemy, 1800, true)
    expect(header.ourWin).toBe(true)
    expect(header.our.kills).toBe(8)
    expect(header.enemy.kills).toBe(1)
    expect(header.durationSec).toBe(1800)
  })
})

describe('buildDuelRows', () => {
  it('pairs both sides by normalized lane, leaving unmatched roles null', () => {
    const our = buildSideStats(
      [participant({ puuid: 'o1', teamPosition: 'TOP' }), participant({ puuid: 'o2', teamPosition: 'JUNGLE' })],
      1800, (p) => ({ id: p.puuid, displayName: p.riotIdGameName! }),
    )
    const enemy = buildSideStats(
      [participant({ puuid: 'e1', teamId: 200, teamPosition: 'TOP' })],
      1800, (p) => ({ id: p.puuid, displayName: p.riotIdGameName! }),
    )
    const rows = buildDuelRows(our, enemy)
    const top = rows.find((r) => r.role === 'TOP')!
    const jungle = rows.find((r) => r.role === 'JUNGLE')!
    const support = rows.find((r) => r.role === 'SUPPORT')!
    expect(top.our?.memberId).toBe('o1')
    expect(top.enemy?.memberId).toBe('e1')
    expect(jungle.our?.memberId).toBe('o2')
    expect(jungle.enemy).toBeNull()
    expect(support.our).toBeNull()
    expect(support.enemy).toBeNull()
  })
})
