import { describe, it, expect, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { authStorageKey, authTimeoutFetch, signOutThisDevice, sessionForStatus } from '../../src/lib/accessCore'

/**
 * Bug #2 (reported 17/11/2026): "infinite loading / can't sign back in after
 * signing out". Drives the real supabase-js client against a fake auth server.
 */

const URL_ = 'https://abcdefgh.supabase.co'

function session(n: number, expiresIn = 3600) {
  const exp = Math.floor(Date.now() / 1000) + expiresIn
  const payload = Buffer.from(JSON.stringify({ sub: 'u1', exp, aud: 'authenticated', role: 'authenticated', session_id: `s${n}` })).toString('base64url')
  return {
    access_token: `h.${payload}.sig`, token_type: 'bearer', expires_in: expiresIn, expires_at: exp, refresh_token: `r${n}`,
    user: { id: 'u1', email: 'a@b.c', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' },
  }
}

type Server = { logout: 'ok' | 'error' | 'offline' | 'silent'; refresh: 'ok' | 'silent' | 'offline' }

function fakeAuthServer(server: Server): typeof fetch {
  let n = 0
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const silent = (init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
  })
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('grant_type=password')) return json(200, session(++n))
    if (url.includes('grant_type=refresh_token')) {
      if (server.refresh === 'offline') throw new TypeError('fetch failed')
      return server.refresh === 'silent' ? silent(init) : json(200, session(++n))
    }
    if (url.includes('/logout')) {
      if (server.logout === 'offline') throw new TypeError('fetch failed')
      if (server.logout === 'silent') return silent(init)
      return server.logout === 'ok' ? new Response(null, { status: 204 }) : json(500, { msg: 'Internal Server Error' })
    }
    return json(404, {})
  }) as typeof fetch
}

function makeClient(server: Server, timeoutMs = 50) {
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } }
  const sb = createClient(URL_, 'anon-key-for-tests-only-000000', {
    auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: authTimeoutFetch(timeoutMs, fakeAuthServer(server)) },
  })
  const events: string[] = []
  sb.auth.onAuthStateChange((e) => { events.push(e) })
  const uiSignedOut: number[] = []
  const forget = () => {
    const key = authStorageKey(sb, URL_)
    storage.removeItem(key)
    storage.removeItem(`${key}-code-verifier`)
    uiSignedOut.push(1)
  }
  return { sb, store, events, uiSignedOut, forget }
}

describe('sign out, then sign back in', () => {
  for (const logout of ['ok', 'error', 'offline', 'silent'] as const) {
    it(`works when the logout request is ${logout}`, async () => {
      const { sb, uiSignedOut, forget } = makeClient({ logout, refresh: 'ok' })
      await sb.auth.signInWithPassword({ email: 'a@b.c', password: 'abc12345' })
      expect((await sb.auth.getSession()).data.session).not.toBeNull()

      const res = await signOutThisDevice(sb, forget)
      expect(res.serverReached).toBe(logout === 'ok')
      // The session is gone either way, and the UI was told when auth-js could not.
      expect((await sb.auth.getSession()).data.session).toBeNull()
      expect(uiSignedOut.length).toBe(logout === 'ok' ? 0 : 1)

      const again = await sb.auth.signInWithPassword({ email: 'a@b.c', password: 'abc12345' })
      expect(again.error).toBeNull()
      expect((await sb.auth.getSession()).data.session?.user.id).toBe('u1')
    }, 10_000)
  }
})

// Audit review of #2 (P1): a failed refresh came back as { session: null,
// error }, and the status said "signed out", so the sign-in form showed
// instead of "server unreachable".
describe('cloud status with an expired session and an unreachable auth server', () => {
  it('rejects with AUTH_UNREACHABLE instead of reporting nobody signed in', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const { sb, store } = makeClient({ logout: 'ok', refresh: 'offline' })
      store.set(authStorageKey(sb, URL_), JSON.stringify(session(0, -60)))
      const status = sessionForStatus(sb)
      const settled = status.then(() => 'resolved', (e: Error) => e.message)
      await vi.runAllTimersAsync()
      expect(await settled).toBe('AUTH_UNREACHABLE')
      // The stored session is kept: once the server answers, the user is still signed in.
      expect(store.get(authStorageKey(sb, URL_))).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
  it('still reports nobody signed in when there is simply no session', async () => {
    const { sb } = makeClient({ logout: 'ok', refresh: 'offline' })
    await expect(sessionForStatus(sb)).resolves.toBeNull()
  })
})

// The other half of the bug, a cold start with an expired session while the
// auth server never answers, was checked by hand on 19/11/2026: without
// authTimeoutFetch getSession() stays pending, with it it settles after
// auth-js's own ~25 s of retries. Too slow for the suite: the deadline itself
// is covered by "authTimeoutFetch" in accessCore.test.ts.
