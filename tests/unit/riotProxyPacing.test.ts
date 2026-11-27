/**
 * Through the Ascend proxy a 429 "proxy-user*" is pacing, not failure (27/11/2026): a background scout keeps trying
 * well past RIOT_MAX_ATTEMPTS, and every other call waits for the pause instead of finding it out with its own 429
 * (each 429 still counts against the player's per-minute limiter at the proxy).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../electron/main/riotTransport', () => ({
  prepareRiotRequest: async (url: string) => ({ url, headers: {} }),
  riotTransportMode: () => 'proxy',
  RiotAuthError: class RiotAuthError extends Error {},
}))

import { getMatch, getSeasonMatchIds, RIOT_MAX_ATTEMPTS, resetProxyPacingForTests } from '../../electron/main/riotClient'
import { withRiotPriority } from '../../electron/main/riotPriority'

afterEach(() => {
  resetProxyPacingForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const answer = (status: number, headers: Record<string, string> = {}, body = '{}') => new Response(body, { status, headers })
const userShare429 = () => answer(429, { 'retry-after': '5', 'x-rate-limit-type': 'proxy-user-share' })

describe('proxy pacing', () => {
  it('a background call outlasts more 429s than RIOT_MAX_ATTEMPTS when the proxy only asks to slow down', async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => (++calls <= RIOT_MAX_ATTEMPTS + 3 ? userShare429() : answer(200, {}, '{"ok":true}'))))
    const result = withRiotPriority('background', () => getMatch('EUW1_10', 'EUW1')).then((v) => v, (e) => e)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(await result).toEqual({ ok: true })
    expect(calls).toBe(RIOT_MAX_ATTEMPTS + 4)
  })

  it('another call does not hit the proxy while the pause is on', async () => {
    vi.useFakeTimers()
    const urls: string[] = []
    let first = true
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      if (first) { first = false; return userShare429() }
      return answer(200, {}, '{}')
    }))
    const a = withRiotPriority('background', () => getMatch('EUW1_20', 'EUW1'))
    await vi.advanceTimersByTimeAsync(10) // a is answered 429: the pause starts
    const b = withRiotPriority('background', () => getMatch('EUW1_21', 'EUW1'))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(urls.filter((u) => u.includes('EUW1_21'))).toHaveLength(0) // b waits, it did not send a request to be refused
    await vi.advanceTimersByTimeAsync(90_000) // (module state of the first test: its pause was set on another fake clock)
    await Promise.all([a, b])
    expect(urls.filter((u) => u.includes('EUW1_21'))).toHaveLength(1)
  })
  it('a gameEnd or interactive call leaves at once during a BACKGROUND pause (audit I1)', async () => {
    vi.useFakeTimers()
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return url.includes('EUW1_30') ? userShare429() : answer(200, {}, '{}')
    }))
    const bg = withRiotPriority('background', () => getMatch('EUW1_30', 'EUW1')).catch(() => null)
    await vi.advanceTimersByTimeAsync(10) // 429 proxy-user-share: background paused for 5 s
    const end = withRiotPriority('gameEnd', () => getMatch('EUW1_31', 'EUW1'))
    const screen = withRiotPriority('interactive', () => getMatch('EUW1_32', 'EUW1'))
    await vi.advanceTimersByTimeAsync(5) // far under the 5 s pause
    await Promise.all([end, screen])
    expect(urls.filter((u) => u.includes('EUW1_31') || u.includes('EUW1_32'))).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await bg
  })

  it('a proxy-global 429 received by an interactive call holds everybody, gameEnd included', async () => {
    vi.useFakeTimers()
    const urls: string[] = []
    let first = true
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      if (first) { first = false; return answer(429, { 'retry-after': '5', 'x-rate-limit-type': 'proxy-global' }) }
      return answer(200, {}, '{}')
    }))
    const a = withRiotPriority('interactive', () => getMatch('EUW1_40', 'EUW1'))
    await vi.advanceTimersByTimeAsync(10)
    const end = withRiotPriority('gameEnd', () => getMatch('EUW1_41', 'EUW1'))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(urls.filter((u) => u.includes('EUW1_41'))).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all([a, end])
  })

  it('a proxy-background-reserve or proxy-global 429 received by a background call leaves gameEnd free (B3)', async () => {
    vi.useFakeTimers()
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return url.includes('EUW1_50') ? answer(429, { 'retry-after': '30', 'x-rate-limit-type': 'proxy-background-reserve' }) : answer(200, {}, '{}')
    }))
    const bg = withRiotPriority('background', () => getMatch('EUW1_50', 'EUW1')).catch(() => null)
    await vi.advanceTimersByTimeAsync(10)
    const end = withRiotPriority('gameEnd', () => getMatch('EUW1_51', 'EUW1'))
    await vi.advanceTimersByTimeAsync(5)
    await end
    expect(urls.filter((u) => u.includes('EUW1_51'))).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    await bg
  })

  it('a season list whose flex queue fails is an error, not an empty list (audit I3)', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('active-regions')) return answer(404)
      return url.includes('queue=440') ? answer(500) : answer(200, {}, '[]')
    }))
    const p = withRiotPriority('background', () => getSeasonMatchIds('puuid-x', 'EUW1')).then(() => 'ok', (e) => e)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await p).toBeInstanceOf(Error)
  })
})
