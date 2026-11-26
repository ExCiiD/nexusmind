/**
 * P1-3 (docs/prod/PLAN_CLE_PROD.md): the app serves Riot calls by urgency (end of game, open screen, background),
 * the priority follows the work through its awaits, and background calls tell the proxy so (P1-2).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '.' }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../electron/main/cloud/supabase', () => ({ getAccessToken: async () => 'token-1' }))

import { withRiotPriority, currentRiotPriority, inBackground } from '../../electron/main/riotPriority'
import { RiotRateLimiter } from '../../electron/main/riotClient'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('priority context', () => {
  it('follows the work through its awaits, and defaults to interactive', async () => {
    expect(currentRiotPriority()).toBe('interactive')
    const seen = await withRiotPriority('background', async () => {
      await new Promise((r) => setTimeout(r, 1))
      return Promise.all([currentRiotPriority(), (async () => { await Promise.resolve(); return currentRiotPriority() })()])
    })
    expect(seen).toEqual(['background', 'background'])
    expect(currentRiotPriority()).toBe('interactive')
  })

  it('inBackground keeps the handler\'s shape', async () => {
    const handler = inBackground(async (_e: unknown, x: number) => `${x}:${currentRiotPriority()}`)
    expect(await handler(null, 3)).toBe('3:background')
  })
})

describe('limiter order', () => {
  it('serves the end of a game, then an open screen, then the background, whatever the arrival order', async () => {
    vi.useFakeTimers()
    const limiter = new RiotRateLimiter('test', [{ capacity: 1, windowSec: 1 }])
    await limiter.acquire('interactive') // fills the window
    const order: string[] = []
    const ask = (p: 'gameEnd' | 'interactive' | 'background', label: string) => limiter.acquire(p).then(() => { order.push(label) })
    const all = Promise.all([ask('background', 'scout 1'), ask('background', 'scout 2'), ask('interactive', 'screen'), ask('gameEnd', 'game end')])
    expect(limiter.queued()).toEqual({ gameEnd: 1, interactive: 1, background: 2 })
    await vi.advanceTimersByTimeAsync(5000)
    await all
    expect(order).toEqual(['game end', 'screen', 'scout 1', 'scout 2'])
  })

  it('a game that ends during a long scout goes before the rest of the scout', async () => {
    vi.useFakeTimers()
    const limiter = new RiotRateLimiter('test', [{ capacity: 1, windowSec: 1 }])
    const order: string[] = []
    const scout = Promise.all(Array.from({ length: 5 }, (_, i) => limiter.acquire('background').then(() => { order.push(`scout ${i}`) })))
    await vi.advanceTimersByTimeAsync(1100) // two scout calls through
    const gameEnd = limiter.acquire('gameEnd').then(() => { order.push('game end') })
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all([scout, gameEnd])
    expect(order.indexOf('game end')).toBe(2)
  })

  it('takes the priority from the context when none is given', async () => {
    vi.useFakeTimers()
    const limiter = new RiotRateLimiter('test', [{ capacity: 1, windowSec: 1 }])
    await limiter.acquire()
    const order: string[] = []
    const bg = withRiotPriority('background', () => limiter.acquire().then(() => { order.push('bg') }))
    const fg = limiter.acquire().then(() => { order.push('fg') })
    await vi.advanceTimersByTimeAsync(3000)
    await Promise.all([bg, fg])
    expect(order).toEqual(['fg', 'bg'])
  })
})

describe('proxy header', () => {
  it('a background call says so to the proxy, an interactive one sends nothing extra', async () => {
    vi.stubEnv('MAIN_VITE_RIOT_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    const { prepareRiotRequest } = await import('../../electron/main/riotTransport')
    const { withRiotPriority: withPriority } = await import('../../electron/main/riotPriority')
    const url = 'https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_1'
    const fg = await prepareRiotRequest(url)
    expect(fg.url).toBe('https://proxy.test/europe/lol/match/v5/matches/EUW1_1')
    expect(fg.headers).toEqual({ Authorization: 'Bearer token-1' })
    const bg = await withPriority('background', () => prepareRiotRequest(url))
    expect(bg.headers).toEqual({ Authorization: 'Bearer token-1', 'x-nxm-priority': 'background' })
    const end = await withPriority('gameEnd', () => prepareRiotRequest(url))
    expect(end.headers).toEqual({ Authorization: 'Bearer token-1' })
  })
})
