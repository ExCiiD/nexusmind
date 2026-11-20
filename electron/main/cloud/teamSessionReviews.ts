import { getSupabase, requireSessionUserId, getSessionUserId } from './supabase'
import * as core from '../../../src/lib/teamSessionReviewsCore'
import type { ReviewScope, ReviewStatus, TeamSessionReview, TeamSessionReviewPatch } from '../../../src/lib/teamSessionReviews'
import { resolveMediaFile } from '../mediaAccess'

/** The cloud keeps the recording's file name only: this PC's full path when the file is here (resolveMediaFile). */
export async function withLocalRecording<T extends TeamSessionReview | null>(review: T): Promise<T> {
  if (!review?.recordingLocalPath) return review
  return { ...review, recordingLocalPath: await resolveMediaFile(review.recordingLocalPath) }
}

/**
 * Desktop entry points for team session reviews (Phase 5, Planning
 * rework). Same pattern as cloud/teamSessions.ts — the data access lives
 * in teamSessionReviewsCore.ts, shared with the web app.
 */

export const teamSessionReviewsListForSession = async (sessionId: string) =>
  Promise.all((await core.listReviewsForSession(getSupabase(), sessionId)).map(withLocalRecording))
export const teamSessionReviewGetForGame = async (gameId: string) => withLocalRecording(await core.getReviewForGame(getSupabase(), gameId))
export const teamSessionReviewGetForScope = async (sessionId: string, scope: 'session' | 'meeting') =>
  withLocalRecording(await core.getReviewForScope(getSupabase(), sessionId, scope))
export const teamSessionReviewCreate = (sessionId: string, gameId: string | null, scope: ReviewScope, status: ReviewStatus) =>
  requireSessionUserId().then((uid) => core.createReview(getSupabase(), uid, sessionId, gameId, scope, status))
export const teamSessionReviewUpdate = (id: string, patch: TeamSessionReviewPatch) => core.updateReview(getSupabase(), id, patch)
export const teamSessionPendingFinalReviews = async () => core.listPendingFinalReviews(getSupabase(), await getSessionUserId())
export const teamSessionFeedbackList = (sessionId: string) => core.listFeedbackForSession(getSupabase(), sessionId)
export const teamSessionFeedbackSubmit = (sessionId: string, body: string, transcript: string | null = null) =>
  requireSessionUserId().then((uid) => core.submitFeedback(getSupabase(), uid, sessionId, body, transcript))
