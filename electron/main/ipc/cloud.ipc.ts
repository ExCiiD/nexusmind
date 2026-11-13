import { z } from 'zod'
import { validatedHandle } from './validate'
import { getSupabase, isCloudConfigured, toCloudUser, getAccessToken } from '../cloud/supabase'
import { riotTransportMode } from '../riotTransport'
import {
  createCloudBackup,
  listCloudBackups,
  restoreCloudBackup,
  deleteCloudBackup,
  getLastCloudBackupAt,
} from '../cloud/cloudBackup'
import { toLegacySummary } from './backup.ipc'
import { syncNow } from '../sync/syncService'
import { shell } from 'electron'
import * as access from '../../../src/lib/accessCore'

const email = z.string().trim().toLowerCase().email().max(254)
/** Supabase e-mail OTPs are 6 digits by default (configurable up to 10). */
const otp = z.string().trim().regex(/^\d{6,10}$/, 'invalid code')

/** Maps Supabase auth errors to stable codes the renderer can translate. */
function authError(message: string | undefined): Error {
  return new Error(access.authErrorCode(message))
}

const inviteCode = z.string().transform(access.normaliseInviteCode).pipe(z.string().regex(access.INVITE_CODE))

/** Public web app; the desktop can open it already signed in (web-handoff). */
const WEB_URL = (import.meta.env.MAIN_VITE_WEB_URL || access.DEFAULT_WEB_URL).replace(/\/+$/, '')

async function me(): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new Error('LOGIN_REQUIRED')
  const { data } = await getSupabase().auth.getUser(token)
  if (!data.user) throw new Error('LOGIN_REQUIRED')
  return data.user.id
}

export function registerCloudHandlers() {
  validatedHandle('cloud:status', z.tuple([]), async () => {
    if (!isCloudConfigured()) return { configured: false, user: null, riotMode: riotTransportMode(), lastBackupAt: null }
    const { data } = await getSupabase().auth.getSession()
    return {
      configured: true,
      user: toCloudUser(data.session),
      riotMode: riotTransportMode(),
      lastBackupAt: getLastCloudBackupAt(),
    }
  })

  validatedHandle('cloud:send-code', z.tuple([email, inviteCode.nullable()]), async (_e, address, invite) => {
    await access.sendSignInCode(getSupabase(), address, invite ?? undefined)
    return { sent: true }
  })

  validatedHandle('cloud:verify-code', z.tuple([email, otp]), async (_e, address, code) => {
    const { data, error } = await getSupabase().auth.verifyOtp({ email: address, token: code, type: 'email' })
    if (error) throw authError(error.message)
    // Pull this account's data from the other PCs right away.
    setTimeout(() => { syncNow().catch(() => {}) }, 500)
    return toCloudUser(data.session)
  })

  const password = z.string().min(access.PASSWORD_MIN).max(access.PASSWORD_MAX)

  validatedHandle('cloud:sign-in-password', z.tuple([email, password]), async (_e, address, pw) => {
    const session = await access.signInWithPassword(getSupabase(), address, pw)
    setTimeout(() => { syncNow().catch(() => {}) }, 500)
    return toCloudUser(session)
  })

  validatedHandle('cloud:set-password', z.tuple([password]), async (_e, pw) => {
    await me()
    await access.setPassword(getSupabase(), pw)
    const { data } = await getSupabase().auth.getSession()
    return toCloudUser(data.session)
  })

  // ── invite-only access (admins) ──
  validatedHandle('access:is-admin', z.tuple([]), async () => access.isAppAdmin(getSupabase(), await me()))
  validatedHandle('access:list-invites', z.tuple([]), async () => { await me(); return access.listAccessInvites(getSupabase()) })
  validatedHandle(
    'access:create-invite',
    z.tuple([z.object({
      email: email.nullable().optional(),
      days: z.number().int().min(1).max(90).optional(),
      maxUses: z.number().int().min(1).max(100).optional(),
      note: z.string().max(200).nullable().optional(),
    })]),
    async (_e, opts) => { await me(); return access.createAccessInvite(getSupabase(), opts) },
  )
  validatedHandle('access:revoke-invite', z.tuple([inviteCode]), async (_e, code) => {
    await me()
    await access.revokeAccessInvite(getSupabase(), code)
    return { revoked: true }
  })

  /** Opens the web app in the browser, already signed in to this account. */
  validatedHandle('cloud:open-web', z.tuple([]), async () => {
    const token = await getAccessToken()
    if (!token) {
      await shell.openExternal(WEB_URL)
      return { signedIn: false }
    }
    const { data, error } = await getSupabase().functions.invoke('web-handoff', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const hash = (data as { token_hash?: string } | null)?.token_hash
    if (error || !hash || !/^[A-Za-z0-9_-]{16,128}$/.test(hash)) {
      await shell.openExternal(WEB_URL)
      return { signedIn: false }
    }
    await shell.openExternal(`${WEB_URL}/#handoff=${encodeURIComponent(hash)}`)
    return { signedIn: true }
  })

  validatedHandle('cloud:sign-out', z.tuple([]), async () => {
    await getSupabase().auth.signOut({ scope: 'local' }) // this device only: other PCs and the web stay signed in
    return { signedOut: true }
  })

  validatedHandle('cloud:backup-now', z.tuple([]), async () => createCloudBackup())
  validatedHandle('cloud:list-backups', z.tuple([]), async () => listCloudBackups())
  validatedHandle('cloud:restore-backup', z.tuple([z.string().uuid()]), async (_e, backupId) =>
    toLegacySummary(await restoreCloudBackup(backupId)),
  )
  validatedHandle('cloud:delete-backup', z.tuple([z.string().uuid()]), async (_e, backupId) => {
    await deleteCloudBackup(backupId)
    return { deleted: true }
  })

  /** GDPR erasure: cloud files + account. Local data on this PC is kept. */
  validatedHandle('cloud:delete-account', z.tuple([z.literal('DELETE')]), async () => {
    const token = await getAccessToken()
    if (!token) throw new Error('LOGIN_REQUIRED')
    const { error } = await getSupabase().functions.invoke('delete-account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (error) throw new Error(`Account deletion failed: ${error.message}`)
    await getSupabase().auth.signOut({ scope: 'local' })
    return { deleted: true }
  })
}

