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
const notificationType = z.enum([
  'review_comment', 'objective_assigned', 'scrim_created', 'scrim_updated',
  'scrim_reminder_24h', 'scrim_reminder_1h', 'player_inactive',
  'task_assigned', 'objective_overdue', 'wellbeing_alert', 'mention',
])
const timeOnly = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const prefsInput = z.object({ mutedTypes: z.array(notificationType), quietStart: timeOnly.nullable(), quietEnd: timeOnly.nullable() })

export function registerNotificationsHandlers() {
  validatedHandle('notifications:list', z.tuple([z.boolean().optional()]),
    async (_e, onlyUnread) => core.listNotifications(getSupabase(), await me(), { onlyUnread }))
  validatedHandle('notifications:unread-count', z.tuple([]),
    async () => core.countUnreadNotifications(getSupabase(), await me()))
  validatedHandle('notifications:mark-read', z.tuple([uuid]),
    async (_e, id) => { await core.markNotificationRead(getSupabase(), id); return { ok: true } })
  validatedHandle('notifications:mark-all-read', z.tuple([]),
    async () => { await core.markAllNotificationsRead(getSupabase(), await me()); return { ok: true } })
  validatedHandle('notifications:prefs-get', z.tuple([]),
    async () => core.getNotificationPrefs(getSupabase(), await me()))
  validatedHandle('notifications:prefs-set', z.tuple([prefsInput]),
    async (_e, prefs) => { await core.setNotificationPrefs(getSupabase(), await me(), prefs) })
}
