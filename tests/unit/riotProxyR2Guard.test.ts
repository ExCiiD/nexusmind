/**
 * The R2 cost guard of the Riot proxy (user's request, 19/11/2026: at most €2 a month above the free tier):
 * the cost estimate, the decision, the Durable Object's counters, and the request flow that never uses R2 uncounted.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  decideR2, extraCostUSD, currentUsage, freeTierShare, parseBudgetUSD, R2_FREE, emptyUsage, type R2Usage,
} from '../../cloudflare/riot-proxy/src/r2Guard'
import { RiotBudgetObject } from '../../cloudflare/riot-proxy/src/budgetObject'
import { handleRequest, type HandlerDeps } from '../../cloudflare/riot-proxy/src/handler'

const NOW = Date.parse('2026-11-19T12:00:00Z')
const usage = (o: Partial<R2Usage>): R2Usage => ({ ...emptyUsage(NOW), ...o })

describe('cost estimate', () => {
  it('nothing extra inside the free tier', () => {
    expect(extraCostUSD(usage({ classA: R2_FREE.classA, classB: R2_FREE.classB, bytesByDay: { '2026-11-19': 10e9 } }))).toBe(0)
  })
  it('each part above the free tier, at the published prices', () => {
    expect(extraCostUSD(usage({ classA: R2_FREE.classA + 1_000_000 }))).toBeCloseTo(4.5)
    expect(extraCostUSD(usage({ classB: R2_FREE.classB + 1_000_000 }))).toBeCloseTo(0.36)
    expect(extraCostUSD(usage({ bytesByDay: { '2026-11-19': 30e9 } }))).toBeCloseTo(0.3) // 20 GB extra × 0.015
  })
  it('a new month resets operations, storage keeps the last 90 days', () => {
    const u = usage({ month: '2026-10', classA: 5, classB: 9, bytesByDay: { '2026-10-30': 100, '2026-08-01': 999 } })
    expect(currentUsage(u, NOW)).toEqual({ month: '2026-11', classA: 0, classB: 0, bytesByDay: { '2026-10-30': 100 } })
  })
  it('free tier share: the highest of the three', () => {
    expect(freeTierShare(usage({ classA: 800_000, classB: 1 }))).toBeCloseTo(0.8)
  })
  it('the budget setting, 2 USD by default', () => {
    expect(parseBudgetUSD(undefined)).toBe(2)
    expect(parseBudgetUSD('1.5')).toBe(1.5)
    expect(parseBudgetUSD('-1')).toBe(2)
    expect(parseBudgetUSD('1000')).toBe(2)
  })
})

describe('decision', () => {
  it('counts what it allows: a read is Class B, a write Class A and its bytes', () => {
    const r = decideR2(null, 'read', 0, 2, NOW)
    expect(r).toMatchObject({ allow: true, usage: { classA: 0, classB: 1 } })
    const w = decideR2(r.usage, 'write', 1_500_000, 2, NOW)
    expect(w).toMatchObject({ allow: true, usage: { classA: 1, classB: 1, bytesByDay: { '2026-11-19': 1_500_000 } } })
  })
  it('refuses the operation that would reach the budget, and does not count it', () => {
    // 1 M free + 444 444 Class A ≈ 1.99998 USD extra: the next write would cross 2 USD.
    const near = usage({ classA: R2_FREE.classA + 444_444 })
    expect(extraCostUSD(near)).toBeLessThan(2)
    const r = decideR2(near, 'write', 1000, 2, NOW)
    expect(r.allow).toBe(false)
    expect(r.usage.classA).toBe(near.classA)
    // Reads are still cheap enough there.
    expect(decideR2(near, 'read', 0, 2, NOW).allow).toBe(true)
  })
  it('a zero budget stops R2 as soon as the free tier is used up', () => {
    expect(decideR2(usage({ classA: R2_FREE.classA - 1 }), 'write', 0, 0, NOW).allow).toBe(false)
    expect(decideR2(usage({ classA: R2_FREE.classA - 2 }), 'write', 0, 0.000001, NOW).allow).toBe(true)
  })
})

describe('Durable Object counters', () => {
  const storage = () => {
    const m = new Map<string, unknown>()
    return { get: async <T>(k: string) => m.get(k) as T | undefined, put: async <T>(k: string, v: T) => { m.set(k, v) } }
  }
  it('keeps the month\'s counters in durable storage across instances, and reports them', async () => {
    const s = storage()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = new RiotBudgetObject({ storage: s }, { R2_EXTRA_BUDGET_USD: '2' })
    expect(await (await a.fetch(new Request('https://budget/r2/allow?op=write&bytes=2000'))).json()).toMatchObject({ allow: true })
    expect(await (await a.fetch(new Request('https://budget/r2/allow?op=read'))).json()).toMatchObject({ allow: true })
    // A new instance (the object was evicted) reads the same counters.
    const b = new RiotBudgetObject({ storage: s }, {})
    const u = await (await b.fetch(new Request('https://budget/r2/usage'))).json() as any
    expect(u).toMatchObject({ classA: 1, classB: 1, extraUSD: 0, budgetUSD: 2 })
    warn.mockRestore()
  })
  it('refuses past the budget and logs it', async () => {
    const s = storage()
    await s.put('r2usage', { ...emptyUsage(Date.now()), classA: R2_FREE.classA + 444_444 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const o = new RiotBudgetObject({ storage: s }, {})
    expect(await (await o.fetch(new Request('https://budget/r2/allow?op=write&bytes=10'))).json()).toMatchObject({ allow: false })
    expect(warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('r2_cost_guard_stopped'))).toBe(true)
    expect(warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('"percent":100'))).toBe(true)
    warn.mockRestore()
  })
})

describe('request flow with the guard', () => {
  const MATCH_URL = 'https://proxy.test/europe/lol/match/v5/matches/EUW1_7'
  const run = async (guard: HandlerDeps['r2Guard'], storeHas = false) => {
    const pending: Promise<unknown>[] = []
    const store = { get: vi.fn(async () => (storeHas ? { body: new TextEncoder().encode('{"stored":1}').buffer as ArrayBuffer, contentType: 'application/json' } : null)), put: vi.fn(async () => {}) }
    const riot = vi.fn(async () => new Response('{"fresh":1}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const res = await handleRequest(new Request(MATCH_URL, { headers: { authorization: 'Bearer ok' } }), { RIOT_API_KEY: 'k' }, {
      verifyUser: async () => ({ sub: 'u' }), fetchRiot: riot, store, r2Guard: guard, waitUntil: (p) => { pending.push(p) }, log: () => {},
    })
    await Promise.all(pending)
    return { res, store, riot }
  }
  it('guard allows: read then write as before', async () => {
    const { res, store } = await run({ allow: async () => true })
    expect(res.headers.get('x-nxm-cache')).toBe('miss')
    expect(store.get).toHaveBeenCalledTimes(1)
    expect(store.put).toHaveBeenCalledTimes(1)
  })
  it('guard refuses: R2 is not touched, Riot answers', async () => {
    const { res, store, riot } = await run({ allow: async () => false }, true)
    expect(await res.json()).toEqual({ fresh: 1 })
    expect(store.get).not.toHaveBeenCalled()
    expect(store.put).not.toHaveBeenCalled()
    expect(riot).toHaveBeenCalledTimes(1)
  })
  it('guard unreachable or missing: R2 is not touched either', async () => {
    const down = await run({ allow: async () => { throw new Error('DO down') } }, true)
    expect(down.store.get).not.toHaveBeenCalled()
    expect(down.store.put).not.toHaveBeenCalled()
    const none = await run(undefined, true)
    expect(none.store.get).not.toHaveBeenCalled()
  })
  it('reads allowed, a write refused: the answer is served, nothing stored', async () => {
    const { res, store } = await run({ allow: async (op) => op === 'read' })
    expect(res.status).toBe(200)
    expect(store.put).not.toHaveBeenCalled()
  })
})
