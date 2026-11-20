import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarClock, ClipboardCheck } from 'lucide-react'
import { useCollab } from '@/hooks/useCollab'
import type { TeamSession } from '@/lib/teamSessions'
import type { PendingFinalReview } from '@/lib/teamSessionReviewsCore'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'

/** Task I: live sessions come from the app's single poller (teamSessionLiveCached
 *  + the 'team-session:live' push, desktop sync / web adapter). Only the
 *  postponed final reviews are fetched here: on mount, on each push, on a
 *  route change, and on focus / back to visible — with a 10 min safety net. */
const REVIEWS_SAFETY_MS = 600_000

/** Mounted once at app-shell level (desktop App.tsx, web WebLayout.tsx).
 *  Two kinds of persistent bottom-right cards:
 *  - one per live team session the signed-in user belongs to (Phase 3),
 *    one click into TeamSessionPage;
 *  - one per final review the user postponed "to another day" from the
 *    end-of-game dialog (17/11/2026) — stays until that review is
 *    recorded, so the responsible can't forget it. Derived from the
 *    'deferred' session review row itself, not a stored notification, so
 *    it shows on every device and disappears on its own once done. */
export function TeamSessionBanner() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { available } = useCollab()
  const [liveSessions, setLiveSessions] = useState<TeamSession[]>([])
  const [finalReviews, setFinalReviews] = useState<PendingFinalReview[]>([])

  const refreshReviews = useCallback(async () => {
    if (!available || !window.api.teamSessionPendingFinalReviews) return
    try { setFinalReviews((await window.api.teamSessionPendingFinalReviews()) ?? []) } catch { /* offline: keep the last list */ }
  }, [available])

  // Live sessions: cached list at mount, then the push.
  useEffect(() => {
    if (!available) { setLiveSessions([]); setFinalReviews([]); return }
    let alive = true
    window.api.teamSessionLiveCached().then((s) => { if (alive) setLiveSessions(s ?? []) }).catch(() => {})
    const off = window.api.onTeamSessionLive((s) => { setLiveSessions(s ?? []); void refreshReviews() })
    return () => { alive = false; off() }
  }, [available, refreshReviews])

  // Postponed final reviews: mount + route change, then focus / visible (useVisiblePolling).
  useEffect(() => { void refreshReviews() }, [refreshReviews, location.pathname])
  useRealtimeRefresh(['team_session_reviews'], refreshReviews, REVIEWS_SAFETY_MS, { enabled: available })

  // Already on that session's page: the card would only point at itself.
  const here = (calendarEventId: string) => location.pathname === `/team-session/${calendarEventId}`
  const visibleReviews = finalReviews.filter((r) => !here(r.calendarEventId))
  const visibleLive = liveSessions.filter((s) => !here(s.calendarEventId))
  if (visibleLive.length === 0 && visibleReviews.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2" style={{ pointerEvents: 'none' }}>
      {visibleReviews.map((r) => (
        <div key={r.reviewId} role="status"
          className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-lg border border-hextech-gold/50 bg-hextech-dark px-4 py-3 shadow-lg">
          <ClipboardCheck className="h-5 w-5 shrink-0 text-hextech-gold" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-hextech-text-bright">{t('teamSession.finalReminder.title')}</p>
            <p className="truncate text-xs text-hextech-text">
              {r.title || t('teamSession.finalReminder.untitled')}{r.startsAt ? ` · ${new Date(r.startsAt).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}
            </p>
          </div>
          <button onClick={() => navigate(`/team-session/${r.calendarEventId}?final=1&start=1`)}
            className="shrink-0 rounded-md bg-hextech-gold px-3 py-1.5 text-xs font-bold text-hextech-black hover:brightness-110">
            {t('teamSession.finalReminder.open')}
          </button>
        </div>
      ))}
      {visibleLive.map((s) => (
        <button
          key={s.id}
          onClick={() => navigate(`/team-session/${s.calendarEventId}`)}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-hextech-green/40 bg-hextech-dark px-4 py-2.5 text-sm font-medium text-hextech-green shadow-lg transition-colors hover:bg-hextech-green/10 animate-pulse"
        >
          <CalendarClock className="h-4 w-4" />
          {t('teamSession.liveBanner', { defaultValue: 'Team session live — join' })}
        </button>
      ))}
    </div>
  )
}
