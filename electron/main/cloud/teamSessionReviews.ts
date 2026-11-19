import { getSupabase, requireSessionUserId, getSessionUserId } from './supabase'
import * as core from '../../../src/lib/teamSessionReviewsCore'
import type { ReviewScope, ReviewStatus, TeamSessionReviewPatch } from '../../../src/lib/teamSessionReviews'

/**
 * Desktop entry points for team session reviews (Phase 5, Planning
 * rework). Same pattern as cloud/teamSessions.ts — the data access lives
 * in teamSessionReviewsCore.ts, shared with the web app.
 */

export const teamSessionReviewsListForSession = (sessionId: string) => core.listReviewsForSession(getSupabase(), sessionId)
export const teamSessionReviewGetForGame = (gameId: string) => core.getReviewForGame(getSupabase(), gameId)
export const teamSessionReviewGetForScope = (sessionId: string, scope: 'session' | 'meeting') => core.getReviewForScope(getSupabase(), sessionId, scope)
export const teamSessionReviewCreate = (sessionId: string, gameId: string | null, scope: ReviewScope, status: ReviewStatus) =>
  requireSessionUserId().then((uid) => core.createReview(getSupabase(), uid, sessionId, gameId, scope, status))
export const teamSessionReviewUpdate = (id: string, patch: TeamSessionReviewPatch) => core.updateReview(getSupabase(), id, patch)
export const teamSessionPendingFinalReviews = async () => core.listPendingFinalReviews(getSupabase(), await getSessionUserId())
export const teamSessionFeedbackList = (sessionId: string) => core.listFeedbackForSession(getSupabase(), sessionId)
export const teamSessionFeedbackSubmit = (sessionId: string, body: string, transcript: string | null = null) =>
  requireSessionUserId().then((uid) => core.submitFeedback(getSupabase(), uid, sessionId, body, transcript))
