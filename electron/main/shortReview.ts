/**
 * « Review courte » (decision of 20/11/2026, src/lib/shortReview.ts): a game counts as reviewed, with no review record
 * (no notes, no scores), once the player answered one micro-review moment or watched 60 s of its recording.
 * - A full review is never downgraded: a game with a Review stays as it is.
 * - Idempotent: an already reviewed game is left untouched.
 * - No Review row is created, so the charts get no score from it.
 */
import { getPrisma } from './database'

export type ShortReviewSource = 'player' | 'microReview'
export type ReviewStatus = 'reviewed' | 'pending' | 'to_be_reviewed'

export async function markShortReview(gameId: string, _source: ShortReviewSource): Promise<{ reviewStatus: ReviewStatus }> {
  const prisma = getPrisma()
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { reviewStatus: true, review: { select: { id: true } } } })
  if (!game) throw new Error('NOT_FOUND')
  if (game.review || game.reviewStatus === 'reviewed') return { reviewStatus: 'reviewed' }
  await prisma.game.update({ where: { id: gameId }, data: { reviewStatus: 'reviewed' } })
  return { reviewStatus: 'reviewed' }
}
