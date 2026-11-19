/**
 * The proxy's request flow, with its dependencies passed in (index.ts wires the real ones), so it runs in unit
 * tests without the Workers runtime or jose.
 *
 *   route check → login → per-user limit → shared store (P1-1) → global budget (P1-2) → Riot → store → metrics (P1-10)
 *
 * A stored match or timeline is served before the budget is asked: it costs nothing on the key.
 */
import { routeRequest, FORWARDED_HEADERS, backgroundOnly } from './routing'
import { isImmutableRiotPath, cacheKeyFor, shouldStore, MAX_STORED_BYTES } from './cachePolicy'
import { recordMetric, type AnalyticsDataset, type Outcome } from './metrics'
import type { Priority } from './budget'

/** The shared store of immutable answers (R2 in production, see index.ts). */
export interface ResponseStore {
  get(key: string): Promise<{ body: ArrayBuffer; contentType: string } | null>
  put(key: string, body: ArrayBuffer, contentType: string): Promise<void>
}

/** The R2 cost guard: true when one more read or write stays under the monthly extra-cost budget. */
export interface R2CostGuard {
  allow(op: 'read' | 'write', bytes: number): Promise<boolean>
}

/** The global budget for one Riot host (a Durable Object in production). `user`: whose share the call counts in. */
export interface BudgetGate {
  acquire(host: string, priority: Priority, user: string): Promise<{ ok: true } | { ok: false; retryAfterMs: number; reason?: string }>
  penalize(host: string, retryAfterSec: number): Promise<void>
}

export interface HandlerEnv {
  RIOT_API_KEY: string
  USER_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> }
  METRICS?: AnalyticsDataset
}

export interface HandlerDeps {
  verifyUser: (req: Request) => Promise<{ sub?: string; is_anonymous?: boolean } | null>
  fetchRiot: (url: string, init: RequestInit) => Promise<Response>
  store?: ResponseStore
  /**
   * The R2 cost guard (r2Guard.ts): asked before every read and write of the store. The store is only used with a
   * guard, and a guard that cannot be reached means "no": R2 never runs uncounted.
   */
  r2Guard?: R2CostGuard
  budget?: BudgetGate
  /** Work that may finish after the answer (ctx.waitUntil). */
  waitUntil: (p: Promise<unknown>) => void
  now?: () => number
  log?: (line: string) => void
}

// CORS: the web app calls this proxy directly from the browser with a Supabase bearer token (web/src/riotWeb.ts,
// E14). `*` is safe here because auth is a bearer token, not a cookie. x-nxm-priority is the P1-2 priority hint.
export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, x-nxm-priority',
  'access-control-max-age': '600',
}

/** P1-2: `background` for scouts and synergy, anything else (or nothing, older apps) counts as interactive. */
export const PRIORITY_HEADER = 'x-nxm-priority'

const json = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...extra } })

export async function handleRequest(req: Request, env: HandlerEnv, deps: HandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })

  const url = new URL(req.url)
  if (url.pathname === '/health') return json(200, { ok: true })

  const route = routeRequest(req.method, url)
  if (!route.ok) return json(route.status, { error: route.error })

  // A real (non-anonymous) Ascend account is required.
  const user = await deps.verifyUser(req)
  if (!user?.sub || user.is_anonymous) return json(401, { error: 'login_required' })

  const now = deps.now ?? Date.now
  const started = now()
  // The client's hint, overruled by the endpoint when it is only ever used by background work (a scout cannot
  // claim the interactive reserve by leaving the header out).
  const priority: Priority = backgroundOnly(route.path, url.searchParams) || req.headers.get(PRIORITY_HEADER) === 'background'
    ? 'background'
    : 'interactive'
  const metric = (outcome: Outcome, status: number) =>
    recordMetric(env.METRICS, { endpoint: route.endpoint, host: route.host, outcome, priority, status, ms: now() - started }, deps.log)

  if (env.USER_LIMITER) {
    const { success } = await env.USER_LIMITER.limit({ key: user.sub })
    if (!success) {
      metric('user_limited', 429)
      return json(429, { error: 'user_rate_limited' }, { 'retry-after': '10', 'x-rate-limit-type': 'proxy-user' })
    }
  }

  // P1-1: a finished game's match and timeline, already fetched by anyone.
  const storable = isImmutableRiotPath(route.path) && route.query === '' && deps.store !== undefined && deps.r2Guard !== undefined
  const key = cacheKeyFor(route.host, route.path)
  const guardAllows = async (op: 'read' | 'write', bytes: number): Promise<boolean> => {
    try {
      const ok = await deps.r2Guard!.allow(op, bytes)
      if (!ok) metric('r2_guard_stopped', 0)
      return ok
    } catch (err) {
      deps.log?.(JSON.stringify({ warn: 'r2_guard_unreachable', message: (err as Error)?.message }))
      return false
    }
  }
  if (storable && await guardAllows('read', 0)) {
    try {
      const hit = await deps.store!.get(key)
      if (hit) {
        metric('cache_hit', 200)
        return new Response(hit.body, { status: 200, headers: { ...CORS_HEADERS, 'content-type': hit.contentType, 'x-nxm-cache': 'hit' } })
      }
    } catch (err) {
      deps.log?.(JSON.stringify({ warn: 'store_read_failed', message: (err as Error)?.message }))
    }
  }

  // P1-2: the shared budget answers 429 before Riot would. If it cannot be reached, only interactive calls go
  // through (Riot's own limits still apply): the end of a game keeps working, background work waits 30 s.
  if (deps.budget) {
    try {
      const slot = await deps.budget.acquire(route.host, priority, user.sub)
      if (!slot.ok) {
        metric('proxy_limited', 429)
        return json(429, { error: slot.reason === 'user_share' ? 'user_share_exceeded' : 'proxy_rate_limited' }, {
          'retry-after': String(Math.max(1, Math.ceil(slot.retryAfterMs / 1000))),
          'x-rate-limit-type': slot.reason === 'user_share' ? 'proxy-user-share' : 'proxy-global',
        })
      }
    } catch (err) {
      deps.log?.(JSON.stringify({ warn: 'budget_unreachable', message: (err as Error)?.message }))
      if (priority === 'background') {
        metric('budget_unreachable', 503)
        return json(503, { error: 'budget_unavailable' }, { 'retry-after': '30' })
      }
    }
  }

  let upstream: Response
  try {
    upstream = await deps.fetchRiot(route.upstream, { headers: { 'X-Riot-Token': env.RIOT_API_KEY } })
  } catch {
    metric('upstream_error', 502)
    return json(502, { error: 'riot_unreachable' })
  }

  // Never leak an upstream auth failure as "your session is invalid".
  if (upstream.status === 401 || upstream.status === 403) {
    console.error(`Riot rejected the proxy key (${upstream.status}) on ${route.endpoint}`)
    metric('riot_key_rejected', upstream.status)
    return json(502, { error: 'riot_key_rejected' })
  }
  if (upstream.status === 429 && deps.budget) {
    const retryAfter = Number(upstream.headers.get('retry-after'))
    deps.waitUntil(deps.budget.penalize(route.host, retryAfter).catch(() => {}))
  }

  const headers = new Headers(CORS_HEADERS)
  for (const h of FORWARDED_HEADERS) {
    const v = upstream.headers.get(h)
    if (v) headers.set(h, v)
  }
  metric('upstream', upstream.status)

  if (!storable || upstream.status !== 200) return new Response(upstream.body, { status: upstream.status, headers })

  // Read once, answer with it, and keep it for everyone else.
  const body = await upstream.arrayBuffer()
  const contentType = upstream.headers.get('content-type')
  if (shouldStore(upstream.status, body, contentType) && body.byteLength <= MAX_STORED_BYTES) {
    deps.waitUntil((async () => {
      if (!(await guardAllows('write', body.byteLength))) return
      await deps.store!.put(key, body, contentType ?? 'application/json')
    })().catch((err) => {
      deps.log?.(JSON.stringify({ warn: 'store_write_failed', message: (err as Error)?.message }))
    }))
  }
  headers.set('x-nxm-cache', 'miss')
  return new Response(body, { status: 200, headers })
}
