/**
 * Ascend Riot API proxy (Cloudflare Worker).
 *
 * Keeps the Riot API key out of the desktop app: the app sends its Supabase
 * access token, the Worker checks it, applies a per-player rate limit and
 * forwards the (allow-listed, read-only) call to Riot with the key stored as
 * a Worker secret. The request flow itself is in handler.ts.
 *
 * Phase 1 of docs/prod/PLAN_CLE_PROD.md (each binding optional: without it, the
 * Worker behaves as before):
 *   MATCH_STORE  R2 bucket   — P1-1, finished games' match and timeline shared by everyone
 *   RIOT_BUDGET  Durable Obj — P1-2, one budget for the whole key, with a reserve for interactive calls
 *   METRICS      Analytics   — P1-10, calls, Riot calls, cache hits and 429s per endpoint
 *
 * Secrets / vars (see wrangler.toml):
 *   RIOT_API_KEY         secret — the Riot API key
 *   SUPABASE_URL         var    — https://<ref>.supabase.co
 *   SUPABASE_JWT_SECRET  secret — only if the project still signs JWTs with
 *                                 the legacy shared secret (HS256)
 *   RIOT_APP_LIMITS, INTERACTIVE_RESERVE  vars — the budget (budgetObject.ts)
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { handleRequest, type BudgetGate, type R2CostGuard, type ResponseStore, type HandlerEnv } from './handler'
import { R2_GUARD_NAME, type BudgetObjectEnv } from './budgetObject'

export { RiotBudgetObject } from './budgetObject'

export interface Env extends HandlerEnv, BudgetObjectEnv {
  SUPABASE_URL: string
  SUPABASE_JWT_SECRET?: string
  MATCH_STORE?: R2Bucket
  RIOT_BUDGET?: DurableObjectNamespace
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

async function verifyUser(req: Request, env: Env): Promise<JWTPayload | null> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  const issuer = `${env.SUPABASE_URL}/auth/v1`
  try {
    if (env.SUPABASE_JWT_SECRET) {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), {
        issuer,
        audience: 'authenticated',
      })
      return payload
    }
    jwks ??= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' })
    return payload
  } catch {
    return null
  }
}

/** P1-1: R2, global and durable. (The Cache API would do nothing on a *.workers.dev address.) */
function r2Store(bucket: R2Bucket): ResponseStore {
  return {
    async get(key) {
      const obj = await bucket.get(key)
      return obj ? { body: await obj.arrayBuffer(), contentType: obj.httpMetadata?.contentType ?? 'application/json' } : null
    },
    async put(key, body, contentType) {
      await bucket.put(key, body, { httpMetadata: { contentType } })
    },
  }
}

/** The R2 cost guard: the Durable Object instance R2_GUARD_NAME counts R2 use for the month (r2Guard.ts). */
function r2CostGuard(ns: DurableObjectNamespace): R2CostGuard {
  const stub = ns.get(ns.idFromName(R2_GUARD_NAME))
  return {
    async allow(op, bytes) {
      const res = await stub.fetch(`https://budget/r2/allow?op=${op}&bytes=${Math.max(0, Math.round(bytes))}`)
      return ((await res.json()) as { allow?: boolean }).allow === true
    },
  }
}

/** P1-2: one Durable Object per Riot host. */
function budgetGate(ns: DurableObjectNamespace): BudgetGate {
  const stub = (host: string) => ns.get(ns.idFromName(host))
  return {
    async acquire(host, priority, user) {
      const res = await stub(host).fetch(`https://budget/acquire?priority=${priority}&user=${encodeURIComponent(user)}`)
      return res.json()
    },
    async penalize(host, retryAfterSec) {
      await stub(host).fetch(`https://budget/penalize?seconds=${encodeURIComponent(String(retryAfterSec))}`)
    },
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(req, env, {
      verifyUser: (r) => verifyUser(r, env) as Promise<{ sub?: string; is_anonymous?: boolean } | null>,
      fetchRiot: (url, init) => fetch(url, init),
      // The store is only used with its cost guard (no Durable Object binding, no R2).
      store: env.MATCH_STORE && env.RIOT_BUDGET ? r2Store(env.MATCH_STORE) : undefined,
      r2Guard: env.RIOT_BUDGET ? r2CostGuard(env.RIOT_BUDGET) : undefined,
      budget: env.RIOT_BUDGET ? budgetGate(env.RIOT_BUDGET) : undefined,
      waitUntil: (p) => ctx.waitUntil(p),
    })
  },
}
