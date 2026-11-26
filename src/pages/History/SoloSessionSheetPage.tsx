import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ErrorState } from '@/components/ui/data-state'
import { SoloPlayerSheet } from '@/components/Session/SoloPlayerSheet'
import type { SoloGameInput } from '@/lib/playerStatsSheetCore'

interface LoadedSession { id: string; status: string; games: SoloGameInput[] }

/**
 * Player sheet of a finished (or active) solo session, opened from the History page's session cards
 * (`/history/session/:sessionId/stats?game=N`). Same sheet as the one SessionPage shows for the active session
 * (SoloPlayerSheet); only the way the games are found differs.
 */
export function SoloSessionSheetPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [session, setSession] = useState<LoadedSession | null | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setSession(undefined)
    window.api.listSessions()
      .then((rows) => {
        const s = rows.find((r) => r.id === sessionId)
        if (alive) setSession(s ? { id: s.id, status: s.status, games: (s.games ?? []) as SoloGameInput[] } : null)
      })
      .catch(() => { if (alive) setSession(null) })
    return () => { alive = false }
  }, [sessionId, attempt])

  if (session === undefined) {
    return (
      <div className="space-y-3 py-4" aria-busy role="status" aria-label={t('playerSheet.loading')}>
        <div className="h-24 animate-pulse rounded-lg bg-hextech-elevated/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{Array.from({ length: 7 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-md bg-hextech-elevated/60" />)}</div>
      </div>
    )
  }
  if (!session) {
    return (
      <div className="space-y-3 py-4">
        <Link to="/history" className="text-sm text-hextech-text-dim hover:text-hextech-gold">← {t('playerSheet.historyBack')}</Link>
        <ErrorState title={t('playerSheet.errorTitle', { name: t('playerSheet.mySheet') })} cause={t('playerSheet.sessionNotFound')} onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    )
  }
  return <SoloPlayerSheet games={session.games} sessionId={session.id} live={session.status === 'active'} onBack={() => navigate('/history')} backLabel={t('playerSheet.historyBack')} />
}
