import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { useUserStore } from '@/store/useUserStore'
import { useYoutubeQueue } from '@/hooks/useYoutubeQueue'
import { YOUTUBE_AUDIOS, YOUTUBE_VISIBILITIES, parseAutoYoutube, queueSummary, type AutoYoutubeUpload } from '@/lib/youtubeQueue'
import { YoutubeQueueStatus } from './YoutubeQueueStatus'
import { YOUTUBE_TERMS_URL } from '@/components/Recording/YoutubeTermsNote'

/**
 * Réglages › YouTube, once connected (DECISIONS 21/11 « Upload YouTube automatique »; CyberSecurity audit 21/11): the
 * switch (a warning first: every game goes up without a review, with possibly your microphone and other people's
 * voices), the visibility (« Publique » asks again), the sound kept (« Sans micro » by default), the line saying it
 * applies to all your PCs, and the queue's state.
 */
export function AutoYoutubeUploadSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const user = useUserStore((s) => s.user)
  const value = parseAutoYoutube(user?.autoYoutubeUpload)
  const { items, retry } = useYoutubeQueue()
  const summary = queueSummary(items)
  const pending = items.filter((x) => x.status !== 'done').slice(0, 5)
  // A change waiting for its confirmation: turning it on, or « Publique ».
  const [asking, setAsking] = useState<{ kind: 'enable' | 'public'; next: AutoYoutubeUpload } | null>(null)

  const save = async (next: AutoYoutubeUpload) => {
    if (!user) return
    const prev = user.autoYoutubeUpload
    useUserStore.setState({ user: { ...user, autoYoutubeUpload: next } })
    try {
      await window.api.updateUser({ autoYoutubeUpload: next })
    } catch {
      useUserStore.setState({ user: { ...user, autoYoutubeUpload: prev } })
      toast({ title: t('settings.youtube.auto.saveFailed'), variant: 'destructive' })
    }
  }
  const change = (next: AutoYoutubeUpload) => {
    if (next.enabled && !value.enabled) return setAsking({ kind: 'enable', next })
    if (next.visibility === 'public' && value.visibility !== 'public' && next.enabled) return setAsking({ kind: 'public', next })
    void save(next)
  }
  const confirm = () => {
    if (!asking) return
    const { kind, next } = asking
    // Turning it on with « Publique » already chosen asks for that too.
    if (kind === 'enable' && next.visibility === 'public') return setAsking({ kind: 'public', next })
    setAsking(null)
    void save(next)
  }

  const choice = <K extends 'visibility' | 'audio'>(key: K, options: readonly AutoYoutubeUpload[K][], label: string, textKey: string) => (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={label}>
      <span className="text-xs text-hextech-text-dim">{label}</span>
      {options.map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value[key] === v} onClick={() => change({ ...value, [key]: v })}
          className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors',
            value[key] === v ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-gold/50')}>
          {t(`${textKey}.${v}`)}
        </button>
      ))}
    </div>
  )

  return (
    <div className="space-y-3 border-t border-hextech-border-dim pt-4" data-testid="auto-youtube">
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor="auto-youtube" className="text-sm font-medium text-hextech-text-bright">{t('settings.youtube.auto.title')}</label>
          <p id="auto-youtube-desc" className="mt-0.5 text-xs text-hextech-text-dim">{t('settings.youtube.auto.desc')}</p>
        </div>
        <Switch id="auto-youtube" checked={value.enabled} onCheckedChange={(v) => change({ ...value, enabled: v })} aria-describedby="auto-youtube-desc" className="mt-0.5" />
      </div>
      {choice('visibility', YOUTUBE_VISIBILITIES, t('settings.youtube.auto.visibility'), 'settings.youtube.auto.visibilities')}
      {choice('audio', YOUTUBE_AUDIOS, t('settings.youtube.auto.audio'), 'settings.youtube.auto.audios')}
      {value.audio === 'all' && <p className="text-[11px] text-hextech-gold" data-testid="auto-youtube-audio-warning">{t('settings.youtube.auto.audioWarning')}</p>}
      <p className="text-[11px] text-hextech-text-dim" data-testid="auto-youtube-all-pcs">{t('settings.youtube.auto.allPcs')}</p>
      <p className="text-[11px] text-hextech-text-dim" data-testid="auto-youtube-terms">
        {t('settings.youtube.auto.terms.before')}
        <a href={YOUTUBE_TERMS_URL} target="_blank" rel="noreferrer" className="text-hextech-gold hover:underline">{t('recording.youtubeTerms.link')}</a>
        {t('settings.youtube.auto.terms.after')}
      </p>
      {value.enabled && (
        <p className="rounded-md border border-hextech-gold/30 bg-hextech-gold/5 px-3 py-2 text-xs text-hextech-text" data-testid="auto-youtube-on">
          {t('settings.youtube.auto.onLine', { visibility: t(`settings.youtube.auto.visibilities.${value.visibility}`).toLowerCase() })}
        </p>
      )}
      {(summary.active > 0 || summary.waitingQuota > 0 || summary.errors > 0) && (
        <div className="space-y-1.5" data-testid="auto-youtube-queue">
          <p className="text-xs font-medium text-hextech-text-bright">
            {t('settings.youtube.queue.summary', { active: summary.active, waiting: summary.waitingQuota, errors: summary.errors })}
          </p>
          <ul className="space-y-1">
            {pending.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-hextech-text">{it.title ?? t(it.kind === 'clip' ? 'settings.youtube.queue.aClip' : 'settings.youtube.queue.aGame')}</span>
                <YoutubeQueueStatus item={it} compact onRetry={() => void retry(it.id)} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={asking !== null} onOpenChange={(o) => { if (!o) setAsking(null) }}>
        <DialogContent className="max-w-md" data-testid="auto-youtube-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-hextech-gold" />
              {t(asking?.kind === 'public' ? 'settings.youtube.auto.publicTitle' : 'settings.youtube.auto.warnTitle')}
            </DialogTitle>
            <DialogDescription>{t(asking?.kind === 'public' ? 'settings.youtube.auto.publicDesc' : 'settings.youtube.auto.warnDesc')}</DialogDescription>
          </DialogHeader>
          {asking?.kind === 'enable' && value.audio === 'all' && <p className="text-sm text-hextech-text">{t('settings.youtube.auto.audioWarning')}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAsking(null)}>{t('common.cancel')}</Button>
            <Button onClick={confirm}>{t(asking?.kind === 'public' ? 'settings.youtube.auto.publicConfirm' : 'settings.youtube.auto.warnConfirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
