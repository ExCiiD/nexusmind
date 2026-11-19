/**
 * #46 point 2: part of each player's own allowance is kept for their interactive calls, in the proxy's shared
 * budget (USER_INTERACTIVE_RESERVE, budget.ts) and in its per-player limiter (USER_LIMITER_BACKGROUND, handler.ts),
 * so an open screen never waits behind the same player's background reads (weekly awards, scouts).
 */
import { describe, it, expect, vi } from 'vitest'
import { RiotBudget, parseUserInteractiveReserve, DEFAULT_USER_INTERACTIVE_RESERVE } from '../../cloudflare/riot-proxy/src/budget'
import { handleRequest, type HandlerDeps } from '../../cloudflare/riot-proxy/src/handler'

const DEV_WINDOWS = [{ limit: 18, seconds: 1 }, { limit: 95, seconds: 120 }]

describe('budget: the player\'s interactive reserve', () => {
  it('a player\'s background calls use at most 80 % of their share, always leaving one slot', () => {
    const b = new RiotBudget(DEV_WINDOWS, 0.3, 0.25, 0.2)
    // 95 × 0.25 = 23 calls per 2 min for the player: 18 for background, 23 in all.
    expect(b.userCapFor(DEV_WINDOWS[1], 'interactive')).toBe(23)
    expect(b.userCapFor(DEV_WINDOWS[1], 'background')).toBe(18)
    // 18 × 0.25 = 4 per second: 3 for background.
    expect(b.userCapFor(DEV_WINDOWS[0], 'background')).toBe(3)
    // A share of one slot cannot be split.
    expect(new RiotBudget([{ limit: 4, seconds: 1 }], 0.3, 0.25, 0.2).userCapFor({ limit: 4, seconds: 1 }, 'background')).toBe(1)
  })

  it('once the player\'s background calls hit their cap, the player\'s interactive call still goes through', () => {
    const b = new RiotBudget(DEV_WINDOWS, 0.3, 0.25, 0.2)
    let t = 0
    let sent = 0
    for (let i = 0; i < 40; i++) {
      if (b.tryAcquire('background', t, 'njord').ok) sent++
      t += 1000 // one per second: the per-second window is never the limit
    }
    expect(sent).toBe(18)
    expect(b.tryAcquire('background', t, 'njord')).toMatchObject({ ok: false, reason: 'user_share' })
    expect(b.tryAcquire('interactive', t, 'njord')).toEqual({ ok: true })
  })

  it('the setting: 0.2 by default, bad values fall back to it', () => {
    expect(DEFAULT_USER_INTERACTIVE_RESERVE).toBe(0.2)
    expect(parseUserInteractiveReserve('0.3')).toBe(0.3)
    for (const bad of [undefined, '', 'x', '-1', '0.95']) expect(parseUserInteractiveReserve(bad)).toBe(0.2)
  })
})

describe('handler: the background per-player limiter', () => {
  const IDS_URL = 'https://proxy.test/europe/lol/match/v5/matches/by-puuid/abc/ids?count=20'
  function setup(backgroundAllowed: boolean) {
    const background = { limit: vi.fn(async () => ({ success: backgroundAllowed })) }
    const all = { limit: vi.fn(async () => ({ success: true })) }
    const deps: HandlerDeps = {
      verifyUser: async () => ({ sub: 'user-1' }),
      fetchRiot: vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })),
      waitUntil: () => {},
      log: () => {},
    }
    const env = { RIOT_API_KEY: 'k', USER_LIMITER: all, USER_LIMITER_BACKGROUND: background }
    const call = (headers: Record<string, string> = {}) =>
      handleRequest(new Request(IDS_URL, { headers: { authorization: 'Bearer ok', ...headers } }), env, deps)
    return { call, background, all }
  }

  it('a background call over the player\'s background allowance gets 429 proxy-user-background', async () => {
    const s = setup(false)
    const res = await s.call({ 'x-nxm-priority': 'background' })
    expect(res.status).toBe(429)
    expect(res.headers.get('x-rate-limit-type')).toBe('proxy-user-background')
  })

  it('an interactive call of the same player does not count against it, and goes through', async () => {
    const s = setup(false)
    const res = await s.call()
    expect(res.status).toBe(200)
    expect(s.background.limit).not.toHaveBeenCalled()
    expect(s.all.limit).toHaveBeenCalledOnce()
  })
})
