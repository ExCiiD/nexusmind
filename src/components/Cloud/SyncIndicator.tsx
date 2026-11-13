import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, CloudOff, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { ToastAction } from '@/components/ui/toast'
import { useUserStore } from '@/store/useUserStore'
import type { SyncStatus } from '@/lib/ipc'

/**
 * Sidebar sync status. Click = sync now. When data arrives from another PC,
 * offers a one-click refresh (pages load their data on mount).
 */
export function SyncIndicator() {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const loadUser = useUserStore((s) => s.loadUser)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    window.api.syncStatus().then((s) => mounted.current && setStatus(s)).catch(() => {})
    const offStatus = window.api.onSyncStatus((s) => setStatus(s))
    const offApplied = window.api.onSyncApplied(({ count }) => {
      loadUser()
      toast({
        title: t('sync.applied.title'),
        description: t('sync.applied.desc', { count }),
        action: (
          <ToastAction altText={t('sync.applied.refresh')} onClick={() => window.location.reload()}>
            {t('sync.applied.refresh')}
          </ToastAction>
        ),
      })
    })
    return () => { mounted.current = false; offStatus(); offApplied() }
  }, [loadUser, t, toast])

  if (!status || status.error === 'SIGNED_OUT' || status.error === 'DISABLED') return null

  const time = status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) : null
  let icon = <Cloud className="h-3 w-3" />
  let label = time ? t('sync.state.synced', { time }) : t('sync.state.waiting')
  let tone = 'text-hextech-text-dim'
  if (status.phase === 'syncing') {
    icon = <Loader2 className="h-3 w-3 animate-spin" />
    label = t('sync.state.syncing')
  } else if (status.phase === 'blocked') {
    icon = <AlertTriangle className="h-3 w-3" />
    label = t(`sync.errors.${status.error ?? 'generic'}`, { defaultValue: t('sync.errors.generic') })
    tone = 'text-[#E24C3A]'
  } else if (status.phase === 'error') {
    icon = <CloudOff className="h-3 w-3" />
    label = t('sync.state.offline', { count: status.pending })
    tone = 'text-hextech-gold'
  } else if (status.pending > 0) {
    icon = <RefreshCw className="h-3 w-3" />
    label = t('sync.state.pending', { count: status.pending })
  }

  return (
    <button
      type="button"
      onClick={() => window.api.syncNow().catch(() => {})}
      disabled={status.phase === 'syncing'}
      title={t('sync.clickToSync')}
      className={cn('flex w-full items-center gap-1.5 text-left text-xs hover:text-hextech-text', tone)}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}
