/**
 * AUDIT_PERF_2, beta.19: the detailed-stats loop (gain 2), its stored memo (gain 1), the match summaries (gain 7)
 * and compressed timelines through matchStore (gain 6), on an in-memory MatchCache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  cache: new Map<string, { matchJson: string; timelineJson: string | null }>(),
  memo: new Map<string, { version: number; statsJson: string }>(),
  summaries: new Map<string, { version: number; statsJson: string; gameEndAt: Date | null }>(),
  getMatch: [] as Array<[string, string]>,
  getTimeline: [] as Array<[string, string]>,
  priorities: [] as string[],
  active: 0,
  maxActive: 0,
}))

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: { getPath: () => '' }, BrowserWindow: { getAllWindows: () => [] } }))

/** A match where `puuid` played `role`, ended at `end`. */
const match = (id: string, puuid: string, role: string, end: number) => ({
  metadata: { matchId: id },
  info: {
    gameEndTimestamp: end, gameDuration: 1800, queueId: 420, gameMode: 'CLASSIC',
    participants: [{ puuid, teamPosition: role, championName: 'Ahri', kills: 5, deaths: 2, assists: 7, totalMinionsKilled: 200, neutralMinionsKilled: 10, visionScore: 20, win: true, teamId: 100 }],
  },
})
const REMOTE: Record<string, any> = {
  EUW1_1: match('EUW1_1', 'me', 'MIDDLE', 5000),
  SG2_2: match('SG2_2', 'me', 'MIDDLE', 4000),
  EUW1_3: match('EUW1_3', 'me', 'TOP', 3000),
  EUW1_4: match('EUW1_4', 'me', 'MIDDLE', 2000),
  EUW1_5: match('EUW1_5', 'me', 'MIDDLE', 1000),
  EUW1_6: match('EUW1_6', 'me', 'MIDDLE', 900),
}

vi.mock('../../electron/main/riotClient', async () => {
  const { currentRiotPriority } = await vi.importActual<typeof import('../../electron/main/riotPriority')>('../../electron/main/riotPriority')
  const slow = async <T>(v: T) => {
    h.active++; h.maxActive = Math.max(h.maxActive, h.active)
    await new Promise((r) => setTimeout(r, 5))
    h.active--
    return v
  }
  return {
    getMatch: vi.fn(async (id: string, region: string) => { h.getMatch.push([id, region]); h.priorities.push(currentRiotPriority()); return slow(structuredClone(REMOTE[id])) }),
    getMatchTimeline: vi.fn(async (id: string, region: string) => { h.getTimeline.push([id, region]); return slow({ metadata: { matchId: id }, info: { frames: [{ timestamp: 0 }] } }) }),
    getAccountByRiotId: vi.fn(),
    extractPlayerStats: (m: any, puuid: string) => {
      const p = m.info.participants.find((x: any) => x.puuid === puuid)
      return p ? { champion: p.championName, role: p.teamPosition, kills: p.kills, deaths: p.deaths, assists: p.assists, cs: 210, visionScore: 20, duration: m.info.gameDuration, win: p.win, gameEndAt: new Date(m.info.gameEndTimestamp), matchId: m.metadata.matchId, opponentChampion: null, queueId: 420, gameMode: 'CLASSIC', queueType: 'soloq' } : null
    },
    extractDetailedStats: (m: any, _t: any, puuid: string) => {
      const p = m.info.participants.find((x: any) => x.puuid === puuid)
      return p ? { meta: { role: p.teamPosition, matchId: m.metadata.matchId, gameEndAt: m.info.gameEndTimestamp } } : null
    },
  }
})
vi.mock('../../electron/main/matchIdsCache', () => ({ getMatchIdsCached: vi.fn(async () => []) }))

const prisma = {
  user: { findMany: async () => [{ puuid: 'me' }] },
  account: { findMany: async () => [] },
  matchCache: {
    findUnique: async ({ where, select }: any) => {
      const r = h.cache.get(where.matchId)
      if (!r) return null
      return select ? Object.fromEntries(Object.keys(select).map((k) => [k, (r as any)[k] ?? null])) : { matchId: where.matchId, ...r }
    },
    upsert: async ({ where, create, update }: any) => {
      const r = h.cache.get(where.matchId)
      h.cache.set(where.matchId, r ? { ...r, ...update } : { matchJson: create.matchJson, timelineJson: create.timelineJson ?? null })
      return {}
    },
    update: async ({ where, data }: any) => { h.cache.set(where.matchId, { ...h.cache.get(where.matchId)!, ...data }); return {} },
    updateMany: async ({ where, data }: any) => {
      const r = h.cache.get(where.matchId)
      if (r && r.timelineJson === where.timelineJson) h.cache.set(where.matchId, { ...r, ...data })
      return { count: 1 }
    },
  },
  detailedStatsMemo: {
    findMany: async ({ where }: any) => [...h.memo].filter(([k, v]) => where.matchId.in.includes(k.split('|')[0]) && where.puuid.in.includes(k.split('|')[1]) && v.version === where.version)
      .map(([k, v]) => ({ matchId: k.split('|')[0], puuid: k.split('|')[1], ...v })),
    upsert: async ({ where, create }: any) => { h.memo.set(`${where.matchId_puuid.matchId}|${where.matchId_puuid.puuid}`, { version: create.version, statsJson: create.statsJson }); return {} },
  },
  matchSummary: {
    findMany: async ({ where }: any) => [...h.summaries].filter(([k, v]) => where.matchId.in.includes(k.split('|')[0]) && where.puuid.in.includes(k.split('|')[1]) && v.version === where.version)
      .map(([k, v]) => ({ matchId: k.split('|')[0], puuid: k.split('|')[1], ...v })),
    upsert: async ({ where, create }: any) => { h.summaries.set(`${where.matchId_puuid.matchId}|${where.matchId_puuid.puuid}`, { version: create.version, statsJson: create.statsJson, gameEndAt: create.gameEndAt }); return {} },
  },
}
vi.mock('../../electron/main/database', () => ({ getPrisma: () => prisma }))

import { fetchDetailedStatsForMatches, roleInMatch } from '../../electron/main/ipc/stats.ipc'
import { clearDetailedStatsMemo } from '../../electron/main/detailedStatsMemo'
import { readSummaries, readTimelineJson, saveMatch, SUMMARY_VERSION } from '../../electron/main/matchStore'
import { isCompressedTimeline } from '../../electron/main/matchStoreCore'
import { DETAILED_STATS_VERSION } from '../../electron/main/detailedStatsStore'

const IDS = ['EUW1_1', 'SG2_2', 'EUW1_3', 'EUW1_4', 'EUW1_5', 'EUW1_6']

beforeEach(() => {
  h.cache.clear(); h.memo.clear(); h.summaries.clear()
  h.getMatch.length = 0; h.getTimeline.length = 0; h.priorities.length = 0; h.maxActive = 0
  clearDetailedStatsMemo()
})

describe('gain 2: the detailed-stats loop', () => {
  it('asks Riot on the server of each match id, 4 at a time, under the given priority', async () => {
    const out = await fetchDetailedStatsForMatches(prisma as any, IDS, ['me'], 'EUW1', null, 10, 'background')
    expect(out).toHaveLength(6)
    expect(h.getMatch.find(([id]) => id === 'SG2_2')![1]).toBe('SG2') // not the main account's EUW1
    expect(h.maxActive).toBeLessThanOrEqual(4)
    expect(h.maxActive).toBeGreaterThan(1)
    expect(new Set(h.priorities)).toEqual(new Set(['background']))
  })

  it('reads the role in the match body BEFORE the timeline: another role downloads no timeline', async () => {
    const out = await fetchDetailedStatsForMatches(prisma as any, IDS, ['me'], 'EUW1', 'MIDDLE', 10)
    expect(out.map((s) => s.meta.matchId)).toEqual(['EUW1_1', 'SG2_2', 'EUW1_4', 'EUW1_5', 'EUW1_6'])
    expect(h.getTimeline.map(([id]) => id)).not.toContain('EUW1_3')
    expect(roleInMatch(REMOTE.EUW1_3, 'me')).toBe('TOP')
  })

  it('keeps the order of the ids and stops at the limit', async () => {
    const out = await fetchDetailedStatsForMatches(prisma as any, IDS, ['me'], 'EUW1', null, 2)
    expect(out.map((s) => s.meta.matchId)).toEqual(['EUW1_1', 'SG2_2'])
    expect(h.getMatch.length).toBeLessThanOrEqual(4) // one window, not the whole list
  })
})

describe('gain 1: the stored memo survives a restart', () => {
  it('a second run after a restart (RAM memo gone) reads neither Riot nor MatchCache', async () => {
    await fetchDetailedStatsForMatches(prisma as any, IDS, ['me'], 'EUW1', null, 10)
    expect(h.memo.size).toBe(6)
    clearDetailedStatsMemo() // restart
    h.getMatch.length = 0
    const findUnique = vi.spyOn(prisma.matchCache, 'findUnique')
    const out = await fetchDetailedStatsForMatches(prisma as any, IDS, ['me'], 'EUW1', 'MIDDLE', 10)
    expect(out).toHaveLength(5)
    expect(h.getMatch).toHaveLength(0)
    expect(findUnique).not.toHaveBeenCalled()
    findUnique.mockRestore()
  })

  it('a row of another formula version is computed again', async () => {
    h.memo.set('EUW1_1|me', { version: DETAILED_STATS_VERSION - 1, statsJson: JSON.stringify({ meta: { role: 'MIDDLE', stale: true } }) })
    const out = await fetchDetailedStatsForMatches(prisma as any, ['EUW1_1'], ['me'], 'EUW1', null, 1)
    expect(out[0].meta.stale).toBeUndefined()
  })
})

describe('gain 6: timelines stored compressed, read decompressed, old ones migrated', () => {
  it('the loop stores timelines compressed', async () => {
    await fetchDetailedStatsForMatches(prisma as any, ['EUW1_1'], ['me'], 'EUW1', null, 1)
    expect(isCompressedTimeline(h.cache.get('EUW1_1')!.timelineJson)).toBe(true)
  })

  it('a plain timeline is read as it is, then rewritten compressed', async () => {
    const plain = JSON.stringify({ info: { frames: [] } })
    h.cache.set('EUW1_9', { matchJson: '{}', timelineJson: plain })
    expect(await readTimelineJson(prisma as any, 'EUW1_9')).toBe(plain)
    await new Promise((r) => setTimeout(r, 0))
    expect(isCompressedTimeline(h.cache.get('EUW1_9')!.timelineJson)).toBe(true)
    expect(await readTimelineJson(prisma as any, 'EUW1_9')).toBe(plain)
  })
})

describe('gain 7: match summaries', () => {
  it('written with the match body, for the player\'s accounts only, read back with dates', async () => {
    const m = match('EUW1_7', 'me', 'MIDDLE', 7000)
    m.info.participants.push({ ...m.info.participants[0], puuid: 'someone-else' })
    await saveMatch(prisma as any, 'EUW1_7', m)
    expect([...h.summaries.keys()]).toEqual(['EUW1_7|me'])
    const got = await readSummaries(prisma as any, ['EUW1_7', 'EUW1_8'], ['me'])
    expect(got.get('EUW1_7')).toMatchObject({ puuid: 'me', stats: { champion: 'Ahri', kills: 5, win: true } })
    expect(got.get('EUW1_7')!.stats.gameEndAt).toBeInstanceOf(Date)
    expect(got.has('EUW1_8')).toBe(false)
  })

  it('a summary of another version is ignored', async () => {
    h.summaries.set('EUW1_7|me', { version: SUMMARY_VERSION + 1, statsJson: '{}', gameEndAt: null })
    expect((await readSummaries(prisma as any, ['EUW1_7'], ['me'])).size).toBe(0)
  })
})
