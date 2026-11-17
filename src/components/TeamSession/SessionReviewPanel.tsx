import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, Send } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey } from '@/lib/collab'
import { buildSessionPerformance } from '@/lib/teamSessionStatsCore'
import { ReviewRecorder } from './ReviewRecorder'
import type { TeamSessionGame } from '@/lib/teamSessions'
import type { ReviewStatus, TeamSessionFeedback, TeamSessionReview, TeamSessionReviewPatch } from '@/lib/teamSessionReviews'

interface Props {
  sessionId: string
  games: TeamSessionGame[]
  canManage: boolean
  myUserId: string
  nameOf: (userId: string) => string
  /** Start the final-review recording on mount (coach confirmed it in the
   *  end-of-game dialog or from the postponed-review reminder). */
  autoStart?: boolean
}

/**
 * Shown once a session has ended (Phase 5, Planning rework): a "session
 * performance" summary across every game whose stats were loaded, a
 * whole-session review recording, and optional per-player feedback.
 * Embedded directly in TeamSessionPage rather than a separate route — the
 * plan called for a standalone `SessionReviewPage.tsx` with prev/next
 * per-game navigation, but every per-game review already lives right next
 * to that game's stats card (TeamSessionGameCard, Phase 4) on this same
 * page, so a second page would just mean clicking back and forth between
 * two views of the same session. Documented as a deliberate simplification.
 */
export function SessionReviewPanel({ sessionId, games, canManage, myUserId, nameOf, autoStart }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [review, setReview] = useState<TeamSessionReview | null | undefined>(undefined)
  const [feedback, setFeedback] = useState<TeamSessionFeedback[]>([])
  const [myFeedbackDraft, setMyFeedbackDraft] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)

  const load = useCallback(async () => {
    try {
      const [rev, fb] = await Promise.all([
        window.api.teamSessionReviewGetForScope(sessionId, 'session'),
        window.api.teamSessionFeedbackList(sessionId),
      ])
      setReview(rev)
      setFeedback(fb)
      const mine = fb.find((f) => f.userId === myUserId)
      if (mine) setMyFeedbackDraft(mine.body)
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [sessionId, myUserId, t, toast])

  useEffect(() => { load() }, [load])

  const performance = buildSessionPerformance(games)

  const create = async (status: ReviewStatus): Promise<TeamSessionReview> => {
    await window.api.teamSessionReviewCreate(sessionId, null, 'session', status)
    const created = await window.api.teamSessionReviewGetForScope(sessionId, 'session')
    if (!created) throw new Error('Review not found right after creation')
    setReview(created)
    return created
  }

  const update = async (id: string, patch: TeamSessionReviewPatch) => {
    await window.api.teamSessionReviewUpdate(id, patch)
    setReview(await window.api.teamSessionReviewGetForScope(sessionId, 'session'))
  }

  const submitFeedback = async () => {
    if (!myFeedbackDraft.trim()) return
    setSubmittingFeedback(true)
    try {
      await window.api.teamSessionFeedbackSubmit(sessionId, myFeedbackDraft.trim())
      await load()
      toast({ title: t('teamSession.review.feedbackSent', { defaultValue: 'Feedback sent' }), variant: 'gold' })
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setSubmittingFeedback(false)
    }
  }

  return (
    <div className="space-y-3">
      {performance && (
        <Card>
          <CardHeader className="py-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-hextech-gold" />{t('teamSession.review.sessionPerformance', { defaultValue: 'Session performance' })}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-center text-sm sm:grid-cols-4">
            <PerfStat label={t('teamSession.review.record', { defaultValue: 'Record' })} value={`${performance.wins}W – ${performance.losses}L`} />
            <PerfStat label={t('teamSession.statKda', { defaultValue: 'KDA' })} value={`${performance.our.kills}/${performance.our.deaths}/${performance.our.assists}`} />
            <PerfStat label={t('teamSession.statGold', { defaultValue: 'Gold' })} value={Math.round(performance.our.gold).toLocaleString()} />
            <PerfStat label={t('teamSession.statVision', { defaultValue: 'Vision' })} value={Math.round(performance.our.vision).toString()} />
          </CardContent>
        </Card>
      )}

      {canManage && review !== undefined && (
        <ReviewRecorder
          title={t('teamSession.review.sessionReview', { defaultValue: 'Session review' })}
          review={review}
          onCreate={create}
          onUpdate={update}
          autoStart={autoStart}
        />
      )}

      <Card>
        <CardHeader className="py-2">
          <CardTitle className="text-sm">{t('teamSession.review.feedback', { defaultValue: 'Player feedback' })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Textarea
              value={myFeedbackDraft}
              onChange={(e) => setMyFeedbackDraft(e.target.value)}
              rows={2}
              maxLength={5000}
              placeholder={t('teamSession.review.feedbackPlaceholder', { defaultValue: 'Optional — how did this session go for you?' })}
            />
            <Button size="sm" onClick={submitFeedback} disabled={submittingFeedback || !myFeedbackDraft.trim()}>
              <Send className="mr-2 h-3.5 w-3.5" />{t('teamSession.review.feedbackSend', { defaultValue: 'Send feedback' })}
            </Button>
          </div>

          {canManage && feedback.length > 0 && (
            <div className="space-y-2 border-t border-hextech-border-dim pt-3">
              {feedback.map((f) => (
                <div key={f.userId} className="rounded-md bg-hextech-elevated p-2 text-sm">
                  <p className="text-xs font-semibold text-hextech-gold">{nameOf(f.userId)}</p>
                  <p className="mt-0.5 text-hextech-text">{f.body}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PerfStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-hextech-elevated py-2">
      <p className="text-[10px] uppercase tracking-wide text-hextech-text-dim">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-hextech-text-bright">{value}</p>
    </div>
  )
}
