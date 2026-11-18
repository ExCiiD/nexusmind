import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Flag, Loader2, Mic } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { useCollab } from '@/hooks/useCollab'
import { collabErrorKey } from '@/lib/collab'
import { gamesAwaitingDecision, planEndOfGame } from '@/lib/teamSessionReviewsCore'
import { cn } from '@/lib/utils'
import type { TeamSession, TeamSessionGame } from '@/lib/teamSessions'

const FAST_POLL_MS = 15_000 // was 7.5 s: four such loops overloaded the Supabase disk I/O budget (18/11/2026)
const SLOW_POLL_MS = 30_000

interface Pending { session: TeamSession; game: TeamSessionGame; index: number; title: string }

/**
 * End-of-game questions for a team session's responsible (17/11/2026,
 * user request). Mounted once at app-shell level (desktop only — recording
 * the review needs the desktop capture), so the coach is asked wherever
 * they are in the app, not only on the session page:
 *   1. review this game now? (yes → the session page opens and recording
 *      starts on its own, no second click)
 *   2. was it the last game of the session? (yes → the session is ended)
 *   3. if last: final review now, or another day? (another day → a
 *      'deferred' session review, surfaced by TeamSessionBanner as a
 *      persistent reminder until it's done)
 * Each game is asked once: any answer writes a review row (or ends the
 * session); "Later" only hides it until the next app start.
 */
export function EndOfGamePrompt() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const navigate = useNavigate()
  const { available, myUserId } = useCollab()
  const [pending, setPending] = useState<Pending | null>(null)
  const [reviewNow, setReviewNow] = useState<boolean | null>(null)
  const [lastGame, setLastGame] = useState<boolean | null>(null)
  const [finalNow, setFinalNow] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const dismissed = useRef(new Set<string>())
  const titles = useRef(new Map<string, string>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  pendingRef.current = pending

  const check = useCallback(async (): Promise<boolean> => {
    if (!myUserId) return false
    const live = (await window.api.teamSessionListMyLive()).filter((s) => s.responsibleUserIds.includes(myUserId))
    if (live.length === 0) return false
    if (pendingRef.current) return true
    for (const s of live) {
      const [games, reviews] = await Promise.all([window.api.teamSessionListGames(s.id), window.api.teamSessionReviewsListForSession(s.id)])
      const next = gamesAwaitingDecision(games, reviews, dismissed.current)[0]
      if (!next) continue
      if (!titles.current.has(s.calendarEventId)) {
        const ev = await window.api.calendarGetEvent(s.calendarEventId).catch(() => null)
        titles.current.set(s.calendarEventId, ev?.title ?? '')
      }
      setReviewNow(null); setLastGame(null); setFinalNow(null)
      setPending({ session: s, game: next, index: games.findIndex((g) => g.id === next.id) + 1, title: titles.current.get(s.calendarEventId) ?? '' })
      break
    }
    return true
  }, [myUserId])

  useEffect(() => {
    if (!available || !myUserId) return
    let stopped = false
    const loop = async () => {
      let hasLive = false
      try { hasLive = await check() } catch { /* offline: retry on the slow cadence */ }
      if (!stopped) timer.current = setTimeout(loop, hasLive ? FAST_POLL_MS : SLOW_POLL_MS)
    }
    loop()
    return () => { stopped = true; if (timer.current) clearTimeout(timer.current) }
  }, [available, myUserId, check])

  if (!pending) return null

  const ready = reviewNow !== null && lastGame !== null && (!lastGame || finalNow !== null)

  const later = () => {
    dismissed.current.add(pending.game.id)
    setPending(null)
  }

  const confirm = async () => {
    if (!ready) return
    const plan = planEndOfGame(pending.game.id, { reviewNow: !!reviewNow, lastGame: !!lastGame, finalReviewNow: !!finalNow })
    const { session } = pending
    setBusy(true)
    try {
      if (plan.deferGameReview) await window.api.teamSessionReviewCreate(session.id, pending.game.id, 'per_game', 'deferred')
      if (plan.endSession) await window.api.teamSessionEnd(session.id)
      if (plan.deferFinalReview) {
        const existing = await window.api.teamSessionReviewGetForScope(session.id, 'session')
        if (existing) await window.api.teamSessionReviewUpdate(existing.id, { status: 'deferred' })
        else await window.api.teamSessionReviewCreate(session.id, null, 'session', 'deferred')
        toast({ title: t('teamSession.endOfGame.finalPostponed'), variant: 'gold' })
      }
      dismissed.current.add(pending.game.id)
      setPending(null)
      if (plan.open) {
        const q = new URLSearchParams()
        if (plan.open.gameId) q.set('review', plan.open.gameId)
        if (plan.open.final) q.set('final', '1')
        q.set('start', '1')
        navigate(`/team-session/${session.calendarEventId}?${q.toString()}`)
      }
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) later() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Flag className="h-5 w-5 text-hextech-gold" />{t('teamSession.endOfGame.title', { n: pending.index })}</DialogTitle>
          <DialogDescription>{pending.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Question label={t('teamSession.endOfGame.reviewQ')} value={reviewNow} onChange={setReviewNow}
            yes={t('teamSession.endOfGame.reviewYes')} no={t('teamSession.endOfGame.reviewNo')} />
          <Question label={t('teamSession.endOfGame.lastQ')} value={lastGame} onChange={(v) => { setLastGame(v); if (!v) setFinalNow(null) }}
            yes={t('teamSession.endOfGame.lastYes')} no={t('teamSession.endOfGame.lastNo')} />
          {lastGame && (
            <Question label={t('teamSession.endOfGame.finalQ')} value={finalNow} onChange={setFinalNow}
              yes={t('teamSession.endOfGame.finalNow')} no={t('teamSession.endOfGame.finalLater')} />
          )}
          {(reviewNow || (lastGame && finalNow)) && (
            <p className="flex items-start gap-1.5 rounded-md border border-hextech-gold/30 bg-hextech-gold/[0.06] p-2 text-xs text-hextech-text">
              <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hextech-gold" />
              {reviewNow && lastGame && finalNow ? t('teamSession.endOfGame.hintBoth') : t('teamSession.endOfGame.hintRecord')}
            </p>
          )}
          {lastGame && finalNow === false && (
            <p className="text-xs text-hextech-text-dim">{t('teamSession.endOfGame.hintLater')}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={later} disabled={busy} className="text-hextech-text-dim">{t('teamSession.endOfGame.askLater')}</Button>
          <Button onClick={confirm} disabled={!ready || busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('teamSession.endOfGame.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Question({ label, value, onChange, yes, no }: { label: string; value: boolean | null; onChange: (v: boolean) => void; yes: string; no: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-hextech-text-bright">{label}</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {([[true, yes], [false, no]] as const).map(([v, text]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={cn('rounded-md border px-3 py-2 text-sm transition-colors',
              value === v ? 'border-hextech-gold bg-hextech-gold/15 font-semibold text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border')}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
