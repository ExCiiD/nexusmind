/** Renderer-side mirror of the `notifications` table (W5). */

export type NotificationType =
  | 'review_comment'
  | 'objective_assigned'
  | 'scrim_created'
  | 'scrim_updated'
  | 'scrim_reminder_24h'
  | 'scrim_reminder_1h'
  | 'player_inactive'

export interface AppNotification {
  id: string
  type: NotificationType
  /** Shape depends on `type`; see the server triggers in the W5 migration. */
  data: Record<string, unknown>
  link: string | null
  read: boolean
  createdAt: string
}

export interface NotificationsApi {
  notificationsList: (onlyUnread?: boolean) => Promise<AppNotification[]>
  notificationsUnreadCount: () => Promise<number>
  notificationsMarkRead: (id: string) => Promise<{ ok: boolean }>
  notificationsMarkAllRead: () => Promise<{ ok: boolean }>
}
