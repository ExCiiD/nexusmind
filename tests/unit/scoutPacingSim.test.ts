import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../electron/main/riotTransport', () => ({
  prepareRiotRequest: async (url: string) => ({ url, headers: {} }),
  riotTransportMode: () => 'proxy',
  RiotAuthError: class RiotAuthError extends Error {},
}))

import { getMatch, resetProxyPacingForTests } from '../../electron/main/riotClient'
import { withRiotPriority } from '../../electron/main/riotPriority'
import { runBounded } from '../../src/lib/scoutEngine'
import { RiotBudget } from '../../cloudflare/riot-proxy/src/budget'

afterEach(() => {
  resetProxyPacingForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** The real worker budget (pure class) behind a fake fetch, on a fake clock. */
function proxy(hit: (url: string) => boolean = () => false) {
  const budget = new RiotBudget()
  const stats = { sent: 0, ok: 0, shareLimited: 0, windowLimited: 0 }
  const fetchMock = vi.fn(async (url: string) => {
    stats.sent++
    if (hit(url)) { stats.ok++; return new Response('{}', { status: 200, headers: { 'x-nxm-cache': 'hit' } }) }
    const r = budget.tryAcquire('background', Date.now(), 'user-1')
    if (r.ok) { stats.ok++; return new Response('{}', { status: 200 }) }
    if (r.reason === 'user_share') stats.shareLimited++; else stats.windowLimited++
    return new Response('{}', {
      status: 429,
      headers: { 'retry-after': String(Math.max(1, Math.ceil(r.retryAfterMs / 1000))), 'x-rate-limit-type': r.reason === 'user_share' ? 'proxy-user-share' : 'proxy-global' },
    })
  })
  return { stats, fetchMock }
}

async function scoutSim(n: number, fetchMock: ReturnType<typeof proxy>['fetchMock'], extra?: () => void) {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  const ids = Array.from({ length: n }, (_, i) => `EUW1_${i}`)
  const doneAt: number[] = []
  let errors = 0
  const t0 = Date.now()
  const timer = extra ? setInterval(extra, 20_000) : null
  const run = runBounded(ids, 10, async (id) => {
    try { await withRiotPriority('background', () => getMatch(id, 'EUW1')) } catch { errors++ }
    doneAt.push(Date.now() - t0)
  })
  await vi.advanceTimersByTimeAsync(6 * 3600_000)
  await run
  if (timer) clearInterval(timer)
  const minutes = doneAt[doneAt.length - 1] / 60_000
  return { errors, perMin: n / minutes, tailMin: (doneAt[doneAt.length - 1] - doneAt[doneAt.length - 21]) / 60_000 }
}

describe('scout pacing against the real worker budget (simulation, 27/11 tail stall)', () => {
  it('200 uncached games: the share rate (about 9/min), no refused call, no give-up, no long tail', async () => {
    const { stats, fetchMock } = proxy()
    const r = await scoutSim(200, fetchMock)
    expect(r.errors).toBe(0)
    expect(stats.shareLimited).toBe(0) // the client mirrors the share: it never finds out with a 429
    expect(r.perMin).toBeGreaterThan(8.5)
    expect(r.tailMin).toBeLessThan(3.5) // the last 20 games go at the same pace as the first ones
  })

  it('games the proxy answers from its store cost no share: half of them cached goes about twice as fast', async () => {
    const { fetchMock } = proxy((url) => parseInt(url.split('_').pop()!, 10) % 2 === 0)
    const r = await scoutSim(200, fetchMock)
    expect(r.errors).toBe(0)
    expect(r.perMin).toBeGreaterThan(14)
  })

  it('the same player using part of the share elsewhere (own sync) slows the scout but never kills it', async () => {
    const { stats, fetchMock } = proxy()
    // Another consumer of the same share, invisible to the scout's own pacing.
    const budgetUse = vi.fn()
    const r = await scoutSim(120, fetchMock, () => { budgetUse(); void fetchMock('https://x/other') })
    expect(r.errors).toBe(0)
    expect(stats.ok).toBeGreaterThanOrEqual(120)
    expect(r.perMin).toBeGreaterThan(5)
  })
})
