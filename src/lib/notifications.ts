/** Renderer-side mirror of the `notifications` table (W5). */

export type NotificationType =
  | 'review_comment'
  | 'objective_assigned'
  | 'scrim_created'
  | 'scrim_updated'
  | 'scrim_reminder_24h'
  | 'scrim_reminder_1h'
  | 'player_inactive'
  | 'task_assigned'
  | 'objective_overdue'
  | 'wellbeing_alert'
  | 'mention'

export const NOTIFICATION_TYPES: NotificationType[] = [
  'review_comment', 'objective_assigned', 'scrim_created', 'scrim_updated',
  'scrim_reminder_24h', 'scrim_reminder_1h', 'player_inactive',
  'task_assigned', 'objective_overdue', 'wellbeing_alert', 'mention',
]

export interface AppNotification {
  id: string
  type: NotificationType
  /** Shape depends on `type`; see the server triggers in the W5/E8 migrations. */
  data: Record<string, unknown>
  link: string | null
  read: boolean
  createdAt: string
}

/** "HH:MM" (24h), or null to disable the quiet-hours window. */
export interface NotificationPrefs {
  mutedTypes: NotificationType[]
  quietStart: string | null
  quietEnd: string | null
}

export interface NotificationsApi {
  notificationsList: (onlyUnread?: boolean) => Promise<AppNotification[]>
  notificationsUnreadCount: () => Promise<number>
  notificationsMarkRead: (id: string) => Promise<{ ok: boolean }>
  notificationsMarkAllRead: () => Promise<{ ok: boolean }>
  notificationPrefsGet: () => Promise<NotificationPrefs>
  notificationPrefsSet: (prefs: NotificationPrefs) => Promise<void>
}
