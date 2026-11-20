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
  | 'review_pending'
  | 'scrim_low_availability'
  | 'scrim_availability_missing'
  | 'dev_plan_period_ending'
  | 'weekly_load_alert'
  | 'calendar_event_request'
  | 'event_declined'
  | 'event_confirmed'
  /** § 18.1: a manager's « Relancer » (calendarRemindResponses). */
  | 'event_response_reminder'

/** Every type the server sends — kept in step with the `notifications_type_check`
 *  constraint (supabase/migrations/20261118185457_notification_types_fix.sql). */
export const NOTIFICATION_TYPES: NotificationType[] = [
  'review_comment', 'objective_assigned', 'scrim_created', 'scrim_updated',
  'scrim_reminder_24h', 'scrim_reminder_1h', 'player_inactive',
  'task_assigned', 'objective_overdue', 'wellbeing_alert', 'mention',
  'review_pending', 'scrim_low_availability', 'scrim_availability_missing', 'dev_plan_period_ending',
  'weekly_load_alert', 'calendar_event_request', 'event_declined', 'event_confirmed', 'event_response_reminder',
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
