import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2, LogIn, Square, XCircle, X, Info } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { riotErrorText } from '@/lib/riotErrors'
import { isWebApp } from '@/lib/isWebApp'
import {
  estimateRemainingMs, failedGames, scoutErrorKind, scoutOutcome, totalGames, totalProcessed, totalsKnown, type ScoutLive, type ScoutOutcome,
} from '@/store/scoutLive'

/** « 8 min », « 1 h 20 » — rounded, the estimate is a guess anyway. */
export function formatEta(ms: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return t('team.scouting.live.etaMinutes', { count: min })
  const h = Math.floor(min / 60)
  const m = min % 60
  return t('team.scouting.live.etaHours', { h, m: String(m).padStart(2, '0') })
}

const OUTCOME_STYLE: Record<ScoutOutcome, { Icon: typeof Info; tone: string }> = {
  running: { Icon: Loader2, tone: 'text-hextech-gold' },
  done: { Icon: CheckCircle2, tone: 'text-emerald-400' },
  cancelled: { Icon: Square, tone: 'text-amber-300' },
  rateLimited: { Icon: AlertTriangle, tone: 'text-amber-300' },
  sessionExpired: { Icon: LogIn, tone: 'text-amber-300' },
  error: { Icon: XCircle, tone: 'text-hextech-red' },
  noGames: { Icon: Info, tone: 'text-hextech-text-dim' },
}

export { isWebApp }

/**
 * Team-wide state of the progressive scout: initial loading, partial (games received / total, remaining time),
 * finished, cancelled, error or Riot limit, no games. Reads the store's `scoutLive` (see store/scoutLive.ts), so it
 * comes back as it was when the user returns to the tab. The per-player bars and pools are drawn by the role cards.
 */
export function ScoutProgressBanner({ live, onCancel, onDismiss, onRetry }: {
  live: ScoutLive
  onCancel: () => void
  onDismiss: () => void
  /** Resumes a stopped scout (cancelled, limit, error): the games already read are cached, so it picks up where it stopped. */
  onRetry?: () => void
}) {
  const { t, i18n } = useTranslation()
  const nf = (n: number) => n.toLocaleString(i18n.language)
  const navigate = useNavigate()
  const web = isWebApp()
  const running = live.phase === 'running'
  // A 1 s clock only while running (elapsed time and remaining estimate).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])

  const outcome = scoutOutcome(live)
  const { Icon, tone } = OUTCOME_STYLE[outcome]
  const processed = totalProcessed(live)
  const total = totalGames(live)
  const known = totalsKnown(live)
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  const eta = estimateRemainingMs(live, now)
  const members = live.order.map((id) => live.members[id])
  const withMastery = members.filter((m) => m.poolSource !== 'none').length
  const doneCount = members.filter((m) => m.status === 'done').length
  const stats = live.stats
  const lost = failedGames(live)
  const errorMembers = members.filter((m) => m.status === 'error')

  let title: string
  let detail: string | null = null
  if (outcome === 'running') {
    const starting = total === 0 && !known
    title = live.cancelRequested ? t('team.scouting.live.cancelling') : starting ? t('team.scouting.live.starting') : t('team.scouting.live.running')
    detail = starting
      ? (withMastery > 0 ? t('team.scouting.live.masteryShown', { count: withMastery, total: members.length }) : null)
      : t('team.scouting.live.games', { done: nf(processed), total: nf(total), pct })
  } else if (outcome === 'done') {
    title = t('team.scouting.live.done')
    const games = nf(stats ? stats.fromCache + stats.downloaded : processed)
    const absent = Math.max(0, lost.failed - lost.unreadable)
    detail = [
      t('team.scouting.live.doneDetail', { count: doneCount, total: members.length, games }),
      lost.unreadable > 0 ? t('team.scouting.live.unreadable', { count: lost.unreadable }) : null,
      absent > 0 ? t('team.scouting.live.absent', { count: absent }) : null,
    ].filter(Boolean).join(' · ') + '.'
  } else if (outcome === 'cancelled') {
    title = t('team.scouting.live.cancelled')
    detail = t(web ? 'team.scouting.live.cancelledDetailWeb' : 'team.scouting.live.cancelledDetail', { done: doneCount, total: members.length })
  } else if (outcome === 'rateLimited') {
    title = t('team.scouting.live.rateLimited')
    const err = members.find((m) => m.errorCode === 'RIOT_RATE_LIMITED')
    detail = `${riotErrorText(new Error(err?.errorMessage ?? live.failure ?? 'RIOT_RATE_LIMITED'), t)} ${t(web ? 'team.scouting.live.resumeHintWeb' : 'team.scouting.live.resumeHint')}`
  } else if (outcome === 'sessionExpired') {
    title = t('team.scouting.live.sessionExpired')
    detail = t('team.scouting.live.sessionExpiredDetail')
  } else if (outcome === 'error') {
    title = errorMembers.length > 0 && errorMembers.length < members.length
      ? t('team.scouting.live.errorSome', { count: errorMembers.length })
      : t('team.scouting.live.error')
    // Never the raw message: one translated text per class of error (generic for an unknown one).
    const e = scoutErrorKind(live.failure ?? errorMembers.find((m) => m.errorMessage)?.errorMessage)
    detail = t(`team.scouting.live.err.${e.kind === 'rateLimited' && web ? 'rateLimitedWeb' : e.kind}`, { bad: e.bad ?? 0, of: e.of ?? 0 })
  } else {
    title = t('team.scouting.live.noGames')
    detail = t('team.scouting.live.noGamesDetail')
  }

  return (
    <Card className="p-3 space-y-2" role="status" aria-live="polite" data-scout-outcome={outcome}>
      <div className="flex items-start gap-2">
        <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', tone, running && 'animate-spin')} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-hextech-text-bright">{title}</p>
          {detail && <p className="text-xs text-hextech-text-dim break-words">{detail}</p>}
          {running && eta != null && !live.cancelRequested && (
            <p className="text-xs text-hextech-text-dim">{t('team.scouting.live.eta', { time: formatEta(eta, t) })}</p>
          )}
          {live.plan && live.plan.sharedIds > 0 && (
            <p className="text-[10px] text-hextech-text-dim">{t('team.scouting.live.shared', { count: live.plan.sharedIds, unique: nf(live.plan.uniqueIds) })}</p>
          )}
          {running && (
            <p className="text-[10px] text-hextech-text-dim/80 italic">{t('team.scouting.live.provisional')}</p>
          )}
        </div>
        {running ? (
          <Button size="sm" variant="outline" onClick={onCancel} disabled={live.cancelRequested}>
            <Square className="h-3 w-3 mr-1" aria-hidden />{t('team.scouting.live.cancel')}
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            {outcome === 'sessionExpired' && (
              <Button size="sm" variant="outline" onClick={() => navigate(web ? '/account' : '/settings')}>{t('team.scouting.live.signIn')}</Button>
            )}
            {onRetry && (outcome === 'cancelled' || outcome === 'rateLimited' || outcome === 'error') && (
              <Button size="sm" variant="outline" onClick={onRetry}>{t(web ? 'team.scouting.live.resumeWeb' : 'team.scouting.live.resume')}</Button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              aria-label={t('team.scouting.live.dismiss')}
              className="text-hextech-text-dim hover:text-hextech-text-bright rounded p-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}
      </div>
      {running && (
        <div
          className="h-1.5 bg-black/40 rounded overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={known ? pct : undefined}
          aria-label={t('team.scouting.live.barAria')}
        >
          <div
            className={cn('h-full bg-hextech-gold transition-all duration-300', !known && total === 0 && 'w-1/4 animate-pulse')}
            style={known || total > 0 ? { width: `${pct}%` } : undefined}
          />
        </div>
      )}
    </Card>
  )
}
