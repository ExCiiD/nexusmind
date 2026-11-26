import { describe, it, expect } from 'vitest'
import { buildHistoryGame, buildWholeSession } from '../../src/lib/teamSessionHistoryCore'
import { buildPlayerStatsSheet, buildSoloPlayerStatsSheet, type SoloGameInput } from '../../src/lib/playerStatsSheetCore'
import type { TeamSessionHistoryDetail } from '../../src/lib/teamSessionHistory'

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const NAMES = ['Kaito', 'Nyra', 'Orel', 'Vex', 'Mira']
const membersOf = (prefix: string) => NAMES.map((n, i) => ({ userId: `${prefix}${i}`, riotId: `${n}#EUW`, displayName: n }))
const MEMBERS = membersOf('u')

/** Our side is team 100. `kills` = our top laner's kills; `sub` replaces our top laner by an unknown name. */
function match(o: { kills?: number; sub?: boolean; start?: number } = {}) {
  const participants = [100, 200].flatMap((teamId) => ROLES.map((pos, i) => ({
    puuid: `${teamId}-${i}`, teamId, teamPosition: pos, championName: teamId === 100 ? `Champ${i}` : `Foe${i}`,
    kills: teamId === 100 && i === 0 ? (o.kills ?? 4) : 1, deaths: 2, assists: 3, win: teamId === 100,
    totalMinionsKilled: 180, neutralMinionsKilled: 0, totalDamageDealtToChampions: 15000, goldEarned: 10000, visionScore: 20,
    riotIdGameName: teamId === 100 ? (o.sub && i === 0 ? 'Substitute' : NAMES[i]) : `Enemy${i}`,
  })))
  return { info: { gameDuration: 1800, gameStartTimestamp: o.start ?? 1_700_000_000_000, participants, teams: [{ teamId: 100, win: true }, { teamId: 200, win: false }] } }
}
const input = (id: string, json: unknown, status: 'pending_fetch' | 'fetched' | 'error' = 'fetched') =>
  ({ id, matchId: `EUW1_${id}`, status, matchJson: json, ourTeamId: 100 as const, enemyTeamName: 'Aegis', timelineSummary: null })

function detailOf(inputs: Array<ReturnType<typeof input>>, members = MEMBERS): Pick<TeamSessionHistoryDetail, 'games' | 'whole'> {
  const games = inputs.map((g, i) => buildHistoryGame(g, i + 1, members))
  return { games, whole: buildWholeSession(games) }
}

describe('team session sheet', () => {
  const detail = detailOf([input('a', match({ kills: 2 })), input('b', match({ kills: 6 })), input('c', match({ kills: 10 }))])

  it('one player, several games: session line is the mean over the games, with the lane duel and the series', () => {
    const s = buildPlayerStatsSheet(detail, 'u0', null)
    expect(s).toMatchObject({ source: 'team', status: 'ready', playerFound: true, gameIndex: null, gamesCounted: 3, gamesTotal: 3, gamesWithStats: 3, partial: false })
    expect(s.line!.averages.kills).toBe(6)
    expect(s.averages).toBe(s.line!.averages)
    expect(s.line!.gamesPlayed).toBe(3)
    expect(s.duel!.our!.memberId).toBe('u0')
    expect(s.duel!.enemy!.displayName).toBe('Enemy0')
    expect(s.series.map((p) => p.kills)).toEqual([2, 6, 10])
    expect(s.series.map((p) => [p.index, p.status, p.played, p.win])).toEqual([[1, 'ready', true, true], [2, 'ready', true, true], [3, 'ready', true, true]])
  })

  it('one game: that game\'s line and duel; the series still lists every game', () => {
    const s = buildPlayerStatsSheet(detail, 'u0', 2)
    expect(s).toMatchObject({ status: 'ready', gameIndex: 2, gamesCounted: 1, playerFound: true })
    expect(s.line!.averages.kills).toBe(6)
    expect(s.duel!.our!.averages.kills).toBe(6)
    expect(s.series).toHaveLength(3)
  })

  it('a game without stats: not counted, null in the series, the others still averaged', () => {
    const d = detailOf([input('a', match({ kills: 2 })), input('b', null, 'pending_fetch'), input('c', null, 'error'), input('d', match({ kills: 6 }))])
    const s = buildPlayerStatsSheet(d, 'u0', null)
    expect(s.status).toBe('ready')
    expect(s.gamesCounted).toBe(2)
    expect(s.gamesTotal).toBe(4)
    expect(s.gamesWithStats).toBe(2)
    expect(s.line!.averages.kills).toBe(4)
    expect(s.series.map((p) => p.status)).toEqual(['ready', 'not-fetched', 'error', 'ready'])
    expect(s.series[1]).toMatchObject({ played: false, kills: null, kda: null, win: null })
    const one = buildPlayerStatsSheet(d, 'u0', 2)
    expect(one).toMatchObject({ status: 'not-fetched', playerFound: false, line: null, duel: null, averages: null, gamesCounted: 0 })
    expect(buildPlayerStatsSheet(d, 'u0', 3).status).toBe('error')
  })

  it('no game with stats: the session has no line and the status says why', () => {
    expect(buildPlayerStatsSheet(detailOf([input('a', null, 'pending_fetch')]), 'u0', null)).toMatchObject({ status: 'not-fetched', line: null, gamesCounted: 0, gamesWithStats: 0 })
    expect(buildPlayerStatsSheet(detailOf([input('a', null, 'error')]), 'u0', null).status).toBe('error')
    expect(buildPlayerStatsSheet(detailOf([]), 'u0', null)).toMatchObject({ status: 'no-data', gamesTotal: 0, series: [] })
  })

  it('our side not found: no-side', () => {
    const d = detailOf([{ ...input('a', match()), ourTeamId: null as any }], membersOf('x').map((m) => ({ ...m, riotId: 'Nobody#EUW' })))
    expect(d.games[0].stats).toBe('no-side')
    expect(buildPlayerStatsSheet(d, 'x0', 1).status).toBe('no-side')
    expect(buildPlayerStatsSheet(d, 'x0', null).status).toBe('no-side')
  })

  it('a player absent from a game: that game is ready without a line for him; the session counts only the games he played', () => {
    const d = detailOf([input('a', match({ kills: 2 })), input('b', match({ sub: true })), input('c', match({ kills: 6 }))])
    const s = buildPlayerStatsSheet(d, 'u0', null)
    expect(s.gamesCounted).toBe(2)
    expect(s.gamesWithStats).toBe(3)
    expect(s.line!.averages.kills).toBe(4)
    expect(s.series.map((p) => p.played)).toEqual([true, false, true])
    expect(s.series[1]).toMatchObject({ status: 'ready', kills: null })
    expect(buildPlayerStatsSheet(d, 'u0', 2)).toMatchObject({ status: 'ready', playerFound: false, line: null, duel: null, gamesCounted: 0 })
    // a mate who played all three is unaffected
    expect(buildPlayerStatsSheet(d, 'u1', null).gamesCounted).toBe(3)
  })

  it('a user who is not in the session at all, and an unknown game index', () => {
    expect(buildPlayerStatsSheet(detail, 'stranger', null)).toMatchObject({ status: 'ready', playerFound: false, line: null, duel: null, gamesCounted: 0 })
    expect(buildPlayerStatsSheet(detail, 'u0', 9)).toMatchObject({ status: 'unknown-game', playerFound: false, line: null })
  })

  it('a user in several groups: each session\'s detail gives its own sheet, nothing leaks between them', () => {
    // Same person (user id "me") plays top in group A (kills 2) and mid in group B (a different roster, kills 8).
    const rosterA = membersOf('a').map((m, i) => (i === 0 ? { ...m, userId: 'me' } : m))
    const rosterB = membersOf('b').map((m, i) => (i === 2 ? { ...m, userId: 'me' } : m))
    const dA = detailOf([input('a1', match({ kills: 2 }))], rosterA)
    const mB = match({ kills: 1 })
    mB.info.participants[2].kills = 8 // Orel, MID, team 100
    const dB = detailOf([input('b1', mB), input('b2', mB)], rosterB)
    const sA = buildPlayerStatsSheet(dA, 'me', null), sB = buildPlayerStatsSheet(dB, 'me', null)
    expect([sA.line!.role, sA.line!.averages.kills, sA.gamesCounted]).toEqual(['TOP', 2, 1])
    expect([sB.line!.role, sB.line!.averages.kills, sB.gamesCounted]).toEqual(['MID', 8, 2])
    expect(sA.duel!.enemy!.role).toBe('TOP')
    expect(sB.duel!.enemy!.role).toBe('MID')
    // A teammate of group A is not "me" in group B.
    expect(buildPlayerStatsSheet(dB, 'a1', null).playerFound).toBe(false)
  })

  it('does not mutate the detail', () => {
    const before = JSON.stringify(detail)
    buildPlayerStatsSheet(detail, 'u0', null); buildPlayerStatsSheet(detail, 'u0', 1)
    expect(JSON.stringify(detail)).toBe(before)
  })
})

describe('solo session sheet', () => {
  const g = (id: string, end: string, o: Partial<SoloGameInput> = {}): SoloGameInput => ({
    id, champion: 'Ahri', role: 'MID', win: true, kills: 4, deaths: 2, assists: 6, cs: 180, visionScore: 20, duration: 1800, gameEndAt: end, ...o,
  })
  // Stored newest first, like the store.
  const games = [g('c', '2026-11-26T12:00:00Z', { kills: 10, win: false }), g('b', '2026-11-26T11:00:00Z', { kills: 6 }), g('a', '2026-11-26T10:00:00Z', { kills: 2 })]

  it('whole session: means over the games, ordered by end time, no duel, partial', () => {
    const s = buildSoloPlayerStatsSheet(games, 'me', null)
    expect(s).toMatchObject({ source: 'solo', status: 'ready', playerFound: true, gamesCounted: 3, gamesTotal: 3, gamesWithStats: 3, partial: true, duel: null })
    expect(s.line!.averages.kills).toBe(6)
    expect(s.line!.averages.csPerMin).toBeCloseTo(6)
    expect(s.line!.wins).toBe(2)
    expect(s.line!.memberId).toBe('me')
    expect(s.series.map((p) => [p.gameId, p.index, p.kills])).toEqual([['a', 1, 2], ['b', 2, 6], ['c', 3, 10]])
    expect(s.missing).toContain('goldPerMin')
    expect(s.missing).toContain('duel')
  })

  it('one game', () => {
    const s = buildSoloPlayerStatsSheet(games, 'me', 3)
    expect(s).toMatchObject({ status: 'ready', gameIndex: 3, gamesCounted: 1 })
    expect(s.line!.averages.kills).toBe(10)
    expect(s.line!.winRate).toBe(0)
    expect(s.series).toHaveLength(3)
  })

  it('a game without stored stats is not-fetched and left out of the means', () => {
    const s = buildSoloPlayerStatsSheet([...games, g('d', '2026-11-26T13:00:00Z', { kills: undefined, deaths: undefined, assists: undefined })], 'me', null)
    expect(s.gamesCounted).toBe(3)
    expect(s.gamesTotal).toBe(4)
    expect(s.series[3]).toMatchObject({ status: 'not-fetched', played: false, kills: null })
    expect(buildSoloPlayerStatsSheet([g('d', '2026-11-26T13:00:00Z', { kills: undefined })], 'me', 1)).toMatchObject({ status: 'not-fetched', line: null })
  })

  it('empty session and unknown index', () => {
    expect(buildSoloPlayerStatsSheet([], 'me', null)).toMatchObject({ status: 'no-data', line: null, series: [] })
    expect(buildSoloPlayerStatsSheet(games, 'me', 7)).toMatchObject({ status: 'unknown-game', line: null })
  })
})
