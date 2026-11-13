import { z } from 'zod'
import { validatedHandle } from './validate'
import { getSupabase, getAccessToken } from '../cloud/supabase'
import * as core from '../../../src/lib/notificationsCore'

/**
 * Desktop entry points for W5 notifications. Data access lives in
 * `src/lib/notificationsCore.ts`, shared with the web app; this file only
 * supplies the signed-in client and the user id (same shape as collab.ipc.ts).
 */

async function me(): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new Error('LOGIN_REQUIRED')
  const { data } = await getSupabase().auth.getUser(token)
  if (!data.user) throw new Error('LOGIN_REQUIRED')
  return data.user.id
}

const uuid = z.string().uuid()

export function registerNotificationsHandlers() {
  validatedHandle('notifications:list', z.tuple([z.boolean().optional()]),
    async (_e, onlyUnread) => core.listNotifications(getSupabase(), await me(), { onlyUnread }))
  validatedHandle('notifications:unread-count', z.tuple([]),
    async () => core.countUnreadNotifications(getSupabase(), await me()))
  validatedHandle('notifications:mark-read', z.tuple([uuid]),
    async (_e, id) => { await core.markNotificationRead(getSupabase(), id); return { ok: true } })
  validatedHandle('notifications:mark-all-read', z.tuple([]),
    async () => { await core.markAllNotificationsRead(getSupabase(), await me()); return { ok: true } })
}
