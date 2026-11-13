import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { CommentThread } from '@/components/Coaching/CommentThread'
import { useCollab } from '@/hooks/useCollab'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { cn } from '@/lib/utils'
import type { PlayerSessionView } from '@/lib/collab'

/** Your synced sessions and reviews (read-only), with your coach's comments. */
export function MyReviewsPage() {
  const { t, i18n } = useTranslation()
  const { myUserId, nameOf } = useCollab()
  const fundamentals = useLocalizedFundamentals()
  const label = (id: string) => {
    for (const c of fundamentals) { const f = c.fundamentals.find((x) => x.id === id); if (f) return f.label }
    return id
  }
  const [params] = useSearchParams()
  const focusReview = params.get('review')
  const [sessions, setSessions] = useState<PlayerSessionView[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    if (!myUserId) return
    window.api.collabPlayerSessions(myUserId).then(setSessions).catch(() => setSessions([]))
  }, [myUserId])

  // Deep link from the home page: open the session that holds the review.
  const focusedSession = useMemo(
    () => sessions?.find((s) => s.games.some((g) => g.review?.id === focusReview))?.id ?? null,
    [sessions, focusReview],
  )
  useEffect(() => { if (focusedSession) setOpen(focusedSession) }, [focusedSession])

  const fmt = (v: number | string | null) => (v ? new Date(typeof v === 'number' ? v : Date.parse(v)).toLocaleDateString(i18n.language) : '—')

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('web.reviews.title')}</h1>
        <p className="mt-1 text-sm text-hextech-text">{t('web.reviews.subtitle')}</p>
      </div>
      {sessions === null || !myUserId ? (
        <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-hextech-text-dim">{t('web.reviews.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Card>
                <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  {open === s.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="text-hextech-text-bright">{fmt(s.date)}</span>
                  <span className="truncate">{s.objectiveIds.map(label).join(', ')}</span>
                  <span className="ml-auto shrink-0 text-xs text-hextech-text-dim">{t('coaching.players.games', { count: s.games.length })}</span>
                </button>
                {open === s.id && (
                  <CardContent className="space-y-3 border-t border-hextech-border-dim pt-3">
                    {s.sessionConclusion && <p className="text-sm italic">{s.sessionConclusion}</p>}
                    {s.games.map((g) => (
                      <div key={g.id} className={cn('space-y-2 rounded-lg bg-hextech-elevated/30 p-3', g.review?.id === focusReview && 'ring-1 ring-hextech-gold/60')}>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className={cn('font-medium', g.win ? 'text-hextech-green' : 'text-[#E24C3A]')}>
                            {g.win ? t('coaching.players.win') : t('coaching.players.loss')}
                          </span>
                          <span className="text-hextech-text-bright">{g.champion}</span>
                          <span className="text-hextech-text-dim">{g.kills}/{g.deaths}/{g.assists}</span>
                        </div>
                        {g.review ? (
                          <>
                            {g.review.freeText && <p className="whitespace-pre-wrap text-sm">{g.review.freeText}</p>}
                            {g.review.timelineNotes.length > 0 && (
                              <ul className="space-y-0.5 text-xs">
                                {g.review.timelineNotes.map((n, i) => <li key={i}><span className="text-hextech-gold">{n.time}</span> {n.note}</li>)}
                              </ul>
                            )}
                            <CommentThread reviewId={g.review.id} gameId={g.id} myUserId={myUserId} authorName={nameOf} hideWhenEmpty />
                          </>
                        ) : (
                          <p className="text-xs text-hextech-text-dim">{t('coaching.players.noReview')}</p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
