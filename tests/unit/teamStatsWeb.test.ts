import { describe, it, expect, vi, beforeEach } from 'vitest'

// #41b: the web Stats collectives adapters — same Core as the desktop, with the Riot calls cached (shared key).
const h = vi.hoisted(() => ({
  idCalls: [] as string[],
  bodyCalls: [] as string[][],
  members: [] as any[],
  customs: [] as any[],
}))

vi.mock('../../web/src/supabase', () => ({ sb: {} }))
vi.mock('../../web/src/riotWeb', () => ({
  RiotWebError: class RiotWebError extends Error { code?: string },
  getRecentMatchIds: async (puuid: string) => { h.idCalls.push(puuid); return ['EUW1_1', 'EUW1_2', `EUW1_solo_${puuid}`] },
  getAccountByRiotId: async () => ({ puuid: 'resolved' }),
  getMatchesBulk: async (ids: string[]) => {
    h.bodyCalls.push([...ids])
    return new Map(ids.map((id) => [id, {
      info: {
        gameDuration: 1800,
        participants: ['p1', 'p2', 'p3'].map((puuid, i) => ({
          puuid, teamId: 100, win: id === 'EUW1_1', kills: 2, deaths: 1, assists: 3, championName: 'Ahri',
          teamPosition: ['TOP', 'JUNGLE', 'MIDDLE'][i], totalMinionsKilled: 150, goldEarned: 10000, totalDamageDealtToChampions: 15000,
        })),
      },
    }]))
  },
}))
vi.mock('@/lib/teamCore', () => ({
  listGroupTeams: async () => [{ id: 'g1', members: h.members }],
}))
vi.mock('@/lib/teamCustomGamesCore', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/teamCustomGamesCore')>()),
  listGroupCustomGames: async (_sb: unknown, _g: string, type?: string) => h.customs.filter((c) => !type || c.game_type === type),
}))

const web = await import('../../web/src/teamStatsWeb')

const member = (id: string, role: string, puuid: string | null, ign = id) => ({ id, displayName: id, ign, tagLine: 'EUW', region: 'EUW1', role, puuid })

beforeEach(() => {
  h.idCalls.length = 0
  h.bodyCalls.length = 0
  h.members = [member('Top', 'TOP', 'p1'), member('Jgl', 'JUNGLE', 'p2'), member('Mid', 'MID', 'p3')]
  h.customs = []
})

describe('computeTeamSynergyStatsWeb', () => {
  it('aggregates the shared flex games, then serves the bodies from the cache', async () => {
    const first = await web.computeTeamSynergyStatsWeb('g1', 'g1', { minTogether: 3 })
    expect(first.matchCount).toBe(2)
    expect(first.players.map((p) => p.gamesPlayed)).toEqual([2, 2, 2])
    expect(h.bodyCalls.flat().sort()).toEqual(['EUW1_1', 'EUW1_2']) // the solo-only games are never fetched

    h.bodyCalls.length = 0
    h.idCalls.length = 0
    const again = await web.computeTeamSynergyStatsWeb('g1', 'g1', { minTogether: 2 })
    expect(again.matchCount).toBe(2)
    expect(h.bodyCalls).toEqual([]) // bodies cached
    expect(h.idCalls).toEqual([]) // match lists cached for a few minutes
  })

  it('needs enough members with a Riot ID, and only for the own team', async () => {
    h.members = [member('Top', 'TOP', 'p1'), { ...member('Jgl', 'JUNGLE', null), tagLine: null }]
    await expect(web.computeTeamSynergyStatsWeb('g1', 'g1', { minTogether: 3 })).rejects.toThrow(/at least 3/)
    await expect(web.computeTeamSynergyStatsWeb('g1', 'scout-1')).rejects.toThrow(/own team/)
  })
})

describe('custom and combined stats', () => {
  const game = (id: string, type: string) => ({
    id, group_id: 'g1', game_type: type, game_date: null, duration_sec: 1500, win: true, source_file: `${id}.csv`, local_id: null, created_at: 't',
    participants: [{ playerName: 'Top', teamId: 100, win: true, kills: 5, deaths: 0, assists: 1, championName: 'Gnar' }],
  })

  it('reads the group games of one type, read only', async () => {
    h.customs = [game('s1', 'scrim'), game('t1', 'tournament')]
    const list = await web.listCustomGamesWeb('g1', 'g1', 'scrim')
    expect(list.map((g) => g.id)).toEqual(['group:s1'])
    const stats = await web.computeCustomStatsWeb('g1', 'g1', 'tournament')
    expect(stats.matchCount).toBe(1)
    expect(stats.players[0].displayName).toBe('Top')
  })

  it('combines flex and custom games, with the sources', async () => {
    h.customs = [game('s1', 'scrim'), game('t1', 'tournament')]
    const stats = await web.computeCombinedStatsWeb('g1', 'g1', { minTogether: 3 })
    expect(stats.sources).toEqual({ flex: 2, scrim: 1, tournament: 1 })
    expect(stats.matchCount).toBe(2) // custom games with one roster player don't reach minTogether 3
  })
})
