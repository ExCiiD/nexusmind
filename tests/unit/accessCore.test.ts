import { describe, it, expect, vi } from 'vitest'
import {
  INVITE_CODE,
  normaliseInviteCode,
  authErrorCode,
  sendSignInCode,
  redeemInvite,
  isAcceptablePassword,
  setPassword,
  signInWithPassword,
  hasPassword,
  signOutThisDevice,
  authTimeoutFetch,
  authStorageKey,
  retryRevoke,
  scheduleRevokeRetry,
  anySignal,
} from '../../src/lib/accessCore'

describe('password', () => {
  it('requires 8+ chars with a letter and a digit', () => {
    expect(isAcceptablePassword('abc12345')).toBe(true)
    expect(isAcceptablePassword('abcdefgh')).toBe(false)
    expect(isAcceptablePassword('12345678')).toBe(false)
    expect(isAcceptablePassword('ab1')).toBe(false)
    expect(isAcceptablePassword('a1'.repeat(40))).toBe(false) // > 72
  })
  it('maps wrong credentials', async () => {
    const sb = { auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } }) } } as never
    await expect(signInWithPassword(sb, 'a@b.com', 'abc12345')).rejects.toThrow('AUTH_BAD_PASSWORD')
  })
  it('stores the password and flags it in metadata', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null })
    await setPassword({ auth: { updateUser } } as never, 'abc12345')
    expect(updateUser).toHaveBeenCalledWith({ password: 'abc12345', data: { has_password: true } })
    await expect(setPassword({ auth: { updateUser } } as never, 'weak')).rejects.toThrow('AUTH_WEAK_PASSWORD')
  })
  it('reads the flag', () => {
    expect(hasPassword({ user_metadata: { has_password: true } })).toBe(true)
    expect(hasPassword({ user_metadata: {} })).toBe(false)
    expect(hasPassword(null)).toBe(false)
  })
})

describe('normaliseInviteCode', () => {
  it('strips spaces and dashes and upper-cases', () => {
    expect(normaliseInviteCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN')
    expect(normaliseInviteCode('  ab cd ef  ')).toBe('ABCDEF')
  })
  it('accepts valid codes only', () => {
    expect(INVITE_CODE.test(normaliseInviteCode('ABCD-EFGH-JKMN'))).toBe(true)
    expect(INVITE_CODE.test('abcd')).toBe(false) // lower case
    expect(INVITE_CODE.test('ABC')).toBe(false) // too short
    expect(INVITE_CODE.test('ABCDEFGHJ')).toBe(false) // 9: below what redeem-invite accepts (#44)
    expect(INVITE_CODE.test('ABCDEFGHJK')).toBe(true) // 10: a group invite
    expect(INVITE_CODE.test('A'.repeat(17))).toBe(false)
  })
})

describe('authErrorCode', () => {
  it('maps a closed-signup error to the invite prompt', () => {
    expect(authErrorCode('Signups not allowed for otp')).toBe('AUTH_NEEDS_INVITE')
    expect(authErrorCode('User not found')).toBe('AUTH_NEEDS_INVITE')
  })
  it('maps rate limit and invalid code', () => {
    expect(authErrorCode('Email rate limit exceeded')).toBe('AUTH_RATE_LIMITED')
    expect(authErrorCode('Token has expired or is invalid')).toBe('AUTH_INVALID_CODE')
  })
  it('falls through to the raw message', () => {
    expect(authErrorCode('boom')).toBe('boom')
    expect(authErrorCode(undefined)).toBe('AUTH_FAILED')
  })
})

describe('sendSignInCode', () => {
  it('does not create users (invite-only) and surfaces the needs-invite code', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: { message: 'Signups not allowed for otp' } })
    const sb = { auth: { signInWithOtp } } as never
    await expect(sendSignInCode(sb, 'a@b.com')).rejects.toThrow('AUTH_NEEDS_INVITE')
    expect(signInWithOtp).toHaveBeenCalledWith({ email: 'a@b.com', options: { shouldCreateUser: false } })
  })

  it('redeems the invite before sending the code', async () => {
    const calls: string[] = []
    const invoke = vi.fn().mockImplementation(async () => { calls.push('redeem'); return { data: { ok: true }, error: null } })
    const signInWithOtp = vi.fn().mockImplementation(async () => { calls.push('otp'); return { error: null } })
    const sb = { functions: { invoke }, auth: { signInWithOtp } } as never
    await sendSignInCode(sb, 'a@b.com', 'ABCDEFGHJKMN')
    expect(calls).toEqual(['redeem', 'otp'])
    expect(invoke).toHaveBeenCalledWith('redeem-invite', { method: 'POST', body: { email: 'a@b.com', code: 'ABCDEFGHJKMN' } })
  })
})

describe('redeemInvite', () => {
  it('maps a 400 to INVITE_INVALID and a 429 to AUTH_RATE_LIMITED', async () => {
    const sb400 = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { context: { status: 400 } } }) } } as never
    await expect(redeemInvite(sb400, 'a@b.com', 'X')).rejects.toThrow('INVITE_INVALID')
    const sb429 = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { context: { status: 429 } } }) } } as never
    await expect(redeemInvite(sb429, 'a@b.com', 'X')).rejects.toThrow('AUTH_RATE_LIMITED')
  })
  it('resolves when the function returns ok', async () => {
    const sb = { functions: { invoke: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }) } } as never
    await expect(redeemInvite(sb, 'a@b.com', 'X')).resolves.toBeUndefined()
  })
})

// Bug #2 (17/11/2026): "infinite loading / can't sign back in after signing out".
describe('signOutThisDevice', () => {
  it('signs out through the server and leaves local storage alone', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const forget = vi.fn()
    await expect(signOutThisDevice({ auth: { signOut } } as never, forget)).resolves.toEqual({ signedOut: true, serverReached: true, pendingRevoke: null })
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(forget).not.toHaveBeenCalled()
  })
  it('forgets the session locally when auth-js returns an error (server error, rate limit)', async () => {
    const forget = vi.fn()
    const sb = { auth: { signOut: vi.fn().mockResolvedValue({ error: { message: 'Internal Server Error', status: 500 } }) } } as never
    await expect(signOutThisDevice(sb, forget)).resolves.toEqual({ signedOut: true, serverReached: false, pendingRevoke: null })
    expect(forget).toHaveBeenCalledOnce()
  })
  it('forgets the session locally when the request throws (offline)', async () => {
    const forget = vi.fn().mockResolvedValue(undefined)
    const sb = { auth: { signOut: vi.fn().mockRejectedValue(new TypeError('fetch failed')) } } as never
    await expect(signOutThisDevice(sb, forget)).resolves.toMatchObject({ serverReached: false })
    expect(forget).toHaveBeenCalledOnce()
  })
})

describe('authTimeoutFetch', () => {
  const never = (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
  })
  it('aborts an auth request the server never answers', async () => {
    const f = authTimeoutFetch(20, never as typeof fetch)
    await expect(f('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', {})).rejects.toBeTruthy()
  })
  it('leaves database and storage requests without a deadline', async () => {
    const base = vi.fn().mockResolvedValue(new Response('ok'))
    const f = authTimeoutFetch(20, base as typeof fetch)
    await f('https://x.supabase.co/storage/v1/object/backups/a', { method: 'POST' })
    expect(base.mock.calls[0][1]).toEqual({ method: 'POST' })
  })
  it('keeps the caller\'s own abort signal working', async () => {
    const f = authTimeoutFetch(10_000, never as typeof fetch)
    const ctl = new AbortController()
    const p = f(new URL('https://x.supabase.co/auth/v1/logout'), { signal: ctl.signal })
    ctl.abort(new Error('caller'))
    await expect(p).rejects.toThrow('caller')
  })
})

// Review of #2 by CyberSecurity (R1-R3) and Audit, 19/11/2026.
describe('signOutThisDevice — review follow-ups', () => {
  const future = () => Math.floor(Date.now() / 1000) + 600
  it('stops auto-refresh before signing out (R2)', async () => {
    const order: string[] = []
    const auth = {
      stopAutoRefresh: vi.fn(async () => { order.push('stop') }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signOut: vi.fn(async () => { order.push('signOut'); return { error: null } }),
    }
    await signOutThisDevice({ auth } as never, vi.fn())
    expect(order).toEqual(['stop', 'signOut'])
  })
  it('returns the access token to revoke later when the server was not reached (R3)', async () => {
    const session = { access_token: 'at', expires_at: future() }
    const auth = {
      getSession: vi.fn().mockResolvedValueOnce({ data: { session } }).mockResolvedValue({ data: { session: null } }),
      signOut: vi.fn().mockResolvedValue({ error: { message: 'down' } }),
    }
    const res = await signOutThisDevice({ auth } as never, vi.fn())
    expect(res.pendingRevoke).toEqual({ accessToken: 'at', expiresAt: session.expires_at })
  })
  it('nothing to revoke once the access token has expired', async () => {
    const auth = {
      getSession: vi.fn().mockResolvedValueOnce({ data: { session: { access_token: 'at', expires_at: 1 } } }).mockResolvedValue({ data: { session: null } }),
      signOut: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    }
    expect((await signOutThisDevice({ auth } as never, vi.fn())).pendingRevoke).toBeNull()
  })
  it('forgets again when a refresh wrote the session back (R2)', async () => {
    const forget = vi.fn()
    const auth = {
      getSession: vi.fn()
        .mockResolvedValueOnce({ data: { session: null } })
        .mockResolvedValueOnce({ data: { session: { access_token: 'new' } } }),
      signOut: vi.fn().mockResolvedValue({ error: { message: 'down' } }),
    }
    await signOutThisDevice({ auth } as never, forget)
    expect(forget).toHaveBeenCalledTimes(2)
  })
})

describe('retryRevoke / scheduleRevokeRetry', () => {
  const pending = () => ({ accessToken: 'at', expiresAt: Math.floor(Date.now() / 1000) + 600 })
  it('posts the logout with the old token', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await expect(retryRevoke('https://x.supabase.co', 'anon', pending(), f as never)).resolves.toBe(true)
    expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/auth/v1/logout?scope=local')
    expect(f.mock.calls[0][1].headers).toEqual({ apikey: 'anon', Authorization: 'Bearer at' })
  })
  it('a session already gone counts as done, a network error does not', async () => {
    await expect(retryRevoke('https://x', 'k', pending(), vi.fn().mockResolvedValue(new Response(null, { status: 401 })) as never)).resolves.toBe(true)
    await expect(retryRevoke('https://x', 'k', pending(), vi.fn().mockResolvedValue(new Response(null, { status: 503 })) as never)).resolves.toBe(false)
    await expect(retryRevoke('https://x', 'k', pending(), vi.fn().mockRejectedValue(new TypeError('offline')) as never)).resolves.toBe(false)
  })
  it('gives up without a request once the token has expired', async () => {
    const f = vi.fn()
    await expect(retryRevoke('https://x', 'k', { accessToken: 'at', expiresAt: 1 }, f as never)).resolves.toBe(true)
    expect(f).not.toHaveBeenCalled()
  })
  it('retries until the attempt succeeds, then stops', async () => {
    vi.useFakeTimers()
    try {
      const attempt = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      scheduleRevokeRetry(attempt, 1000)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(5000)
      expect(attempt).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('authTimeoutFetch — review follow-ups', () => {
  it('gives the e-mail code request its longer deadline', async () => {
    const seen: number[] = []
    const base = vi.fn((_i: unknown, init?: RequestInit) => new Promise<Response>((_r, reject) => {
      const t0 = Date.now()
      init?.signal?.addEventListener('abort', () => { seen.push(Date.now() - t0); reject(init.signal!.reason) })
    }))
    const f = authTimeoutFetch(20, base as never, 120)
    await expect(f('https://x.supabase.co/auth/v1/otp', {})).rejects.toBeTruthy()
    expect(seen[0]).toBeGreaterThanOrEqual(100)
  })
  it('anySignal works without AbortSignal.any (Safari < 17.4)', () => {
    const original = (AbortSignal as unknown as { any?: unknown }).any
    ;(AbortSignal as unknown as { any?: unknown }).any = undefined
    try {
      const a = new AbortController()
      const b = new AbortController()
      const both = anySignal(a.signal, b.signal)
      expect(both.aborted).toBe(false)
      b.abort(new Error('b'))
      expect(both.aborted).toBe(true)
      expect((both.reason as Error).message).toBe('b')
    } finally {
      ;(AbortSignal as unknown as { any?: unknown }).any = original
    }
  })
})

describe('authStorageKey', () => {
  it('uses the client\'s own key, else the supabase-js default', () => {
    expect(authStorageKey({ auth: { storageKey: 'nexusmind-web-auth' } } as never, 'https://abc.supabase.co')).toBe('nexusmind-web-auth')
    expect(authStorageKey({ auth: {} } as never, 'https://abcdef.supabase.co')).toBe('sb-abcdef-auth-token')
  })
})
