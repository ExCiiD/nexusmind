import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Invite-only access (shared by the desktop main process and the web app).
 * Public sign-ups are disabled: a new e-mail must first redeem an access
 * invite (or a coach / team invite) through the `redeem-invite` Edge Function.
 */

export interface AccessInvite {
  code: string
  email: string | null
  note: string | null
  createdAt: string
  expiresAt: string
  maxUses: number
  uses: number
  revoked: boolean
}

/** Public web app (the desktop can override it with MAIN_VITE_WEB_URL). */
export const DEFAULT_WEB_URL = 'https://nexusmind-web.nexusmind-riot-proxy.workers.dev'

/** Same bounds as the redeem-invite function (#44): codes are 10 or 12 characters, a shorter one is never sent. */
export const INVITE_CODE = /^[A-Z0-9]{10,16}$/

/** Normalises what the user typed (spaces, dashes, lower case). */
export function normaliseInviteCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase()
}

/** Maps Supabase auth errors to stable codes the login screen translates. */
export function authErrorCode(message: string | undefined): string {
  const m = (message ?? '').toLowerCase()
  if (m.includes('signups not allowed') || m.includes('signup is disabled') || m.includes('user not found')) return 'AUTH_NEEDS_INVITE'
  if (m.includes('rate limit') || m.includes('security purposes')) return 'AUTH_RATE_LIMITED'
  if (m.includes('invalid login credentials')) return 'AUTH_BAD_PASSWORD'
  if (m.includes('password') && (m.includes('weak') || m.includes('at least') || m.includes('characters'))) return 'AUTH_WEAK_PASSWORD'
  if (m.includes('expired') || m.includes('invalid')) return 'AUTH_INVALID_CODE'
  return message || 'AUTH_FAILED'
}

/**
 * Optional password. The first sign-in always goes through the e-mail code
 * (which proves the address); afterwards the user may set a password so a
 * new browser / PC, or a sign-out, never needs another e-mail.
 */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72 // bcrypt limit

export function isAcceptablePassword(p: string): boolean {
  return p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX && /[A-Za-z]/.test(p) && /\d/.test(p)
}

/**
 * Longest wait for one call to Supabase Auth. Without it, an auth server
 * that never answers (the project was throttled on 17-18/11/2026) left
 * `getSession()` pending forever: the app stayed on its loading spinner and
 * the sign-in buttons never came back. auth-js retries a timed-out refresh
 * on its own for about 30 s, then gives up with a readable error.
 */
export const AUTH_FETCH_TIMEOUT_MS = 10_000

/**
 * Sending the e-mail code waits on Supabase's SMTP server, which can be slow.
 * Abandoning it at 10 s did not stop the e-mail, but the retry then hit the
 * one-code-per-60-s limit (Audit review of #2, 19/11/2026).
 */
export const AUTH_OTP_TIMEOUT_MS = 30_000

/** A signal that aborts after `ms`, also where AbortSignal.timeout is missing. */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const ctl = new AbortController()
  setTimeout(() => ctl.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms)
  return ctl.signal
}

/**
 * Aborts when either signal does. AbortSignal.any is missing on Safari
 * before 17.4: there, a small controller relays both.
 */
export function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof any === 'function') return any.call(AbortSignal, [a, b])
  const ctl = new AbortController()
  for (const s of [a, b]) {
    if (s.aborted) { ctl.abort(s.reason); return ctl.signal }
    s.addEventListener('abort', () => ctl.abort(s.reason), { once: true })
  }
  return ctl.signal
}

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url

/**
 * `fetch` for createClient's `global.fetch`: requests to `/auth/v1/` are
 * aborted after `timeoutMs` (`/auth/v1/otp`, the e-mail code, after
 * `otpTimeoutMs`); everything else (database, storage uploads, Edge
 * Functions) is passed through untouched, since a backup upload may
 * legitimately take minutes.
 */
export function authTimeoutFetch(
  timeoutMs: number = AUTH_FETCH_TIMEOUT_MS,
  baseFetch: typeof fetch = (...args) => fetch(...args),
  otpTimeoutMs: number = AUTH_OTP_TIMEOUT_MS,
): typeof fetch {
  return (input, init) => {
    const url = urlOf(input)
    if (!url.includes('/auth/v1/')) return baseFetch(input, init)
    const timeout = timeoutSignal(url.includes('/auth/v1/otp') ? otpTimeoutMs : timeoutMs)
    const signal = init?.signal ? anySignal(init.signal, timeout) : timeout
    return baseFetch(input, { ...init, signal })
  }
}

/**
 * True for "the auth server could not be reached" (network down, timeout,
 * no answer), as opposed to "nobody is signed in". auth-js does not throw:
 * a refresh that fails that way comes back as `{ session: null, error }`.
 */
export function isAuthUnreachable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: string; status?: number; __isAuthError?: boolean }
  if (e.name === 'AuthRetryableFetchError') return true
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return true
  // auth-js 2.x tags fetch failures as status 0.
  return e.__isAuthError === true && e.status === 0
}

/**
 * The session for a status check. Throws AUTH_UNREACHABLE when the server
 * could not be reached, so the screens show "server unreachable, retry"
 * instead of the sign-in form (Audit review of #2, P1).
 */
export async function sessionForStatus(sb: SupabaseClient) {
  const { data, error } = await sb.auth.getSession()
  if (!data.session && isAuthUnreachable(error)) throw new Error('AUTH_UNREACHABLE')
  return data.session
}

/** A sign-out the server never heard about: the access token to revoke later. */
export interface PendingRevoke {
  accessToken: string
  /** Unix seconds: once the access token has expired it can no longer revoke anything. */
  expiresAt: number
}

/**
 * Signs this device out (other devices and the web stay signed in). auth-js
 * keeps the session, and sends no SIGNED_OUT event, when the logout request
 * fails for a reason other than 401/403/404 (network down, server error,
 * rate limit): the sign-out button then did nothing. In that case the
 * session is forgotten locally anyway with `forgetLocally`, which must
 * remove the stored session and tell the UI.
 *
 * The server-side session then stays open: its access token expires within
 * the hour, but its refresh token does not expire on the server. Whoever
 * holds a copy could keep using it. So the access token is returned as
 * `pendingRevoke`, for `retryRevoke` to send the logout again when the
 * network is back (CyberSecurity review of #2, R3).
 *
 * Auto-refresh is stopped first (R2): a refresh started between the failed
 * logout and `forgetLocally` could write a fresh session right back. The
 * caller restarts it at the next sign-in.
 */
export async function signOutThisDevice(
  sb: SupabaseClient,
  forgetLocally: () => void | Promise<void>,
): Promise<{ signedOut: true; serverReached: boolean; pendingRevoke: PendingRevoke | null }> {
  try { await sb.auth.stopAutoRefresh?.() } catch { /* not running */ }
  let token: PendingRevoke | null = null
  try {
    const s = (await sb.auth.getSession()).data.session
    if (s?.access_token && s.expires_at) token = { accessToken: s.access_token, expiresAt: s.expires_at }
  } catch { /* nothing to revoke later */ }

  let failed = false
  try {
    const { error } = await sb.auth.signOut({ scope: 'local' })
    failed = !!error
  } catch {
    failed = true
  }
  if (!failed) return { signedOut: true, serverReached: true, pendingRevoke: null }

  await forgetLocally()
  // A refresh that was already in flight may still have written a session.
  try {
    if ((await sb.auth.getSession()).data.session) await forgetLocally()
  } catch { /* storage unreadable: nothing left to read either */ }
  const live = token && token.expiresAt * 1000 > Date.now() ? token : null
  return { signedOut: true, serverReached: false, pendingRevoke: live }
}

/**
 * Sends the logout the server missed, with the forgotten session's own
 * access token. `true` = done or no longer needed (token expired, or the
 * server answers 401/403/404: that session is already gone).
 */
export async function retryRevoke(
  supabaseUrl: string,
  anonKey: string,
  pending: PendingRevoke,
  baseFetch: typeof fetch = (...args) => fetch(...args),
): Promise<boolean> {
  if (pending.expiresAt * 1000 <= Date.now()) return true
  try {
    const res = await baseFetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${pending.accessToken}` },
      signal: timeoutSignal(AUTH_FETCH_TIMEOUT_MS),
    })
    return res.ok || res.status === 401 || res.status === 403 || res.status === 404
  } catch {
    return false
  }
}

/**
 * Retries `retryRevoke` every `everyMs` until it succeeds or the token
 * expires. Returns a function that stops it (call it at the next sign-in,
 * or `trigger` it early, e.g. on the browser's `online` event).
 */
export function scheduleRevokeRetry(
  attempt: () => Promise<boolean>,
  everyMs = 60_000,
): { stop: () => void; trigger: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let running = false
  const run = async () => {
    if (stopped || running) return
    if (timer) { clearTimeout(timer); timer = null }
    running = true
    try {
      if (await attempt()) { stopped = true; return }
    } finally {
      running = false
    }
    if (!stopped) timer = setTimeout(run, everyMs)
  }
  timer = setTimeout(run, everyMs)
  return {
    stop: () => { stopped = true; if (timer) clearTimeout(timer) },
    trigger: () => { void run() },
  }
}

/** auth-js's storage key for this client (`sb-<project>-auth-token` unless overridden). */
export function authStorageKey(sb: SupabaseClient, supabaseUrl: string): string {
  const own = (sb.auth as unknown as { storageKey?: unknown }).storageKey
  if (typeof own === 'string' && own) return own
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
}

export async function signInWithPassword(sb: SupabaseClient, email: string, password: string) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new Error(authErrorCode(error.message))
  return data.session
}

/** Sets or changes the signed-in user's password; remembered in user metadata. */
export async function setPassword(sb: SupabaseClient, password: string): Promise<void> {
  if (!isAcceptablePassword(password)) throw new Error('AUTH_WEAK_PASSWORD')
  const { error } = await sb.auth.updateUser({ password, data: { has_password: true } })
  if (error) throw new Error(authErrorCode(error.message))
}

export function hasPassword(user: { user_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return user?.user_metadata?.has_password === true
}

/** Creates the account from an invite code. Does not sign in. */
export async function redeemInvite(sb: SupabaseClient, email: string, code: string): Promise<void> {
  const { data, error } = await sb.functions.invoke('redeem-invite', { method: 'POST', body: { email, code } })
  if (!error && (data as { ok?: boolean } | null)?.ok) return
  const status = (error as { context?: Response } | null)?.context?.status
  if (status === 429) throw new Error('AUTH_RATE_LIMITED')
  if (status === 400) throw new Error('INVITE_INVALID')
  throw new Error('AUTH_FAILED')
}

/** Sends the e-mail sign-in code; redeems `inviteCode` first when given. */
export async function sendSignInCode(sb: SupabaseClient, email: string, inviteCode?: string): Promise<void> {
  if (inviteCode) await redeemInvite(sb, email, inviteCode)
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
  if (error) throw new Error(authErrorCode(error.message))
}

export async function isAppAdmin(sb: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await sb.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle()
  return !!data
}

export async function listAccessInvites(sb: SupabaseClient): Promise<AccessInvite[]> {
  const { data, error } = await sb.from('access_invites')
    .select('code, email, note, created_at, expires_at, max_uses, uses, revoked')
    .order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.code === '42501' ? 'FORBIDDEN' : error.message)
  return (data ?? []).map((r) => ({
    code: r.code, email: r.email, note: r.note, createdAt: r.created_at, expiresAt: r.expires_at,
    maxUses: r.max_uses, uses: r.uses, revoked: r.revoked,
  }))
}

export async function createAccessInvite(
  sb: SupabaseClient,
  opts: { email?: string | null; days?: number; maxUses?: number; note?: string | null },
): Promise<string> {
  const { data, error } = await sb.rpc('create_access_invite', {
    p_email: opts.email?.trim() || null,
    p_days: opts.days ?? 14,
    p_max_uses: opts.maxUses ?? 1,
    p_note: opts.note?.trim() || null,
  })
  if (error) throw new Error(/forbidden/i.test(error.message) || error.code === '42501' ? 'FORBIDDEN' : error.message)
  return data as string
}

export async function revokeAccessInvite(sb: SupabaseClient, code: string): Promise<void> {
  const { error } = await sb.from('access_invites').update({ revoked: true }).eq('code', code)
  if (error) throw new Error(error.message)
}
