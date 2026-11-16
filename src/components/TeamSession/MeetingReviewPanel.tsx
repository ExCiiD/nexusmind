import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReviewRecorder } from './ReviewRecorder'
import type { ReviewStatus, TeamSessionReview, TeamSessionReviewPatch } from '@/lib/teamSessionReviews'

interface Props {
  sessionId: string
  canManage: boolean
}

/**
 * Meeting sessions (réunion-kind calendar events, Phase 5): simpler than a
 * game/scrim session — just record+transcribe the meeting itself, no
 * per-game review, no queue filter, no objectives. Meetings reuse
 * `team_session_reviews` with `scope='meeting'` rather than a parallel
 * table, per the plan's own framing ("a meeting is still a kind of team
 * session").
 */
export function MeetingReviewPanel({ sessionId, canManage }: Props) {
  const { t } = useTranslation()
  const [review, setReview] = useState<TeamSessionReview | null | undefined>(undefined)

  const load = useCallback(async () => {
    setReview(await window.api.teamSessionReviewGetForScope(sessionId, 'meeting'))
  }, [sessionId])

  useEffect(() => { load() }, [load])

  const create = async (status: ReviewStatus): Promise<TeamSessionReview> => {
    await window.api.teamSessionReviewCreate(sessionId, null, 'meeting', status)
    const created = await window.api.teamSessionReviewGetForScope(sessionId, 'meeting')
    if (!created) throw new Error('Review not found right after creation')
    setReview(created)
    return created
  }

  const update = async (id: string, patch: TeamSessionReviewPatch) => {
    await window.api.teamSessionReviewUpdate(id, patch)
    setReview(await window.api.teamSessionReviewGetForScope(sessionId, 'meeting'))
  }

  if (review === undefined) return null

  if (!canManage) {
    if (!review || review.status !== 'done') {
      return <p className="text-sm text-hextech-text-dim">{t('teamSession.review.waitingForMeetingRecord', { defaultValue: 'Waiting for a responsible to record this meeting.' })}</p>
    }
    return (
      <div className="space-y-1 rounded-md border border-hextech-border-dim p-3">
        <p className="text-xs font-semibold text-hextech-gold">{t('teamSession.review.meetingReview', { defaultValue: 'Meeting recording' })}</p>
        {review.summary && <p className="text-sm text-hextech-text-bright">{review.summary}</p>}
        {review.transcript && <p className="whitespace-pre-wrap text-xs text-hextech-text-dim">{review.transcript}</p>}
      </div>
    )
  }

  return (
    <ReviewRecorder
      title={t('teamSession.review.meetingReview', { defaultValue: 'Meeting recording' })}
      review={review}
      onCreate={create}
      onUpdate={update}
    />
  )
}
