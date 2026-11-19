import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The web Riot client on a 429 (shared proxy key): Retry-After honoured in full, 3 tries at most, then a clear
// RiotWebError the screens show; every request of the tab waits out the cooldown.
vi.mock('../../web/src/supabase', () => ({
  sb: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}))

vi.stubEnv('WEB_RIOT_PROXY_URL', 'https://proxy.test')
const riot = await import('../../web/src/riotWeb')

const res = (status: number, retryAfter?: string, body: unknown = ['EUW1_1']) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
  json: async () => body,
})

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  riot.resetRiotRateLimitForTests()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('retryAfterSeconds', () => {
  it('reads seconds and HTTP dates, 1 s when missing', () => {
    expect(riot.retryAfterSeconds('12')).toBe(12)
    expect(riot.retryAfterSeconds(null)).toBe(1)
    expect(riot.retryAfterSeconds('nonsense')).toBe(1)
    const now = Date.parse('2026-11-19T10:00:00Z')
    expect(riot.retryAfterSeconds('Thu, 19 Nov 2026 10:00:20 GMT', now)).toBe(20)
  })
})

describe('429 handling', () => {
  it('waits the full Retry-After (not capped at 10 s), then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(res(429, '25')).mockResolvedValueOnce(res(200))
    const p = riot.getRecentMatchIds('puuid', 'EUW1', 20)
    await vi.advanceTimersByTimeAsync(24_000)
    expect(fetchMock).toHaveBeenCalledTimes(1) // still waiting at 24 s
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(p).resolves.toEqual(['EUW1_1'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops after 3 tries with a clear rate-limited error', async () => {
    fetchMock.mockResolvedValue(res(429, '2'))
    const p = riot.getRecentMatchIds('puuid', 'EUW1', 20)
    const caught = p.catch((e) => e)
    await vi.advanceTimersByTimeAsync(10_000)
    const err = await caught
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(err).toBeInstanceOf(riot.RiotWebError)
    expect(err.code).toBe('rate-limited')
    expect(err.message).toMatch(/Try again in 2 s/)
  })

  it('fails at once on a long Retry-After, and later requests do not hit the key meanwhile', async () => {
    fetchMock.mockResolvedValue(res(429, '120'))
    await expect(riot.getRecentMatchIds('a', 'EUW1', 20)).rejects.toMatchObject({ code: 'rate-limited', retryAfterSec: 120 })
    await expect(riot.getRecentMatchIds('b', 'EUW1', 20)).rejects.toMatchObject({ code: 'rate-limited' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a rate limit stops a bulk fetch and reaches the caller', async () => {
    fetchMock.mockResolvedValue(res(429, '90'))
    await expect(riot.getMatchesBulk(['EUW1_1', 'EUW1_2', 'EUW1_3'], 'EUW1', 2)).rejects.toMatchObject({ code: 'rate-limited' })
  })
})

describe('#40 calls (timeline, league entries, ranked solo ids)', () => {
  const urlOf = (call: number) => fetchMock.mock.calls[call][0] as string
  it('hit the allowed proxy paths, background when asked', async () => {
    fetchMock.mockResolvedValue(res(200, undefined, [{ queueType: 'RANKED_SOLO_5x5', tier: 'MASTER', rank: 'I', leaguePoints: 120, wins: 10, losses: 8 }]))
    await riot.getMatchTimeline('EUW1_42', 'EUW1', riot.BACKGROUND)
    const entries = await riot.getLeagueEntriesByPuuid('p1', 'EUW1')
    await riot.getRankedSoloMatchIds('p1', 'EUW1', 20, riot.BACKGROUND)
    expect(urlOf(0)).toBe('https://proxy.test/europe/lol/match/v5/matches/EUW1_42/timeline')
    expect(urlOf(1)).toBe('https://proxy.test/euw1/lol/league/v4/entries/by-puuid/p1')
    expect(urlOf(2)).toBe('https://proxy.test/europe/lol/match/v5/matches/by-puuid/p1/ids?queue=420&start=0&count=20')
    expect(entries[0].tier).toBe('MASTER')
    const prio = (i: number) => (fetchMock.mock.calls[i][1] as { headers: Record<string, string> }).headers['x-nxm-priority']
    expect([prio(0), prio(1), prio(2)]).toEqual(['background', undefined, 'background'])
  })
})

describe('x-nxm-priority (P2)', () => {
  const headersOf = (call: number) => (fetchMock.mock.calls[call][1] as { headers: Record<string, string> }).headers

  it('marks background calls only', async () => {
    fetchMock.mockResolvedValue(res(200))
    await riot.getRecentMatchIds('p', 'EUW1', 20, 440, riot.BACKGROUND)
    await riot.getMatchesBulk(['EUW1_9'], 'EUW1', 1, riot.BACKGROUND)
    await riot.getAccountByRiotId('Name', 'EUW', 'EUW1') // a user's direct lookup
    expect(headersOf(0)['x-nxm-priority']).toBe('background')
    expect(headersOf(1)['x-nxm-priority']).toBe('background')
    expect(headersOf(2)['x-nxm-priority']).toBeUndefined()
    expect(headersOf(2).Authorization).toBe('Bearer tok')
  })
})
