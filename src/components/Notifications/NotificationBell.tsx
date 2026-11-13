import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell, CheckCheck, ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AppNotification } from '@/lib/notifications'

const POLL_MS = 30_000

/** Routes that exist on the desktop app; anything else (e.g. `/scrims`, web-only) opens the web app instead. */
const DESKTOP_ROUTES = ['/review', '/session', '/coaching']

/** `data` stores raw values (ISO dates, ids); format the ones shown in text before interpolating. */
function renderParams(data: Record<string, unknown>, locale: string): Record<string, unknown> {
  const out = { ...data }
  if (typeof out.scheduledAt === 'string') {
    const d = new Date(out.scheduledAt)
    if (!Number.isNaN(d.getTime())) out.scheduledAt = d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  }
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

  useEffect(() => {
    if (!signedIn) return
    refreshCount()
    const poll = setInterval(refreshCount, POLL_MS)
    const onFocus = () => refreshCount()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(poll); window.removeEventListener('focus', onFocus) }
  }, [signedIn, refreshCount])

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
    if (!n.link) return
    if (canNavigateHere(n.link)) navigate(n.link)
    else await window.api.cloudOpenWeb?.()
  }

  if (!signedIn) return null

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        title={t('notifications.title')}
        className="app-no-drag relative rounded-md p-1.5 text-hextech-text-dim transition-colors hover:bg-hextech-elevated hover:text-hextech-gold"
      >
        <Bell className="h-3.5 w-3.5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[#FF4655] px-0.5 text-[9px] font-bold leading-none text-white">
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
                const external = n.link ? !canNavigateHere(n.link) : false
                const params = renderParams(n.data, i18n.language)
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
