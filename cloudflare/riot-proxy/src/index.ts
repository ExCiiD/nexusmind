/**
 * Ascend Riot API proxy (Cloudflare Worker).
 *
 * Keeps the Riot API key out of the desktop app: the app sends its Supabase
 * access token, the Worker checks it, applies a per-player rate limit and
 * forwards the (allow-listed, read-only) call to Riot with the key stored as
 * a Worker secret.
 *
 * Secrets / vars (see wrangler.toml and README.md):
 *   RIOT_API_KEY         secret — the Riot API key
 *   SUPABASE_URL         var    — https://<ref>.supabase.co
 *   SUPABASE_JWT_SECRET  secret — only if the project still signs JWTs with
 *                                 the legacy shared secret (HS256)
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { routeRequest, FORWARDED_HEADERS } from './routing'

export interface Env {
  RIOT_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_JWT_SECRET?: string
  /** Workers Rate Limiting binding (optional: skipped when not configured). */
  USER_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> }
}

// CORS: the web app calls this proxy directly from the browser with a
// Supabase bearer token (web/src/riotWeb.ts, E14) — the packaged desktop
// app's main-process fetch isn't subject to CORS at all, so this only
// matters for the browser caller. `*` is safe here because auth is a
// bearer token, not a cookie: a third-party page reading the response
// would still need the victim's token in hand to have sent the request in
// the first place, which CORS alone can't give it.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization',
  'access-control-max-age': '600',
}

const json = (status: number, body: Record<string, unknown>, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...extra } })

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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })

    const url = new URL(req.url)
    if (url.pathname === '/health') return json(200, { ok: true })

    const route = routeRequest(req.method, url)
    if (!route.ok) return json(route.status, { error: route.error })

    // A real (non-anonymous) Ascend account is required.
    const user = await verifyUser(req, env)
    if (!user?.sub || (user as any).is_anonymous) return json(401, { error: 'login_required' })

    if (env.USER_LIMITER) {
      const { success } = await env.USER_LIMITER.limit({ key: user.sub })
      if (!success) return json(429, { error: 'user_rate_limited' }, { 'retry-after': '10', 'x-rate-limit-type': 'proxy-user' })
    }

    const upstream = await fetch(route.upstream, { headers: { 'X-Riot-Token': env.RIOT_API_KEY } })

    const headers = new Headers(CORS_HEADERS)
    for (const h of FORWARDED_HEADERS) {
      const v = upstream.headers.get(h)
      if (v) headers.set(h, v)
    }
    // Never leak an upstream auth failure as "your session is invalid".
    if (upstream.status === 401 || upstream.status === 403) {
      console.error(`Riot rejected the proxy key (${upstream.status}) on ${route.endpoint}`)
      return json(502, { error: 'riot_key_rejected' })
    }
    return new Response(upstream.body, { status: upstream.status, headers })
  },
}
