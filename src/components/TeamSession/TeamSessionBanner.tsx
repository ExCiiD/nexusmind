import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarClock, ClipboardCheck } from 'lucide-react'
import { useCollab } from '@/hooks/useCollab'
import type { TeamSession } from '@/lib/teamSessions'
import type { PendingFinalReview } from '@/lib/teamSessionReviewsCore'

const SLOW_POLL_MS = 30_000
/** Mirrors electron/main/sync/syncService.ts's fast-poll cadence — cheap to
 *  duplicate here since both desktop and web call the same RLS-scoped
 *  Supabase query (desktop has no equivalent cross-platform broadcast
 *  event for web to listen to). */
const FAST_POLL_MS = 15_000 // was 7.5 s: four such loops overloaded the Supabase disk I/O budget (18/11/2026)

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!available) { setLiveSessions([]); setFinalReviews([]); return }
    let stopped = false
    const poll = async () => {
      try {
        const [sessions, pending] = await Promise.all([
          window.api.teamSessionListMyLive(),
          window.api.teamSessionPendingFinalReviews ? window.api.teamSessionPendingFinalReviews().catch(() => []) : Promise.resolve([]),
        ])
        if (!stopped) { setLiveSessions(sessions); setFinalReviews(pending) }
        if (!stopped) timerRef.current = setTimeout(poll, sessions.length > 0 ? FAST_POLL_MS : SLOW_POLL_MS)
      } catch {
        if (!stopped) timerRef.current = setTimeout(poll, SLOW_POLL_MS)
      }
    }
    poll()
    return () => { stopped = true; if (timerRef.current) clearTimeout(timerRef.current) }
  }, [available, location.pathname])

  // Already on that session's page: the card would only point at itself.
  const visibleReviews = finalReviews.filter((r) => location.pathname !== `/team-session/${r.calendarEventId}`)
  if (liveSessions.length === 0 && visibleReviews.length === 0) return null

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
      {liveSessions.map((s) => (
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
