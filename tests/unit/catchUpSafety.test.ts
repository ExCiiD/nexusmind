/**
 * CyberSecurity fixes before beta.15 (20/11/2026):
 * - the region IPC is validated with zod;
 * - the start-up catch-up sends its Riot calls as background (x-nxm-priority), never using the interactive reserve;
 * - a game the player deleted never comes back, and a match Riot does not know (practice tool) is not asked again
 *   for a day.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  priorities: [] as string[],
  getMatchCalls: [] as string[],
  created: [] as string[],
  ignored: new Map<string, { reason: string; createdAt: Date }>(),
}))

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: { getAllWindows: () => [] }, app: { on: () => {} } }))

vi.mock('../../electron/main/riotClient', async () => {
  const { currentRiotPriority } = await vi.importActual<typeof import('../../electron/main/riotPriority')>('../../electron/main/riotPriority')
  class RiotNotFoundError extends Error {}
  const end = Date.parse('2026-11-20T11:44:00Z')
  return {
    RiotNotFoundError,
    regionResolver: { observe: vi.fn(), resolve: vi.fn(async () => null) },
    getAnyQueueMatchIds: vi.fn(async () => { h.priorities.push(currentRiotPriority()); return ['EUW1_DELETED', 'EUW1_PRACTICE', 'EUW1_NEW'] }),
    getMatch: vi.fn(async (id: string) => {
      h.priorities.push(currentRiotPriority())
      h.getMatchCalls.push(id)
      if (id === 'EUW1_PRACTICE') throw new RiotNotFoundError('Account not found (404).')
      return { info: { participants: [{ puuid: 'p-main' }], gameEndTimestamp: end, gameDuration: 1600, queueId: 450 } }
    }),
    extractPlayerStats: vi.fn(() => ({ champion: 'Ahri', role: 'MIDDLE', kills: 1, deaths: 1, assists: 1, cs: 10, visionScore: 1, duration: 1600, win: true, gameEndAt: new Date(end), queueType: 'aram' })),
  }
})
vi.mock('../../electron/main/gameLog', () => ({ readRecentGameLogRefs: () => [] }))

const prisma = {
  user: { findFirst: async () => ({ id: 'u1', puuid: 'p-main', region: 'EUW1' }) },
  account: { findMany: async () => [] },
  session: { findFirst: async () => ({ id: 'off-1' }), create: async () => ({ id: 'off-1' }) },
  game: {
    findMany: async () => [],
    create: async (args: any) => { h.created.push(args.data.matchId); return { id: 'g' } },
  },
  matchCache: { findUnique: async () => null, upsert: async () => ({}) },
  recording: { count: async () => 0 },
  ignoredMatch: {
    findMany: async (args: any) => [...h.ignored].filter(([id]) => args.where.matchId.in.includes(id)).map(([matchId, v]) => ({ matchId, ...v })),
    findUnique: async (args: any) => (h.ignored.has(args.where.matchId) ? { matchId: args.where.matchId, ...h.ignored.get(args.where.matchId)! } : null),
    upsert: async (args: any) => { h.ignored.set(args.where.matchId, { reason: args.create.reason, createdAt: new Date() }); return {} },
    deleteMany: async (args: any) => { for (const id of args.where.matchId.in) h.ignored.delete(id); return {} },
  },
}
vi.mock('../../electron/main/database', () => ({ getPrisma: () => prisma }))

import { catchUpRecentGames } from '../../electron/main/gameCatchUp'
import { rememberDeletedMatches, forgetIgnoredMatches, stillIgnored, NOT_FOUND_RETRY_MS } from '../../electron/main/ignoredMatches'
import { accountIdSchema, regionModeSchema } from '../../electron/main/accountRegions'

const NOW = Date.parse('2026-11-20T12:30:00Z')

describe('start-up catch-up safety', () => {
  beforeEach(() => { h.priorities.length = 0; h.getMatchCalls.length = 0; h.created.length = 0; h.ignored.clear() })

  it('every Riot call is a background one', async () => {
    await catchUpRecentGames(async () => {}, NOW)
    expect(h.priorities.length).toBeGreaterThan(0)
    expect(new Set(h.priorities)).toEqual(new Set(['background']))
  })

  it('a deleted game is neither fetched nor imported again', async () => {
    await rememberDeletedMatches(['EUW1_DELETED', 'live_123', null])
    expect([...h.ignored.keys()]).toEqual(['EUW1_DELETED']) // a provisional id is not a match
    await catchUpRecentGames(async () => {}, NOW)
    expect(h.getMatchCalls).not.toContain('EUW1_DELETED')
    expect(h.created).toEqual(['EUW1_NEW'])
  })

  it('a match Riot does not know is remembered and skipped the next time, for a day', async () => {
    await catchUpRecentGames(async () => {}, NOW)
    expect(h.ignored.get('EUW1_PRACTICE')?.reason).toBe('not_found')
    h.getMatchCalls.length = 0
    await catchUpRecentGames(async () => {}, NOW)
    expect(h.getMatchCalls).not.toContain('EUW1_PRACTICE')
  })

  it('an explicit import forgets a deletion; a not-found entry expires, a deletion never does', async () => {
    await rememberDeletedMatches(['EUW1_X'])
    await forgetIgnoredMatches(['EUW1_X'])
    expect(h.ignored.has('EUW1_X')).toBe(false)
    const t = new Date(NOW)
    expect(stillIgnored({ reason: 'not_found', createdAt: t }, NOW + NOT_FOUND_RETRY_MS - 1)).toBe(true)
    expect(stillIgnored({ reason: 'not_found', createdAt: t }, NOW + NOT_FOUND_RETRY_MS)).toBe(false)
    expect(stillIgnored({ reason: 'deleted', createdAt: t }, NOW + 365 * 86_400_000)).toBe(true)
  })
})

describe('region IPC validation (zod)', () => {
  it('accepts main, an account id, auto and known platforms only', () => {
    expect(accountIdSchema.safeParse('main').success).toBe(true)
    expect(accountIdSchema.safeParse('cmqi0k0k4000ovaboy4c3r1gd').success).toBe(true)
    expect(accountIdSchema.safeParse('../../etc').success).toBe(false)
    expect(accountIdSchema.safeParse({ id: 1 }).success).toBe(false)
    for (const ok of ['auto', 'AUTO', 'EUW1', 'sg2']) expect(regionModeSchema.safeParse(ok).success, ok).toBe(true)
    for (const bad of ['mars1', '', 'EUW1; drop', 42, null]) expect(regionModeSchema.safeParse(bad).success, String(bad)).toBe(false)
  })
})
