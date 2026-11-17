import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReviewRecorder } from './ReviewRecorder'
import type { ReviewStatus, TeamSessionReview, TeamSessionReviewPatch } from '@/lib/teamSessionReviews'

interface Props {
  sessionId: string
  gameId: string
  gameLabel: string
  onDecided: () => void
  autoStart?: boolean
}

/**
 * "Quick review now, or skip?" for a game whose stats just finished
 * loading (Phase 5, Planning rework) — one per newly-fetched game with no
 * review row yet, see `gamesNeedingReviewPrompt` in
 * teamSessionReviewsCore.ts. Skipping creates a 'deferred' row (not a
 * silent no-op) so the prompt never nags twice but the review stays
 * reopenable later from the games list.
 */
export function PostGameReviewPrompt({ sessionId, gameId, gameLabel, onDecided, autoStart }: Props) {
  const { t } = useTranslation()
  const [review, setReview] = useState<TeamSessionReview | null>(null)
  const [skipping, setSkipping] = useState(false)
  // A game skipped earlier already has a 'deferred' row: reuse it instead of
  // inserting a second one when the coach comes back to record it.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    window.api.teamSessionReviewGetForGame(gameId).then(setReview).catch(() => {}).finally(() => setLoaded(true))
  }, [gameId])

  const create = async (status: ReviewStatus): Promise<TeamSessionReview> => {
    await window.api.teamSessionReviewCreate(sessionId, gameId, 'per_game', status)
    const created = await window.api.teamSessionReviewGetForGame(gameId)
    if (!created) throw new Error('Review not found right after creation')
    setReview(created)
    return created
  }

  const update = async (id: string, patch: TeamSessionReviewPatch) => {
    await window.api.teamSessionReviewUpdate(id, patch)
    const refreshed = await window.api.teamSessionReviewGetForGame(gameId)
    setReview(refreshed)
    if (patch.status === 'done') onDecided()
  }

  const skip = async () => {
    setSkipping(true)
    try {
      await window.api.teamSessionReviewCreate(sessionId, gameId, 'per_game', 'deferred')
      onDecided()
    } finally {
      setSkipping(false)
    }
  }

  return (
    <ReviewRecorder
      title={t('teamSession.review.quickReviewFor', { defaultValue: 'Quick review — {{game}}', game: gameLabel })}
      review={review}
      onCreate={create}
      onUpdate={update}
      onSkip={skipping ? undefined : skip}
      autoStart={autoStart && loaded}
    />
  )
}
