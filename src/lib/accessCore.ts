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

export const INVITE_CODE = /^[A-Z0-9]{6,16}$/

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
