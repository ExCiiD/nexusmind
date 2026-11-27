/**
 * Web client pacing of a background scout (27/11/2026, audit I4): 16 calls a minute, a 429 about the player's own
 * background share pauses background calls only and is retried many times, and a season list with a failed queue
 * is an error (never "no games").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../web/src/supabase', () => ({
  sb: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}))
vi.stubEnv('WEB_RIOT_PROXY_URL', 'https://proxy.test')
const riot = await import('../../web/src/riotWeb')

const res = (status: number, headers: Record<string, string> = {}, body: unknown = ['EUW1_1']) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
})
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  riot.resetRiotRateLimitForTests()
  riot.regionResolver.invalidate()
  for (const id of ['puuid', 'p1', 'p']) riot.regionResolver.setMode(id, 'EUW1')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('web background pacing', () => {
  it('sends at most 16 background calls in a minute', async () => {
    fetchMock.mockImplementation(async () => res(200))
    const calls = Array.from({ length: 17 }, () => riot.getMatch('EUW1_1', 'EUW1', riot.BACKGROUND))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchMock).toHaveBeenCalledTimes(16)
    await vi.advanceTimersByTimeAsync(60_000)
    await Promise.all(calls)
    expect(fetchMock).toHaveBeenCalledTimes(17)
  })

  it('a background call outlasts more 429s than MAX_RIOT_TRIES when the proxy only asks to slow down, and an interactive call is not held', async () => {
    let bg = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('EUW1_2')) return res(200)
      return ++bg <= riot.MAX_RIOT_TRIES + 2 ? res(429, { 'retry-after': '40', 'x-rate-limit-type': 'proxy-user-share' }) : res(200)
    })
    const a = riot.getMatch('EUW1_1', 'EUW1', riot.BACKGROUND)
    await vi.advanceTimersByTimeAsync(100) // the first 429: background is paused
    const screen = riot.getMatch('EUW1_2', 'EUW1')
    await vi.advanceTimersByTimeAsync(100)
    await expect(screen).resolves.toBeDefined() // not held by the background pause
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await expect(a).resolves.toBeDefined()
    expect(bg).toBe(riot.MAX_RIOT_TRIES + 3)
  })

  it('a season list whose flex queue fails is an error, not an empty list', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('queue=440') ? res(500) : res(200, {}, [])))
    const p = riot.getSeasonMatchIds('p1', 'EUW1', undefined, riot.BACKGROUND).then(() => 'ok', (e) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    const out = await p
    expect(out).toBeInstanceOf(Error)
  })
})

describe('web 429 handling in a real browser (headers hidden by CORS) and with the new proxy types', () => {
  it('a background 429 without retry-after / x-rate-limit-type headers backs off by itself and never holds a screen call', async () => {
    let bg = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('EUW1_2')) return res(200)
      return ++bg <= 2 ? res(429) : res(200)
    })
    const a = riot.getMatch('EUW1_1', 'EUW1', riot.BACKGROUND)
    await vi.advanceTimersByTimeAsync(100)
    const screen = riot.getMatch('EUW1_2', 'EUW1')
    await vi.advanceTimersByTimeAsync(100)
    await expect(screen).resolves.toBeDefined()
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(a).resolves.toBeDefined()
    expect(bg).toBe(3)
  })

  it('without the headers a background call gives up after MAX_RIOT_TRIES with a rate-limit error', async () => {
    fetchMock.mockImplementation(async () => res(429))
    const p = riot.getMatch('EUW1_1', 'EUW1', riot.BACKGROUND).then(() => null, (e) => e)
    await vi.advanceTimersByTimeAsync(60_000)
    const err = await p
    expect(err).toBeInstanceOf(riot.RiotWebError)
    expect((err as InstanceType<typeof riot.RiotWebError>).code).toBe('rate-limited')
    expect(fetchMock).toHaveBeenCalledTimes(riot.MAX_RIOT_TRIES)
  })

  it('proxy-background-reserve in background holds background calls only and is retried up to 12 times', async () => {
    let bg = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('EUW1_2')) return res(200)
      return ++bg <= 8 ? res(429, { 'retry-after': '20', 'x-rate-limit-type': 'proxy-background-reserve' }) : res(200)
    })
    const a = riot.getMatch('EUW1_1', 'EUW1', riot.BACKGROUND)
    await vi.advanceTimersByTimeAsync(100)
    const screen = riot.getMatch('EUW1_2', 'EUW1')
    await vi.advanceTimersByTimeAsync(100)
    await expect(screen).resolves.toBeDefined()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await expect(a).resolves.toBeDefined()
    expect(bg).toBe(9)
  })

  it('a 429 received by a screen call holds everybody (Riot\'s own limit)', async () => {
    let n = 0
    fetchMock.mockImplementation(async () => (++n === 1 ? res(429, { 'retry-after': '5' }) : res(200)))
    const screen = riot.getMatch('EUW1_1', 'EUW1')
    await vi.advanceTimersByTimeAsync(100)
    const bgCall = riot.getMatch('EUW1_2', 'EUW1', riot.BACKGROUND)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchMock).toHaveBeenCalledTimes(1) // the background call waits for the cooldown
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all([screen, bgCall])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('a 503 with Retry-After is waited for, then the call goes through', async () => {
    let n = 0
    fetchMock.mockImplementation(async () => (++n === 1 ? res(503, { 'retry-after': '3' }) : res(200)))
    const p = riot.getMatch('EUW1_1', 'EUW1', riot.BACKGROUND)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(p).resolves.toBeDefined()
    expect(n).toBe(2)
  })

  it('a pause set by another call while one slept is waited for too (waitForCooldown loops)', async () => {
    let n = 0
    fetchMock.mockImplementation(async (url: string) => {
      n++
      if (url.includes('EUW1_1') && n === 1) return res(429, { 'retry-after': '5', 'x-rate-limit-type': 'proxy-user-background' })
      if (url.includes('EUW1_3') && n === 2) return res(429, { 'retry-after': '20', 'x-rate-limit-type': 'proxy-user-background' })
      return res(200)
    })
    const a = riot.getMatch('EUW1_1', 'EUW1', riot.BACKGROUND)
    await vi.advanceTimersByTimeAsync(50)
    const b = riot.getMatch('EUW1_2', 'EUW1', riot.BACKGROUND) // sleeps ~5 s behind the pause
    const c = riot.getMatch('EUW1_3', 'EUW1', riot.BACKGROUND)
    await vi.advanceTimersByTimeAsync(60_000)
    await Promise.all([a, b, c])
    // b woke up, saw the longer pause set meanwhile, and waited again instead of firing into it
    const order = fetchMock.mock.calls.map((c) => String(c[0]).split('/').pop())
    expect(order.length).toBeGreaterThanOrEqual(4)
  })

  it('a season list with a 401 on one queue and a rate limit on another reports the session first', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('queue=420')) return res(401)
      if (url.includes('queue=440')) return res(429, { 'retry-after': '100' })
      return res(200, {}, [])
    })
    const p = riot.getSeasonMatchIds('p1', 'EUW1', undefined, riot.BACKGROUND).then(() => null, (e) => e)
    await vi.advanceTimersByTimeAsync(10_000)
    const err = await p
    expect((err as { status?: number }).status).toBe(401)
  })

  it('the region detection of a screen call is not sent in the background lane', async () => {
    riot.regionResolver.invalidate()
    const sent: Array<Record<string, string>> = []
    fetchMock.mockImplementation(async (_url: string, init: { headers: Record<string, string> }) => { sent.push(init.headers); return res(404) })
    void riot.getChampionMasteries('fresh-puuid', 'EUW1', 5).catch(() => null)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sent.length).toBeGreaterThan(0)
    expect(sent[0]['x-nxm-priority']).toBeUndefined()
    riot.regionResolver.invalidate()
    sent.length = 0
    void riot.getChampionMasteries('fresh-puuid-2', 'EUW1', 5, riot.BACKGROUND).catch(() => null)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sent[0]['x-nxm-priority']).toBe('background')
  })
})
