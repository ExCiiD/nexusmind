import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Clock, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { YOUTUBE_VERIFY_URL, youtubeErrorCode, type YoutubeQueueItem } from '@/lib/youtubeQueue'

/**
 * The state of one automatic YouTube upload (DECISIONS 21/11): in progress (with its %), waiting for the quota
 * (until when), error (with its reason and « Réessayer »), or done (the link). On the clip, the recording, and in
 * Settings.
 */
export function YoutubeQueueStatus({ item, onRetry, compact = false }: { item: YoutubeQueueItem; onRetry?: () => void; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const when = item.retryAt ? new Date(item.retryAt).toLocaleString(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null
  const base = cn('flex flex-wrap items-center gap-1.5', compact ? 'text-[11px]' : 'text-xs')
  switch (item.status) {
    case 'queued':
      return <span className={cn(base, 'text-hextech-text-dim')} data-testid="yt-queue-status"><Clock className="h-3 w-3" />{t('settings.youtube.queue.queued')}</span>
    case 'uploading':
      return <span className={cn(base, 'text-hextech-text')} data-testid="yt-queue-status"><Loader2 className="h-3 w-3 animate-spin" />{t('settings.youtube.queue.uploading', { percent: item.percent ?? 0 })}</span>
    case 'waiting_quota':
      return <span className={cn(base, 'text-hextech-gold')} data-testid="yt-queue-status"><Clock className="h-3 w-3" />{when ? t('settings.youtube.queue.waitingQuotaUntil', { when }) : t('settings.youtube.queue.waitingQuota')}</span>
    case 'error':
      return (
        <span className={cn(base, 'text-hextech-red')} data-testid="yt-queue-status">
          <AlertTriangle className="h-3 w-3" />
          {t(`recording.clip.youtubeErrors.${youtubeErrorCode(item.error)}`)}
          {youtubeErrorCode(item.error) === 'YOUTUBE_CHANNEL_UNVERIFIED' && (
            <a href={YOUTUBE_VERIFY_URL} target="_blank" rel="noreferrer" className="text-hextech-gold hover:underline" data-testid="yt-verify-link">youtube.com/verify</a>
          )}
          {onRetry && <button type="button" onClick={onRetry} className="text-hextech-gold hover:underline">{t('settings.youtube.queue.retry')}</button>}
        </span>
      )
    case 'done':
      return (
        <span className={cn(base, 'text-hextech-green')} data-testid="yt-queue-status">
          <Check className="h-3 w-3" />{t('settings.youtube.queue.done')}
          {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="text-hextech-gold hover:underline">{t('settings.youtube.queue.open')}</a>}
        </span>
      )
  }
}
