import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppNotification, NotificationType } from './notifications'

/**
 * Notifications data access (W5), shared by the desktop main process and
 * the web app — same pattern as collabCore.ts and accessCore.ts. Rows are
 * only ever created server-side (SECURITY DEFINER triggers / cron, see the
 * W5 migration); the client only reads its own and flips `read`.
 */

interface NotificationRow {
  id: string
  type: NotificationType
  data: Record<string, unknown>
  link: string | null
  read: boolean
  created_at: string
}

function toNotification(r: NotificationRow): AppNotification {
  return { id: r.id, type: r.type, data: r.data ?? {}, link: r.link, read: r.read, createdAt: r.created_at }
}

const SELECT = 'id, type, data, link, read, created_at'

export async function listNotifications(
  sb: SupabaseClient,
  userId: string,
  opts: { onlyUnread?: boolean; limit?: number } = {},
): Promise<AppNotification[]> {
  let q = sb.from('notifications').select(SELECT).eq('user_id', userId)
  if (opts.onlyUnread) q = q.eq('read', false)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(opts.limit ?? 50)
  if (error) throw new Error(error.message)
  return (data as NotificationRow[] ?? []).map(toNotification)
}

export async function countUnreadNotifications(sb: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await sb.from('notifications')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('read', false)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function markNotificationRead(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('notifications').update({ read: true }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function markAllNotificationsRead(sb: SupabaseClient, userId: string): Promise<void> {
  const { error } = await sb.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
  if (error) throw new Error(error.message)
}
