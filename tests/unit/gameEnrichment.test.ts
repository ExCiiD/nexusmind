/**
 * Audit E09 (19/11/2026): the post-game enrichment downloads the match once, and caches it before
 * onGameEnriched starts the analysis (which reads that cache instead of asking Riot again).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('../../electron/main/riotClient', () => ({
  getMatchIds: vi.fn(async () => ['EUW1_E09']),
  getMatch: vi.fn(async () => { h.calls.push('getMatch'); return { metadata: { matchId: 'EUW1_E09' }, info: { participants: [] } } }),
  extractPlayerStats: vi.fn(() => ({
    champion: 'Ahri', role: 'MIDDLE', kills: 1, deaths: 2, assists: 3, cs: 150, visionScore: 10, duration: 1800,
    win: true, gameEndAt: new Date(), queueType: 'soloq', opponentChampion: 'Zed',
  })),
  isQueueSessionEligible: vi.fn(() => true),
}))

const prisma = {
  user: { findFirst: vi.fn(async () => ({ id: 'u1', puuid: 'p1', region: 'EUW1' })) },
  account: { findMany: vi.fn(async () => []) },
  game: {
    findFirst: vi.fn(async () => ({ id: 'g1' })),
    update: vi.fn(async () => ({})),
  },
  matchCache: {
    upsert: vi.fn(async (args: any) => { h.calls.push(`cache:${args.where.matchId}`); return {} }),
  },
}
vi.mock('../../electron/main/database', () => ({ getPrisma: () => prisma }))

import { GameDetector } from '../../electron/main/gameDetector'

describe('enrichWithMatchApi (E09)', () => {
  beforeEach(() => { vi.useFakeTimers(); h.calls.length = 0 })
  afterEach(() => { vi.useRealTimers() })

  it('fetches the match once and caches it before onGameEnriched', async () => {
    const onGameEnriched = vi.fn(() => { h.calls.push('enriched') })
    const detector = new GameDetector(() => {}, undefined, undefined, onGameEnriched)
    const done = (detector as any).enrichWithMatchApi(Date.now(), null) as Promise<void>
    await vi.advanceTimersByTimeAsync(10_000)
    await done

    expect(onGameEnriched).toHaveBeenCalledWith(expect.objectContaining({ gameId: 'g1', matchId: 'EUW1_E09', win: true }))
    expect(h.calls).toEqual(['getMatch', 'cache:EUW1_E09', 'enriched'])
    const cached = (prisma.matchCache.upsert.mock.calls[0] as any[])[0]
    expect(JSON.parse(cached.create.matchJson).metadata.matchId).toBe('EUW1_E09')
  })
})
