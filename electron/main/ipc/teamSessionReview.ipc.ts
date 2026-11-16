import { z } from 'zod'
import { validatedHandle } from './validate'
import * as reviews from '../cloud/teamSessionReviews'

const uuid = z.string().uuid()
const scope = z.enum(['per_game', 'session', 'meeting'])
const scopedLookup = z.enum(['session', 'meeting'])
const status = z.enum(['pending', 'recording', 'processing', 'done', 'deferred'])
const visibility = z.enum(['public', 'unlisted', 'private'])

const reviewPatch = z.object({
  recordingLocalPath: z.string().max(1024).nullable().optional(),
  youtubeUrl: z.string().max(500).nullable().optional(),
  youtubeVisibility: visibility.optional(),
  transcript: z.string().max(100_000).nullable().optional(),
  summary: z.string().max(10_000).nullable().optional(),
  status: status.optional(),
})

/** Phase 5 (Planning rework §9): per-game/session/meeting reviews — create,
 *  update (recording path, transcript, YouTube URL, status), and
 *  per-player end-of-session feedback. */
export function registerTeamSessionReviewHandlers() {
  validatedHandle('team-session-review:list-for-session', z.tuple([uuid]), (_e, sessionId) => reviews.teamSessionReviewsListForSession(sessionId))
  validatedHandle('team-session-review:get-for-game', z.tuple([uuid]), (_e, gameId) => reviews.teamSessionReviewGetForGame(gameId))
  validatedHandle('team-session-review:get-for-scope', z.tuple([uuid, scopedLookup]), (_e, sessionId, s) => reviews.teamSessionReviewGetForScope(sessionId, s))
  validatedHandle('team-session-review:create', z.tuple([uuid, uuid.nullable(), scope, status]),
    (_e, sessionId, gameId, s, st) => reviews.teamSessionReviewCreate(sessionId, gameId, s, st))
  validatedHandle('team-session-review:update', z.tuple([uuid, reviewPatch]), (_e, id, patch) => reviews.teamSessionReviewUpdate(id, patch))
  validatedHandle('team-session-review:feedback-list', z.tuple([uuid]), (_e, sessionId) => reviews.teamSessionFeedbackList(sessionId))
  validatedHandle('team-session-review:feedback-submit', z.tuple([uuid, z.string().trim().min(1).max(5000), z.string().max(100_000).nullable().optional()]),
    (_e, sessionId, body, transcript) => reviews.teamSessionFeedbackSubmit(sessionId, body, transcript ?? null))
}
