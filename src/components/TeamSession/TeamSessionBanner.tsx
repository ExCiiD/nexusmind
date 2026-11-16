import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarClock } from 'lucide-react'
import { useCollab } from '@/hooks/useCollab'
import type { TeamSession } from '@/lib/teamSessions'

const SLOW_POLL_MS = 30_000
/** Mirrors electron/main/sync/syncService.ts's fast-poll cadence — cheap to
 *  duplicate here since both desktop and web call the same RLS-scoped
 *  Supabase query (desktop has no equivalent cross-platform broadcast
 *  event for web to listen to). */
const FAST_POLL_MS = 7_500

/** Mounted once at app-shell level (desktop App.tsx, web WebLayout.tsx) —
 *  Phase 3 of the Planning rework. Shows a small persistent banner per live
 *  team session the signed-in user belongs to, one click into
 *  TeamSessionPage. Deliberately scoped to 'live' only (not "starting
 *  soon"): a global countdown/auto-open banner for scheduled sessions needs
 *  fetching every concerned group's upcoming calendar events, which is a
 *  heavier cross-group query better revisited alongside Phase 4/5 — for now
 *  TeamSessionPage itself shows the countdown once opened from Planning. */
export function TeamSessionBanner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { available } = useCollab()
  const [liveSessions, setLiveSessions] = useState<TeamSession[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!available) { setLiveSessions([]); return }
    let stopped = false
    const poll = async () => {
      try {
        const sessions = await window.api.teamSessionListMyLive()
        if (!stopped) setLiveSessions(sessions)
        if (!stopped) timerRef.current = setTimeout(poll, sessions.length > 0 ? FAST_POLL_MS : SLOW_POLL_MS)
      } catch {
        if (!stopped) timerRef.current = setTimeout(poll, SLOW_POLL_MS)
      }
    }
    poll()
    return () => { stopped = true; if (timerRef.current) clearTimeout(timerRef.current) }
  }, [available])

  if (liveSessions.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 items-end" style={{ pointerEvents: 'none' }}>
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
