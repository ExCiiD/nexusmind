/**
 * Phase 1 of docs/PLAN_CLE_PROD.md in the Riot proxy (cloudflare/riot-proxy), without the Workers runtime:
 * P1-1 the shared store of finished games, P1-2 the global budget with its interactive reserve, P1-10 the
 * metrics (and that they never hold a Riot ID or a puuid).
 */
import { describe, it, expect, vi } from 'vitest'
import { RiotBudget, parseWindows, parseReserve, parseUserShare, DEFAULT_WINDOWS } from '../../cloudflare/riot-proxy/src/budget'
import { isImmutableRiotPath, cacheKeyFor, shouldStore } from '../../cloudflare/riot-proxy/src/cachePolicy'
import { routeRequest, backgroundOnly } from '../../cloudflare/riot-proxy/src/routing'
import { handleRequest, type BudgetGate, type ResponseStore, type HandlerDeps } from '../../cloudflare/riot-proxy/src/handler'

describe('P1-2 budget', () => {
  it('lets the window fill, then says when the oldest call leaves it', () => {
    const b = new RiotBudget([{ limit: 3, seconds: 10 }], 0)
    expect([0, 1, 2].map((t) => b.tryAcquire('interactive', t * 1000).ok)).toEqual([true, true, true])
    expect(b.tryAcquire('interactive', 5000)).toEqual({ ok: false, retryAfterMs: 5000, reason: 'window' })
    expect(b.tryAcquire('interactive', 10_001).ok).toBe(true) // the call made at 0 has left
  })

  it('keeps the reserve for interactive calls', () => {
    const b = new RiotBudget([{ limit: 10, seconds: 60 }], 0.3)
    expect(b.capFor({ limit: 10, seconds: 60 }, 'background')).toBe(7)
    for (let i = 0; i < 7; i++) expect(b.tryAcquire('background', i).ok).toBe(true)
    expect(b.tryAcquire('background', 10).ok).toBe(false) // the scout waits
    for (let i = 0; i < 3; i++) expect(b.tryAcquire('interactive', 20 + i).ok).toBe(true) // the end of a game still goes through
    expect(b.tryAcquire('interactive', 30).ok).toBe(false)
  })

  it('a background call never takes the last slot, even with no reserve set', () => {
    const b = new RiotBudget([{ limit: 2, seconds: 1 }], 0)
    expect(b.tryAcquire('background', 0).ok).toBe(true)
    expect(b.tryAcquire('background', 1).ok).toBe(false)
    expect(b.tryAcquire('interactive', 2).ok).toBe(true)
  })

  it('every window counts: the short one and the long one', () => {
    const b = new RiotBudget([{ limit: 2, seconds: 1 }, { limit: 3, seconds: 120 }], 0)
    expect(b.tryAcquire('interactive', 0).ok).toBe(true)
    expect(b.tryAcquire('interactive', 1).ok).toBe(true)
    expect(b.tryAcquire('interactive', 2).ok).toBe(false) // 2 per second
    expect(b.tryAcquire('interactive', 1500).ok).toBe(true)
    const r = b.tryAcquire('interactive', 3000) // 3 per 2 min: wait until the first call is 120 s old
    expect(r).toEqual({ ok: false, retryAfterMs: 117_000, reason: 'window' })
  })

  it('after Riot\'s own 429, nothing goes through until its Retry-After', () => {
    const b = new RiotBudget(DEFAULT_WINDOWS, 0.3)
    b.penalize(7, 1000)
    expect(b.tryAcquire('interactive', 2000)).toEqual({ ok: false, retryAfterMs: 6000, reason: 'riot_backoff' })
    expect(b.tryAcquire('interactive', 8001).ok).toBe(true)
    b.penalize(Number('nonsense'), 10_000) // no header: 10 s
    expect(b.tryAcquire('interactive', 19_000).ok).toBe(false)
  })

  it('reads its settings, and falls back on the development key on bad input', () => {
    expect(parseWindows('20:1,100:120')).toEqual([{ limit: 20, seconds: 1 }, { limit: 100, seconds: 120 }])
    expect(parseWindows('abc')).toEqual(DEFAULT_WINDOWS)
    expect(parseWindows('0:1')).toEqual(DEFAULT_WINDOWS)
    expect(parseWindows(undefined)).toEqual(DEFAULT_WINDOWS)
    expect(parseReserve('0.5')).toBe(0.5)
    expect(parseReserve('2')).toBe(0.3)
    expect(parseReserve('')).toBe(0.3)
  })
})

describe('per-user share (CyberSecurity)', () => {
  it('one account uses at most a quarter of each window, the others still get through', () => {
    const b = new RiotBudget([{ limit: 20, seconds: 120 }], 0, 0.25)
    expect(b.userCapFor({ limit: 20, seconds: 120 })).toBe(5)
    for (let i = 0; i < 5; i++) expect(b.tryAcquire('interactive', i, 'heavy').ok).toBe(true)
    expect(b.tryAcquire('interactive', 10, 'heavy')).toEqual({ ok: false, retryAfterMs: 119_990, reason: 'user_share' })
    expect(b.tryAcquire('interactive', 11, 'other').ok).toBe(true)
  })

  it('forgets users whose calls have all left the window', () => {
    const b = new RiotBudget([{ limit: 20, seconds: 1 }], 0, 0.25)
    b.tryAcquire('interactive', 0, 'a')
    b.tryAcquire('interactive', 0, 'b')
    expect(b.trackedUsers()).toBe(2)
    b.tryAcquire('interactive', 5000, 'c')
    expect(b.trackedUsers()).toBe(1)
  })

  it('reads USER_WINDOW_SHARE', () => {
    expect(parseUserShare('0.1')).toBe(0.1)
    expect(parseUserShare('0')).toBe(0.25)
    expect(parseUserShare(undefined)).toBe(0.25)
  })
})

describe('query whitelist (CyberSecurity)', () => {
  const route = (u: string) => routeRequest('GET', new URL(`https://proxy.test${u}`))
  it('keeps the parameters Ascend sends, rebuilt for Riot', () => {
    const r = route('/europe/lol/match/v5/matches/by-puuid/abc/ids?queue=420&start=0&count=20')
    expect(r.ok && r.upstream).toBe('https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/abc/ids?queue=420&start=0&count=20')
    const m = route('/euw1/lol/champion-mastery/v4/champion-masteries/by-puuid/abc/top?count=20')
    expect(m.ok).toBe(true)
  })
  it('refuses an unknown, repeated or malformed parameter, and any query on a match', () => {
    for (const u of [
      '/europe/lol/match/v5/matches/by-puuid/abc/ids?api_key=x',
      '/europe/lol/match/v5/matches/by-puuid/abc/ids?count=20&count=100',
      '/europe/lol/match/v5/matches/by-puuid/abc/ids?count=-1',
      '/europe/lol/match/v5/matches/by-puuid/abc/ids?type=custom',
      '/europe/lol/match/v5/matches/EUW1_7?x=1',
      '/europe/riot/account/v1/accounts/by-puuid/abc?fields=all',
    ]) {
      const r = route(u)
      expect(r.ok ? 'accepted' : r.error, u).toBe('query_not_allowed')
    }
  })
  it('backgroundOnly: masteries and open-ended season listings', () => {
    expect(backgroundOnly('/lol/champion-mastery/v4/champion-masteries/by-puuid/a/top', new URLSearchParams())).toBe(true)
    expect(backgroundOnly('/lol/match/v5/matches/by-puuid/a/ids', new URLSearchParams('startTime=1'))).toBe(true)
    expect(backgroundOnly('/lol/match/v5/matches/by-puuid/a/ids', new URLSearchParams('startTime=1&endTime=2'))).toBe(false)
    expect(backgroundOnly('/lol/match/v5/matches/by-puuid/a/ids', new URLSearchParams('count=1'))).toBe(false)
  })
})

describe('P1-1 what is shared', () => {
  it('only a finished game\'s match and timeline', () => {
    expect(isImmutableRiotPath('/lol/match/v5/matches/EUW1_123')).toBe(true)
    expect(isImmutableRiotPath('/lol/match/v5/matches/EUW1_123/timeline')).toBe(true)
    expect(isImmutableRiotPath('/lol/match/v5/matches/by-puuid/abc/ids')).toBe(false)
    expect(isImmutableRiotPath('/lol/league/v4/entries/by-puuid/abc')).toBe(false)
    expect(isImmutableRiotPath('/riot/account/v1/accounts/by-puuid/abc')).toBe(false)
    expect(cacheKeyFor('europe', '/lol/match/v5/matches/EUW1_1')).toBe('europe/lol/match/v5/matches/EUW1_1')
  })

  it('never an error, an empty body or something that is not JSON', () => {
    const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer
    expect(shouldStore(200, buf('{"info":{}}'), 'application/json;charset=utf-8')).toBe(true)
    expect(shouldStore(404, buf('{"status":{}}'), 'application/json')).toBe(false)
    expect(shouldStore(200, buf(''), 'application/json')).toBe(false)
    expect(shouldStore(200, buf('<html>'), 'text/html')).toBe(false)
  })
})

describe('P1-10 endpoint labels', () => {
  it('a fixed label per route, never the Riot ID or the puuid of the request', () => {
    const label = (path: string) => {
      const r = routeRequest('GET', new URL(`https://proxy.test/europe${path}`))
      return r.ok ? r.endpoint : r.error
    }
    expect(label('/riot/account/v1/accounts/by-riot-id/Ayura/EUW')).toBe('/riot/account/v1/accounts/by-riot-id/{name}/{tag}')
    expect(label('/riot/account/v1/accounts/by-puuid/short-puuid')).toBe('/riot/account/v1/accounts/by-puuid/{id}')
    expect(label('/lol/match/v5/matches/EUW1_42/timeline')).toBe('/lol/match/v5/matches/{matchId}/timeline')
  })
})

// ── The request flow ────────────────────────────────────────────────────────

const MATCH_URL = 'https://proxy.test/europe/lol/match/v5/matches/EUW1_7'
const IDS_URL = 'https://proxy.test/europe/lol/match/v5/matches/by-puuid/abc/ids?count=20'

function memoryStore(): ResponseStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    async get(key) {
      const v = data.get(key)
      return v === undefined ? null : { body: new TextEncoder().encode(v).buffer as ArrayBuffer, contentType: 'application/json' }
    },
    async put(key, body) { data.set(key, new TextDecoder().decode(body)) },
  }
}

function setup(over: Partial<HandlerDeps> = {}, budget?: BudgetGate) {
  const pending: Promise<unknown>[] = []
  const lines: string[] = []
  const riot = vi.fn(async () => new Response('{"metadata":{"matchId":"EUW1_7"}}', { status: 200, headers: { 'content-type': 'application/json;charset=utf-8', 'x-app-rate-limit-count': '1:1' } }))
  const store = memoryStore()
  const deps: HandlerDeps = {
    verifyUser: async (req) => (req.headers.get('authorization') === 'Bearer ok' ? { sub: 'user-1' } : null),
    fetchRiot: riot,
    store,
    budget,
    waitUntil: (p) => { pending.push(p) },
    log: (l) => { lines.push(l) },
    ...over,
  }
  const call = async (url: string, headers: Record<string, string> = {}) => {
    const res = await handleRequest(new Request(url, { headers: { authorization: 'Bearer ok', ...headers } }), { RIOT_API_KEY: 'RGAPI-test' }, deps)
    await Promise.all(pending.splice(0))
    return res
  }
  const metrics = () => lines.map((l) => JSON.parse(l)).filter((m) => m.metric === 'riot_proxy')
  return { call, riot, store, metrics, lines }
}

describe('request flow', () => {
  it('P1-1: the second request for a finished game is served from the store, Riot called once', async () => {
    const { call, riot, store } = setup()
    const first = await call(MATCH_URL)
    expect(first.status).toBe(200)
    expect(first.headers.get('x-nxm-cache')).toBe('miss')
    expect(await first.json()).toEqual({ metadata: { matchId: 'EUW1_7' } })
    expect(store.data.has('europe/lol/match/v5/matches/EUW1_7')).toBe(true)

    const second = await call(MATCH_URL)
    expect(second.headers.get('x-nxm-cache')).toBe('hit')
    expect(await second.json()).toEqual({ metadata: { matchId: 'EUW1_7' } })
    expect(riot).toHaveBeenCalledTimes(1)
    expect(riot).toHaveBeenCalledWith('https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_7', { headers: { 'X-Riot-Token': 'RGAPI-test' } })
  })

  it('P1-1: match id lists are never stored, nor an error', async () => {
    const { call, riot, store } = setup()
    await call(IDS_URL)
    await call(IDS_URL)
    expect(riot).toHaveBeenCalledTimes(2)
    const failing = setup({ fetchRiot: vi.fn(async () => new Response('{"status":{"status_code":404}}', { status: 404, headers: { 'content-type': 'application/json' } })) })
    expect((await failing.call(MATCH_URL)).status).toBe(404)
    expect(failing.store.data.size).toBe(0)
    expect(store.data.size).toBe(0)
  })

  it('P1-2: a full budget answers 429 with Retry-After before Riot, and a stored game still passes', async () => {
    const acquire = vi.fn(async () => ({ ok: false as const, retryAfterMs: 4200 }))
    const { call, riot, store } = setup({}, { acquire, penalize: vi.fn(async () => {}) })
    const res = await call(IDS_URL, { 'x-nxm-priority': 'background' })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('5')
    expect(res.headers.get('x-rate-limit-type')).toBe('proxy-global')
    expect(acquire).toHaveBeenCalledWith('europe', 'background', 'user-1')
    expect(riot).not.toHaveBeenCalled()

    store.data.set('europe/lol/match/v5/matches/EUW1_7', '{"stored":true}')
    const hit = await call(MATCH_URL)
    expect(hit.status).toBe(200)
    expect(await hit.json()).toEqual({ stored: true })
  })

  it('P1-2: no priority header counts as interactive (older apps), and Riot\'s 429 penalizes the host', async () => {
    const acquire = vi.fn(async () => ({ ok: true as const }))
    const penalize = vi.fn(async () => {})
    const { call } = setup({ fetchRiot: vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '12' } })) }, { acquire, penalize })
    const res = await call(IDS_URL)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('12')
    expect(acquire).toHaveBeenCalledWith('europe', 'interactive', 'user-1')
    expect(penalize).toHaveBeenCalledWith('europe', 12)
  })

  it('P1-2: if the budget cannot be reached, an interactive call still goes through', async () => {
    const { call, riot, lines } = setup({}, { acquire: async () => { throw new Error('DO down') }, penalize: async () => {} })
    expect((await call(IDS_URL)).status).toBe(200)
    expect(riot).toHaveBeenCalledTimes(1)
    expect(lines.some((l) => l.includes('budget_unreachable'))).toBe(true)
  })

  it('budget unreachable: a background call gets 503 with Retry-After 30, Riot not called', async () => {
    const { call, riot, metrics } = setup({}, { acquire: async () => { throw new Error('DO down') }, penalize: async () => {} })
    const res = await call(IDS_URL, { 'x-nxm-priority': 'background' })
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(riot).not.toHaveBeenCalled()
    expect(metrics().at(-1)?.outcome).toBe('budget_unreachable')
  })

  it('the endpoint overrules the client: masteries and season listings are background, whatever the header', async () => {
    const priorities: string[] = []
    const acquire = vi.fn(async (_host: string, priority: string) => { priorities.push(priority); return { ok: true as const } })
    const { call } = setup({}, { acquire, penalize: async () => {} })
    await call('https://proxy.test/euw1/lol/champion-mastery/v4/champion-masteries/by-puuid/abc/top?count=20')
    await call('https://proxy.test/europe/lol/match/v5/matches/by-puuid/abc/ids?queue=420&startTime=1700000000&start=0&count=100')
    await call('https://proxy.test/europe/lol/match/v5/matches/by-puuid/abc/ids?startTime=1700000000&endTime=1700003600&start=0&count=20')
    expect(priorities).toEqual(['background', 'background', 'interactive'])
  })

  it('a user over their share gets their own 429 type', async () => {
    const { call } = setup({}, { acquire: async () => ({ ok: false as const, retryAfterMs: 1000, reason: 'user_share' }), penalize: async () => {} })
    const res = await call(IDS_URL)
    expect(res.status).toBe(429)
    expect(res.headers.get('x-rate-limit-type')).toBe('proxy-user-share')
    expect(await res.json()).toEqual({ error: 'user_share_exceeded' })
  })

  it('P1-10: one metric per request, with the outcome, and nothing personal', async () => {
    const { call, metrics } = setup()
    await call(MATCH_URL)
    await call(MATCH_URL)
    await call('https://proxy.test/europe/riot/account/v1/accounts/by-riot-id/Ayura/EUW')
    expect(metrics().map((m) => [m.endpoint, m.outcome, m.status])).toEqual([
      ['/lol/match/v5/matches/{matchId}', 'upstream', 200],
      ['/lol/match/v5/matches/{matchId}', 'cache_hit', 200],
      ['/riot/account/v1/accounts/by-riot-id/{name}/{tag}', 'upstream', 200],
    ])
    const all = JSON.stringify(metrics())
    expect(all).not.toContain('Ayura')
    expect(all).not.toContain('EUW1_7')
    expect(all).not.toContain('user-1')
  })

  it('writes the metric to Analytics Engine when bound', async () => {
    const writeDataPoint = vi.fn()
    const res = await handleRequest(new Request(MATCH_URL, { headers: { authorization: 'Bearer ok' } }), { RIOT_API_KEY: 'k', METRICS: { writeDataPoint } }, {
      verifyUser: async () => ({ sub: 'u' }),
      fetchRiot: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      waitUntil: () => {},
      log: () => {},
    })
    expect(res.status).toBe(200)
    expect(writeDataPoint).toHaveBeenCalledWith(expect.objectContaining({ blobs: ['/lol/match/v5/matches/{matchId}', 'europe', 'upstream', 'interactive'] }))
  })

  it('keeps the existing rules: login required, CORS allows the priority header, key rejection hidden', async () => {
    const { call } = setup()
    expect((await handleRequest(new Request(MATCH_URL), { RIOT_API_KEY: 'k' }, { verifyUser: async () => null, fetchRiot: vi.fn(), waitUntil: () => {} })).status).toBe(401)
    const pre = await handleRequest(new Request(MATCH_URL, { method: 'OPTIONS' }), { RIOT_API_KEY: 'k' }, { verifyUser: async () => null, fetchRiot: vi.fn(), waitUntil: () => {} })
    expect(pre.headers.get('access-control-allow-headers')).toContain('x-nxm-priority')
    const rejected = setup({ fetchRiot: async () => new Response('', { status: 403 }) })
    const res = await rejected.call(MATCH_URL)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'riot_key_rejected' })
    expect((await call('https://proxy.test/europe/lol/status/v4/platform-data')).status).toBe(403)
  })
})
