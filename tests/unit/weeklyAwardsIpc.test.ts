/**
 * Integration: electron/main/weeklyAwards.ts on a throw-away SQLite database
 * (every migration applied), Riot replaced by fixtures. Covers the read of a
 * team (PUUID lookup, game listing and scoring, rank readings, stored weeks)
 * and what team:weekly-awards returns.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync, rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-awards-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root, handlers: new Map<string, (...args: unknown[]) => unknown>(), matches: new Map<string, any>() }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '0.0.0-test' },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn), on: () => {} },
}))

vi.mock('../../electron/main/riotTransport', () => ({
  RiotAuthError: class RiotAuthError extends Error {
    constructor(public readonly code: string, message: string) { super(message) }
  },
}))

const LEAGUE: Record<string, unknown[]> = {
  pa: [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'I', leaguePoints: 50, wins: 30, losses: 20 }],
  pb: [{ queueType: 'RANKED_SOLO_5x5', tier: 'PLATINUM', rank: 'IV', leaguePoints: 20, wins: 40, losses: 35 }],
}

vi.mock('../../electron/main/riotClient', () => ({
  getAccountByRiotId: vi.fn(async (name: string) => {
    if (name === 'Bee') return { puuid: 'pb', gameName: 'Bee', tagLine: 'EUW' }
    throw new Error('Account not found (404).')
  }),
  getLeagueEntriesByPuuid: vi.fn(async (puuid: string) => LEAGUE[puuid] ?? []),
  getMatch: vi.fn(async (id: string) => {
    const m = h.matches.get(id)
    if (!m) throw new Error('Riot API error 404: Not Found')
    return m
  }),
  getMatchIdsInRange: vi.fn(async (puuid: string, _region: string, queue: number, startSec: number) =>
    [...h.matches.values()]
      .filter((m) => m.info.queueId === queue && m.info.gameStartTimestamp >= startSec * 1000)
      .filter((m) => m.info.participants.some((p: any) => p.puuid === puuid))
      .map((m) => m.metadata.matchId)),
}))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import * as riot from '../../electron/main/riotClient'
import { getWeeklyAwards, recordRankSnapshots } from '../../electron/main/weeklyAwards'
import { registerWeeklyAwardsHandlers } from '../../electron/main/ipc/weeklyAwards.ipc'
import { MVP_RULE_VERSION, ROLE_NORMS, type ScoreRole } from '../../src/lib/weeklyAwardsCore'

// Thursday 19 November 2026, 15:00 local: last week 2026-11-09, current 2026-11-16.
const NOW = new Date(2026, 10, 19, 15, 0)
const day = (d: number, hour = 20) => new Date(2026, 10, d, hour).getTime()
const POSITION: Record<ScoreRole, string> = { TOP: 'TOP', JUNGLE: 'JUNGLE', MID: 'MIDDLE', ADC: 'BOTTOM', SUPPORT: 'UTILITY' }
const ROLES: ScoreRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']

/** A 30-minute game, blue side wins; `stars` play on blue, the rest of the
 *  lobby sits at its role's median. */
function addMatch(id: string, startMs: number, queueId: number, stars: Array<{ puuid: string; role: ScoreRole; boost: number }>) {
  const participant = (puuid: string, teamId: number, role: ScoreRole, boost: number) => {
    const n = ROLE_NORMS[role]
    return {
      puuid, teamId, teamPosition: POSITION[role], win: teamId === 100, gameEndedInEarlySurrender: false,
      kills: 100 * n.kp * boost, deaths: (100 * n.kp) / n.kda, assists: 0,
      totalDamageDealtToChampions: n.damage * 10_000 * boost, goldEarned: n.gold * 30 * boost,
      totalMinionsKilled: n.cs * 30 * boost, neutralMinionsKilled: 0, visionScore: n.vision * 30 * boost,
    }
  }
  const participants = ROLES.flatMap((role) => {
    const star = stars.find((s) => s.role === role)
    return [participant(star?.puuid ?? `${id}-blue-${role}`, 100, role, star?.boost ?? 1), participant(`${id}-red-${role}`, 200, role, 1)]
  })
  h.matches.set(id, { metadata: { matchId: id }, info: { queueId, gameDuration: 1800, gameCreation: startMs - 60_000, gameStartTimestamp: startMs, participants } })
}

let teamId = ''
const ids: Record<string, string> = {}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await initDatabase()
  registerWeeklyAwardsHandlers()
  const prisma = getPrisma()
  const user = await prisma.user.create({ data: { summonerName: 'Coach', puuid: 'puuid-coach', region: 'EUW1', nextAssessmentAt: new Date() } })
  const team = await prisma.team.create({ data: { userId: user.id, name: 'Aegis' } })
  teamId = team.id
  ids.a = (await prisma.teamMember.create({ data: { teamId, displayName: 'Ana', ign: 'Ana', tagLine: 'EUW', region: 'EUW1', role: 'MID', puuid: 'pa' } })).id
  ids.b = (await prisma.teamMember.create({ data: { teamId, displayName: 'Bee', ign: 'Bee', tagLine: 'EUW', region: 'EUW1', role: 'ADC' } })).id
  ids.c = (await prisma.teamMember.create({ data: { teamId, displayName: 'Cid', role: 'SUPPORT', region: 'EUW1', puuid: 'pc' } })).id

  // Last week: Ana carries three Flex games with Bee and Cid (team games: 3 of
  // the roster on the same side). This week: Bee plays three Solo/Duo games,
  // Ana one: no team game, so no MVP race (#46).
  for (const [i, d] of [10, 11, 12].entries()) {
    addMatch(`EUW1_10${i}`, day(d), 440, [{ puuid: 'pa', role: 'MID', boost: 2 }, { puuid: 'pb', role: 'ADC', boost: 1 }, { puuid: 'pc', role: 'SUPPORT', boost: 1 }])
  }
  for (const [i, d] of [16, 17, 18].entries()) addMatch(`EUW1_20${i}`, day(d), 420, [{ puuid: 'pb', role: 'ADC', boost: 1 }])
  addMatch('EUW1_300', day(18), 420, [{ puuid: 'pa', role: 'MID', boost: 1.5 }])
  addMatch('EUW1_400', day(17), 450, [{ puuid: 'pa', role: 'MID', boost: 3 }]) // ARAM: never listed

  // Rank readings of last week: Bee climbs from Gold I 60 to Platinum IV 20
  // (+60 LP) in 8 games, Ana drops 20 LP.
  await recordRankSnapshots([
    { puuid: 'pb', at: day(8), ranks: { solo: { queue: 'solo', tier: 'GOLD', division: 'I', lp: 60, wins: 30, losses: 33 }, flex: null } },
    { puuid: 'pa', at: day(8), ranks: { solo: { queue: 'solo', tier: 'GOLD', division: 'I', lp: 50, wins: 25, losses: 20 }, flex: null } },
    { puuid: 'pb', at: day(14), ranks: { solo: { queue: 'solo', tier: 'PLATINUM', division: 'IV', lp: 20, wins: 36, losses: 35 }, flex: null } },
    { puuid: 'pa', at: day(14), ranks: { solo: { queue: 'solo', tier: 'GOLD', division: 'I', lp: 30, wins: 26, losses: 21 }, flex: null } },
  ])
}, 60_000)

afterAll(async () => {
  vi.useRealTimers()
  await closeDatabase()
  try { rmSync(h.root, { recursive: true, force: true }) } catch { /* Windows may hold the file */ }
})

describe('team:weekly-awards', () => {
  it("reads the team, then shows last week's MVP and Grinder", async () => {
    const handler = h.handlers.get('team:weekly-awards')!
    const awards: any = await handler({}, teamId)
    const lastMonday = new Date(2026, 10, 9).toISOString()

    expect(awards.holders).toHaveLength(2)
    expect(awards.holders[0]).toMatchObject({ kind: 'mvp', memberId: ids.a, weekStart: lastMonday, live: false, games: 3, streak: 1 })
    expect(awards.holders[0].value).toBeGreaterThan(90)
    // Gold I 60 → Platinum IV 20: 40 LP to promote, then 20.
    expect(awards.holders[1]).toEqual({ kind: 'grinder', memberId: ids.b, weekStart: lastMonday, live: false, value: 60, games: 8, streak: 1 })
    expect(awards.totals).toEqual({ [ids.a]: { mvp: 1, grinder: 0 }, [ids.b]: { mvp: 0, grinder: 1 }, [ids.c]: { mvp: 0, grinder: 0 } })

    // This week: only Solo/Duo games, none played together: no MVP race (#46,
    // before it Bee led it with three solo games). Ana is +20 LP since
    // Saturday, Bee played four games for no LP.
    expect(awards.race.mvp).toEqual([])
    expect(awards.race.grinder).toEqual([
      { memberId: ids.a, value: 20, games: 3 },
      { memberId: ids.b, value: 0, games: 4 },
    ])
    expect(awards.computedAt).toBe(NOW.toISOString())
  })

  it('kept the PUUID it looked up, the match bodies and the scores', async () => {
    const prisma = getPrisma()
    expect((await prisma.teamMember.findUnique({ where: { id: ids.b } }))?.puuid).toBe('pb')
    expect(await prisma.matchCache.count()).toBe(7)
    expect(await prisma.playerGameScore.count({ where: { puuid: 'pa' } })).toBe(4)
    expect(await prisma.playerGameScore.count({ where: { puuid: 'pb' } })).toBe(6)
    expect(await prisma.playerGameScore.count({ where: { puuid: 'pc' } })).toBe(3)
    expect(riot.getMatch).toHaveBeenCalledTimes(7)
  })

  it('stored the last four weeks, with no winner where nobody played', async () => {
    const rows = await getPrisma().teamWeeklyAward.findMany({ where: { teamId }, orderBy: [{ weekKey: 'asc' }, { kind: 'asc' }] })
    expect(rows.map((r) => `${r.weekKey} ${r.kind} ${r.memberId ?? '-'}`)).toEqual([
      '2026-10-19 grinder -', '2026-10-19 mvp -',
      '2026-10-26 grinder -', '2026-10-26 mvp -',
      '2026-11-02 grinder -', '2026-11-02 mvp -',
      `2026-11-09 grinder ${ids.b}`, `2026-11-09 mvp ${ids.a}`,
    ])
    expect(JSON.parse(rows[7].raceJson!)[0]).toMatchObject({ memberId: ids.a, games: 3 })
  })

  it('#46: records that the stored MVP weeks follow the team-games rule (purged once, not at every start)', () => {
    const rule = JSON.parse(readFileSync(join(h.root, 'userData', 'weekly-awards-rule.json'), 'utf-8'))
    expect(rule).toEqual({ mvpRule: MVP_RULE_VERSION })
  })

  it('answers from the database while the data is fresh', async () => {
    const calls = vi.mocked(riot.getMatchIdsInRange).mock.calls.length
    const awards = await getWeeklyAwards(teamId)
    expect(awards.holders.map((x) => x.kind)).toEqual(['mvp', 'grinder'])
    expect(vi.mocked(riot.getMatchIdsInRange).mock.calls.length).toBe(calls)
  })

  it('gives nothing to an opponent team and reads nothing for it', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirstOrThrow()
    const rival = await prisma.team.create({ data: { userId: user.id, name: 'Rivals', isOpponent: true } })
    await prisma.teamMember.create({ data: { teamId: rival.id, displayName: 'Ana', role: 'MID', puuid: 'pa', region: 'EUW1' } })
    const calls = vi.mocked(riot.getMatchIdsInRange).mock.calls.length
    const awards = await getWeeklyAwards(rival.id)
    expect(awards.holders).toEqual([])
    expect(awards.race).toEqual({ mvp: [], grinder: [] })
    expect(vi.mocked(riot.getMatchIdsInRange).mock.calls.length).toBe(calls)
  })

  it('rejects an unknown team and a malformed id', async () => {
    await expect(getWeeklyAwards('nope')).rejects.toThrow(/Team not found/)
    await expect(h.handlers.get('team:weekly-awards')!({}, '../x')).rejects.toThrow(/Invalid input/)
  })
})

describe('recordRankSnapshots', () => {
  const reading = (lp: number, wins: number) => ({ solo: { queue: 'solo' as const, tier: 'SILVER' as const, division: 'II' as const, lp, wins, losses: 10 }, flex: null })

  it('keeps one row per reading and moves its last-seen time', async () => {
    const prisma = getPrisma()
    await recordRankSnapshots([{ puuid: 'pz', at: day(17, 10), ranks: reading(40, 12) }])
    await recordRankSnapshots([{ puuid: 'pz', at: day(17, 14), ranks: reading(40, 12) }])
    let rows = await prisma.rankSnapshot.findMany({ where: { puuid: 'pz' } })
    expect(rows).toHaveLength(1)
    expect(rows[0].takenAt.getTime()).toBe(day(17, 10))
    expect(rows[0].seenAt.getTime()).toBe(day(17, 14))
    expect(rows[0].ladder).toBe(2 * 400 + 2 * 100 + 40)

    await recordRankSnapshots([{ puuid: 'pz', at: day(17, 18), ranks: reading(58, 13) }])
    // Older than the last reading: dropped. Unranked: nothing stored.
    await recordRankSnapshots([{ puuid: 'pz', at: day(17, 12), ranks: reading(10, 11) }])
    await recordRankSnapshots([{ puuid: 'pu', ranks: { solo: null, flex: null } }])
    rows = await prisma.rankSnapshot.findMany({ where: { puuid: 'pz' }, orderBy: { takenAt: 'asc' } })
    expect(rows.map((r) => r.lp)).toEqual([40, 58])
    expect(await prisma.rankSnapshot.count({ where: { puuid: 'pu' } })).toBe(0)
  })
})
