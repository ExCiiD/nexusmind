import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell, CheckCheck, ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AppNotification } from '@/lib/notifications'
import { useVisiblePolling } from '@/hooks/useVisiblePolling'

/** Task I: every 2 min while visible, plus on focus; paused when hidden (useVisiblePolling). */
const POLL_MS = 120_000

/** Routes that exist on the desktop app; anything else (e.g. `/scrims`, web-only) opens the web app instead. */
const DESKTOP_ROUTES = ['/review', '/session', '/coaching', '/management']

/**
 * Server notifications still link to '/coaching' (set by the database
 * triggers). Since the section was split, part of them belong to Management:
 * open the page and tab that holds what they talk about.
 */
const COACHING_LINK_BY_TYPE: Partial<Record<AppNotification['type'], string>> = {
  calendar_event_request: '/management?tab=planning',
  event_declined: '/management?tab=planning',
  event_confirmed: '/management?tab=planning',
  task_assigned: '/management?tab=teamOps',
  wellbeing_alert: '/management?tab=wellbeing',
  weekly_load_alert: '/management?tab=wellbeing',
  objective_assigned: '/management?tab=overview',
  objective_overdue: '/management?tab=overview',
  player_inactive: '/coaching?tab=players',
  dev_plan_period_ending: '/coaching?tab=players',
}

function linkOf(n: AppNotification): string | null {
  if (n.link === '/coaching') return COACHING_LINK_BY_TYPE[n.type] ?? n.link
  return n.link
}

/** `data` stores raw values (ISO dates, ids); format the ones shown in text before interpolating. */
function renderParams(data: Record<string, unknown>, locale: string, roleName: (r: string) => string, none: string): Record<string, unknown> {
  const out = { ...data }
  // #39 (staff_roles_changed, member_staff_roles_changed): role lists as words ("Coach, Analyst").
  const list = (v: unknown): string => {
    const names = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(roleName) : []
    return names.length === 0 ? none : names.join(', ')
  }
  if ('roles' in out) out.rolesText = list(out.roles)
  if ('added' in out) out.addedText = list(out.added)
  if ('removed' in out) out.removedText = list(out.removed)
  if (typeof out.scheduledAt === 'string') {
    const d = new Date(out.scheduledAt)
    if (!Number.isNaN(d.getTime())) out.scheduledAt = d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  }
  // An absence may come with its reason (event_declined).
  const [open, close] = locale.startsWith('fr') ? ['« ', ' »'] : ['“', '”']
  out.noteSuffix = typeof out.note === 'string' && out.note ? ` — ${open}${out.note}${close}` : ''
  return out
}

function canNavigateHere(link: string): boolean {
  if (!window.api.cloudOpenWeb) return true // we are the web app: every link is one of our own routes
  return DESKTOP_ROUTES.some((r) => link === r || link.startsWith(`${r}?`) || link.startsWith(`${r}#`))
}

/**
 * W5 notifications. Polling (not Realtime) to match the rest of the app's
 * sync model (SyncIndicator polls too) — one new table/trigger surface is
 * enough risk for this pass; Realtime push is a clean follow-up.
 */
export function NotificationBell() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const [unread, setUnread] = useState(0)
  const [busy, setBusy] = useState(false)
  // Nothing to show when there is no signed-in cloud account (local-only use,
  // or the login screen itself) — same gate as CloudAccountCard / SyncIndicator.
  const [signedIn, setSignedIn] = useState(false)

  const refreshCount = useCallback(() => {
    window.api.notificationsUnreadCount?.().then(setUnread).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    window.api.cloudStatus().then((s) => { if (alive) setSignedIn(!!s.configured && !!s.user) }).catch(() => {})
    const off = window.api.onCloudAuthChanged((user) => { if (alive) setSignedIn(!!user) })
    return () => { alive = false; off() }
  }, [])

  useVisiblePolling(refreshCount, POLL_MS, signedIn)

  const openPanel = async () => {
    setOpen(true)
    setItems(null)
    try {
      setItems(await window.api.notificationsList())
    } catch {
      setItems([])
    }
  }

  const markAllRead = async () => {
    setBusy(true)
    try {
      await window.api.notificationsMarkAllRead?.()
      setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? null)
      setUnread(0)
    } finally {
      setBusy(false)
    }
  }

  const click = async (n: AppNotification) => {
    if (!n.read) {
      window.api.notificationsMarkRead?.(n.id).catch(() => {})
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null)
      setUnread((u) => Math.max(0, u - 1))
    }
    setOpen(false)
    const link = linkOf(n)
    if (!link) return
    if (canNavigateHere(link)) navigate(link)
    else await window.api.cloudOpenWeb?.()
  }

  if (!signedIn) return null

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        title={t('notifications.title')}
        aria-label={unread > 0 ? t('notifications.bellLabel', { count: unread }) : t('notifications.title')}
        className="app-no-drag relative rounded-md p-1.5 text-hextech-text-dim transition-colors hover:bg-hextech-elevated hover:text-hextech-gold"
      >
        <Bell className="h-3.5 w-3.5" aria-hidden />
        {unread > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[#E24C3A] px-0.5 text-[9px] font-bold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>{t('notifications.title')}</DialogTitle>
              {items && items.some((n) => !n.read) && (
                <Button variant="ghost" size="sm" className="gap-1.5" disabled={busy} onClick={markAllRead}>
                  <CheckCheck className="h-3.5 w-3.5" />{t('notifications.markAllRead')}
                </Button>
              )}
            </div>
          </DialogHeader>
          {items === null ? (
            <p className="py-6 text-center text-sm text-hextech-text-dim">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-hextech-text-dim">{t('notifications.empty')}</p>
          ) : (
            <ul className="divide-y divide-hextech-border-dim">
              {items.map((n) => {
                const external = n.link ? !canNavigateHere(linkOf(n) ?? n.link) : false
                const params = renderParams(n.data, i18n.language, (r) => t(`coaching.roles.${r}`, { defaultValue: r }), t('notifications.rolesNone'))
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => click(n)}
                      className={cn(
                        'flex w-full items-start gap-2 px-1 py-3 text-left text-sm transition-colors hover:bg-hextech-elevated',
                        !n.read && 'relative',
                      )}
                    >
                      {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-hextech-gold" />}
                      <div className={cn('min-w-0 flex-1', n.read && 'ml-3.5 opacity-70')}>
                        <div className="text-hextech-text-bright">
                          {t(`notifications.types.${n.type}.title`, params)}
                        </div>
                        <div className="truncate text-xs text-hextech-text-dim">
                          {t(`notifications.types.${n.type}.body`, params)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-hextech-text-dim/70">
                          {new Date(n.createdAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      </div>
                      {external && <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hextech-text-dim" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
