/**
 * Item I (19/11/2026): one live-session poller per app, pushed to the screens; group list cached 60 s in the main
 * process. Desktop (syncService, collab.ts) and web (web/src/api.ts) sides.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { liveSessionsKey, livePollDelay } from '../../src/lib/teamSessionsCore'
import type { TeamSession } from '../../src/lib/teamSessions'

const h = vi.hoisted(() => ({
  sent: [] as Array<[string, unknown]>,
  live: [] as unknown[],
  liveCalls: 0,
  groupCalls: 0,
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, webContents: { send: (c: string, p: unknown) => h.sent.push([c, p]) } }] },
  app: { on: () => {}, getPath: () => '' },
}))
vi.mock('../../electron/main/database', () => ({ getPrisma: () => { throw new Error('not used') } }))
vi.mock('../../electron/main/cloud/supabase', () => ({
  getSupabase: () => ({}), isCloudConfigured: () => true, getSessionUserId: async () => 'u1', requireSessionUserId: async () => 'u1',
  getAccessToken: async () => null, getSupabaseUrl: () => '',
}))
vi.mock('../../src/lib/teamSessionsCore', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/teamSessionsCore')>()),
  listMyLiveSessions: async () => { h.liveCalls++; return h.live },
}))
vi.mock('../../src/lib/collabCore', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/collabCore')>()),
  listMyGroups: async () => { h.groupCalls++; return [] },
  setCaptain: async () => undefined,
}))
// The web adapter's client: signed in as u1.
vi.mock('../../web/src/supabase', () => ({
  sb: {}, currentUserId: async () => 'u1', supabaseConfigured: true, supabaseUrl: '', supabaseAnonKey: '', WEB_AUTH_STORAGE_KEY: 'k',
}))

const session = (id: string): TeamSession => ({
  id, groupId: 'g1', calendarEventId: 'e1', status: 'live', responsibleUserIds: ['u1'], queueFilter: 'flex', startedAt: 't', endedAt: null, createdAt: 't',
})

beforeEach(() => { h.sent.length = 0; h.liveCalls = 0; h.groupCalls = 0; h.live = [] })

describe('shared helpers', () => {
  it('the key ignores order and changes with the content', () => {
    expect(liveSessionsKey([session('a'), session('b')])).toBe(liveSessionsKey([session('b'), session('a')]))
    expect(liveSessionsKey([session('a')])).not.toBe(liveSessionsKey([{ ...session('a'), status: 'ended' }]))
    expect(liveSessionsKey([])).toBe('')
  })
  it('cadence: 60 s / 15 s visible, 5 min / 60 s hidden', () => {
    expect([livePollDelay(true, false), livePollDelay(true, true), livePollDelay(false, false), livePollDelay(false, true)])
      .toEqual([60_000, 15_000, 300_000, 60_000])
  })
})

describe('desktop: the sync service is the only live-session poller', () => {
  it('pushes team-session:live only when the list changes, and serves the cache without a request', async () => {
    const svc = await import('../../electron/main/sync/syncService')
    h.live = [session('a')]
    await svc.refreshLiveSessions()
    await svc.refreshLiveSessions()
    expect(h.sent.filter(([c]) => c === 'team-session:live')).toHaveLength(1)
    const calls = h.liveCalls
    await expect(svc.getLiveSessionsCached()).resolves.toHaveLength(1)
    expect(h.liveCalls).toBe(calls)
    h.live = []
    await svc.refreshLiveSessions()
    expect(h.sent.filter(([c]) => c === 'team-session:live').at(-1)?.[1]).toEqual([])
  })
})

describe('desktop: group list cached 60 s', () => {
  afterEach(() => vi.useRealTimers())
  it('one request for a burst of screens, again after a mutation or 60 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const collab = await import('../../electron/main/cloud/collab')
    collab.invalidateGroupsCache()
    await Promise.all([collab.listMyGroups(), collab.listMyGroups(), collab.listMyGroups()])
    expect(h.groupCalls).toBe(1)
    await collab.setCaptain('g1', 'u2', true)
    await collab.listMyGroups()
    expect(h.groupCalls).toBe(2)
    vi.advanceTimersByTime(60_001)
    await collab.listMyGroups()
    expect(h.groupCalls).toBe(3)
  })
})

describe('web: one shared poller for every screen', () => {
  afterEach(() => vi.useRealTimers())
  it('subscribers share the fetches, and polling stops with the last one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { webApi } = await import('../../web/src/api')
    h.live = [session('a')]
    const a = vi.fn()
    const b = vi.fn()
    const offA = webApi.onTeamSessionLive(a)
    const offB = webApi.onTeamSessionLive(b)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.liveCalls).toBeLessThanOrEqual(2)
    await vi.advanceTimersByTimeAsync(15_000) // a session is live: 15 s
    const afterOneTick = h.liveCalls
    expect(a).toHaveBeenCalledWith([session('a')])
    expect(b).toHaveBeenCalled()
    await expect(webApi.teamSessionLiveCached()).resolves.toHaveLength(1)
    expect(h.liveCalls).toBe(afterOneTick)
    offA()
    offB()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(h.liveCalls).toBe(afterOneTick)
  })
})
