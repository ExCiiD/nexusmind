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

const email = z.string().trim().toLowerCase().email().max(254)
/** Supabase e-mail OTPs are 6 digits by default (configurable up to 10). */
const otp = z.string().trim().regex(/^\d{6,10}$/, 'invalid code')

/** Maps Supabase auth errors to stable codes the renderer can translate. */
function authError(message: string | undefined): Error {
  const m = (message ?? '').toLowerCase()
  if (m.includes('rate limit') || m.includes('security purposes')) return new Error('AUTH_RATE_LIMITED')
  if (m.includes('expired') || m.includes('invalid')) return new Error('AUTH_INVALID_CODE')
  return new Error(message || 'AUTH_FAILED')
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

  validatedHandle('cloud:send-code', z.tuple([email]), async (_e, address) => {
    const { error } = await getSupabase().auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } })
    if (error) throw authError(error.message)
    return { sent: true }
  })

  validatedHandle('cloud:verify-code', z.tuple([email, otp]), async (_e, address, code) => {
    const { data, error } = await getSupabase().auth.verifyOtp({ email: address, token: code, type: 'email' })
    if (error) throw authError(error.message)
    return toCloudUser(data.session)
  })

  validatedHandle('cloud:sign-out', z.tuple([]), async () => {
    await getSupabase().auth.signOut()
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

