/**
 * Riot calls retried at most RIOT_MAX_ATTEMPTS times on a 429 (or the proxy's 503 when its budget is down),
 * each time after the whole Retry-After, then a clear RIOT_RATE_LIMITED error (it used to retry without end).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../electron/main/riotTransport', () => ({
  prepareRiotRequest: async (url: string) => ({ url, headers: {} }),
  riotTransportMode: () => 'direct',
  RiotAuthError: class RiotAuthError extends Error {},
}))

import { getMatch, RIOT_MAX_ATTEMPTS, RiotRateLimitError } from '../../electron/main/riotClient'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const answer = (status: number, headers: Record<string, string> = {}, body = '{}') => new Response(body, { status, headers })

describe('riotFetch on 429', () => {
  it('gives up after 3 tries with RIOT_RATE_LIMITED, having waited each Retry-After', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => answer(429, { 'retry-after': '7', 'x-rate-limit-type': 'proxy-global' }))
    vi.stubGlobal('fetch', fetchMock)
    const outcome = getMatch('EUW1_1', 'EUW1').then(() => 'resolved', (e) => e)
    await vi.advanceTimersByTimeAsync(6_900)
    expect(fetchMock).toHaveBeenCalledTimes(1) // still waiting the whole Retry-After
    await vi.advanceTimersByTimeAsync(20_000)
    const err = await outcome
    expect(fetchMock).toHaveBeenCalledTimes(RIOT_MAX_ATTEMPTS)
    expect(err).toBeInstanceOf(RiotRateLimitError)
    expect((err as RiotRateLimitError).code).toBe('RIOT_RATE_LIMITED')
    expect((err as Error).message).toMatch(/^RIOT_RATE_LIMITED/)
  })

  it('succeeds when the limit clears before the last try', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(answer(429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(answer(200, { 'content-type': 'application/json' }, '{"metadata":{"matchId":"EUW1_1"}}'))
    vi.stubGlobal('fetch', fetchMock)
    const p = getMatch('EUW1_1', 'EUW1')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await p).toEqual({ metadata: { matchId: 'EUW1_1' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats the proxy\'s 503 with Retry-After (budget down, background call) the same way', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => answer(503, { 'retry-after': '30' }))
    vi.stubGlobal('fetch', fetchMock)
    const outcome = getMatch('EUW1_1', 'EUW1').then(() => 'resolved', (e) => e)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(await outcome).toBeInstanceOf(RiotRateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(RIOT_MAX_ATTEMPTS)
  })
})
