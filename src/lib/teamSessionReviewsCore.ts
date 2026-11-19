import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ReviewScope, ReviewStatus, TeamSessionFeedback, TeamSessionReview, TeamSessionReviewPatch,
} from './teamSessionReviews'
import type { TeamSessionGame } from './teamSessions'
import { fail } from './supabaseErrors'

/**
 * Team session reviews (Phase 5, Planning rework — docs/PLAN_GESTION_EQUIPE.md
 * §9), same pattern as teamSessionsCore.ts. Purely server-side CRUD plus a
 * few pure helpers (the "review state machine" the plan calls for: which
 * games still need a prompt, which reviews are reopenable) — small enough
 * not to need their own file, same choice teamSessionsCore.ts already made
 * for countdownState/queueBucket.
 */

interface ReviewRow {
  id: string; session_id: string; game_id: string | null; scope: ReviewScope; recorded_by: string | null
  recording_local_path: string | null; youtube_url: string | null; youtube_visibility: TeamSessionReview['youtubeVisibility']
  transcript: string | null; summary: string | null; status: ReviewStatus; created_at: string; updated_at: string
}
interface FeedbackRow { session_id: string; user_id: string; body: string; transcript: string | null; created_at: string }

const REVIEW_SELECT = 'id, session_id, game_id, scope, recorded_by, recording_local_path, youtube_url, youtube_visibility, transcript, summary, status, created_at, updated_at'

const toReview = (r: ReviewRow): TeamSessionReview => ({
  id: r.id, sessionId: r.session_id, gameId: r.game_id, scope: r.scope, recordedBy: r.recorded_by,
  recordingLocalPath: r.recording_local_path, youtubeUrl: r.youtube_url, youtubeVisibility: r.youtube_visibility,
  transcript: r.transcript, summary: r.summary, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
})
const toFeedback = (r: FeedbackRow): TeamSessionFeedback => ({
  sessionId: r.session_id, userId: r.user_id, body: r.body, transcript: r.transcript, createdAt: r.created_at,
})

export async function listReviewsForSession(sb: SupabaseClient, sessionId: string): Promise<TeamSessionReview[]> {
  const { data, error } = await sb.from('team_session_reviews').select(REVIEW_SELECT).eq('session_id', sessionId).order('created_at')
  if (error) fail(error, 'list session reviews')
  return (data as ReviewRow[]).map(toReview)
}

export async function getReviewForGame(sb: SupabaseClient, gameId: string): Promise<TeamSessionReview | null> {
  const { data, error } = await sb.from('team_session_reviews').select(REVIEW_SELECT).eq('game_id', gameId).maybeSingle()
  if (error) fail(error, 'get game review')
  return data ? toReview(data as ReviewRow) : null
}

/** 'session' or 'meeting' scope — the one row with `game_id is null` for
 *  that scope (enforced by a partial unique index). */
export async function getReviewForScope(sb: SupabaseClient, sessionId: string, scope: 'session' | 'meeting'): Promise<TeamSessionReview | null> {
  const { data, error } = await sb.from('team_session_reviews').select(REVIEW_SELECT).eq('session_id', sessionId).eq('scope', scope).is('game_id', null).maybeSingle()
  if (error) fail(error, 'get scoped review')
  return data ? toReview(data as ReviewRow) : null
}

export async function createReview(sb: SupabaseClient, sessionId: string, gameId: string | null, scope: ReviewScope, status: ReviewStatus): Promise<string> {
  const { data: userData } = await sb.auth.getUser()
  const { data, error } = await sb.from('team_session_reviews').insert({
    session_id: sessionId, game_id: gameId, scope, status, recorded_by: userData.user?.id ?? null,
  }).select('id').single()
  if (error) fail(error, 'create review')
  return data.id
}

const patchToRow = (patch: TeamSessionReviewPatch) => ({
  ...(patch.recordingLocalPath !== undefined ? { recording_local_path: patch.recordingLocalPath } : {}),
  ...(patch.youtubeUrl !== undefined ? { youtube_url: patch.youtubeUrl } : {}),
  ...(patch.youtubeVisibility !== undefined ? { youtube_visibility: patch.youtubeVisibility } : {}),
  ...(patch.transcript !== undefined ? { transcript: patch.transcript } : {}),
  ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
  ...(patch.status !== undefined ? { status: patch.status } : {}),
  updated_at: new Date().toISOString(),
})

export async function updateReview(sb: SupabaseClient, id: string, patch: TeamSessionReviewPatch): Promise<void> {
  const { error } = await sb.from('team_session_reviews').update(patchToRow(patch)).eq('id', id)
  if (error) fail(error, 'update review')
}

export async function listFeedbackForSession(sb: SupabaseClient, sessionId: string): Promise<TeamSessionFeedback[]> {
  const { data, error } = await sb.from('team_session_feedback').select('session_id, user_id, body, transcript, created_at').eq('session_id', sessionId).order('created_at')
  if (error) fail(error, 'list session feedback')
  return (data as FeedbackRow[]).map(toFeedback)
}

/** Upsert: a player can resubmit/edit their own feedback (RLS allows
 *  updating only their own row — see the migration). */
export async function submitFeedback(sb: SupabaseClient, sessionId: string, body: string, transcript: string | null = null): Promise<void> {
  const { data: userData } = await sb.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('NOT_SIGNED_IN')
  const { error } = await sb.from('team_session_feedback').upsert({ session_id: sessionId, user_id: userId, body, transcript })
  if (error) fail(error, 'submit feedback')
}

// ── pure helpers (no I/O) — the review "state machine" ─────────────────

/** Games whose match is already fetched but have no review row at all yet
 *  (not even a 'deferred' placeholder) — these are the ones a
 *  PostGameReviewPrompt should offer "record now or skip" for. A game
 *  still `pending_fetch` isn't ready to review yet; one already decided
 *  (any review row exists, including 'deferred') never prompts again. */
export function gamesNeedingReviewPrompt(games: TeamSessionGame[], reviews: TeamSessionReview[]): TeamSessionGame[] {
  const reviewedGameIds = new Set(reviews.map((r) => r.gameId).filter((id): id is string => id !== null))
  return games.filter((g) => g.status === 'fetched' && !reviewedGameIds.has(g.id))
}

/** A 'deferred' review was explicitly skipped, not abandoned — it stays
 *  reopenable (record it later) rather than treated as done. */
export function isReviewReopenable(review: TeamSessionReview): boolean {
  return review.status === 'deferred'
}

export function isReviewDone(review: TeamSessionReview | null | undefined): boolean {
  return review?.status === 'done'
}

// ── End-of-game flow (17/11/2026) ──────────────────────────────────────

/** Games a session responsible hasn't decided on yet, for the global
 *  end-of-game prompt. Unlike `gamesNeedingReviewPrompt` this doesn't wait
 *  for the match to be fetched: the coach usually isn't on the session page
 *  (players' clients report the game), and the question "review it now?"
 *  only needs to know a game ended. `dismissed` = games the user closed the
 *  prompt for during this app run (asked again after a restart). */
export function gamesAwaitingDecision(
  games: TeamSessionGame[], reviews: TeamSessionReview[], dismissed: ReadonlySet<string> = new Set(),
): TeamSessionGame[] {
  const decided = new Set(reviews.map((r) => r.gameId).filter((id): id is string => id !== null))
  return games.filter((g) => g.status !== 'error' && !decided.has(g.id) && !dismissed.has(g.id))
}

export interface EndOfGameAnswers {
  reviewNow: boolean
  lastGame: boolean
  /** Only meaningful when `lastGame`. */
  finalReviewNow: boolean
}

export interface EndOfGamePlan {
  /** Create a 'deferred' per-game review row (the game was skipped). */
  deferGameReview: boolean
  endSession: boolean
  /** Create a 'deferred' session-scope review row → persistent reminder. */
  deferFinalReview: boolean
  /** Where to send the user, or null to stay where they are. */
  open: { gameId: string | null; final: boolean } | null
}

/** Turns the three answers of the end-of-game dialog into the actions to
 *  run. Pure, so the branching (review now × last game × final now/later)
 *  is unit-tested rather than buried in a component. */
export function planEndOfGame(gameId: string, a: EndOfGameAnswers): EndOfGamePlan {
  const finalNow = a.lastGame && a.finalReviewNow
  return {
    deferGameReview: !a.reviewNow,
    endSession: a.lastGame,
    deferFinalReview: a.lastGame && !a.finalReviewNow,
    open: a.reviewNow || finalNow ? { gameId: a.reviewNow ? gameId : null, final: finalNow } : null,
  }
}

export interface PendingFinalReview {
  reviewId: string
  sessionId: string
  calendarEventId: string
  title: string
  startsAt: string | null
  deferredAt: string
}

/** Final (session-scope) reviews postponed "to another day" for sessions
 *  the signed-in user is responsible for. Filtered by the user's id
 *  explicitly — RLS alone would also return sessions of their groups that
 *  someone else is responsible for. */
export async function listPendingFinalReviews(sb: SupabaseClient): Promise<PendingFinalReview[]> {
  const { data: userData } = await sb.auth.getUser()
  const uid = userData.user?.id
  if (!uid) return []
  const { data: revs, error } = await sb.from('team_session_reviews').select('id, session_id, updated_at')
    .eq('scope', 'session').eq('status', 'deferred').is('game_id', null)
  if (error) fail(error, 'list pending final reviews')
  const rows = (revs ?? []) as Array<{ id: string; session_id: string; updated_at: string }>
  if (rows.length === 0) return []
  const { data: sessions, error: sErr } = await sb.from('team_sessions').select('id, calendar_event_id')
    .in('id', rows.map((r) => r.session_id)).contains('responsible_user_ids', [uid])
  if (sErr) fail(sErr, 'list pending final review sessions')
  const sess = (sessions ?? []) as Array<{ id: string; calendar_event_id: string }>
  if (sess.length === 0) return []
  const { data: events } = await sb.from('calendar_events').select('id, title, starts_at').in('id', sess.map((s) => s.calendar_event_id))
  const ev = new Map(((events ?? []) as Array<{ id: string; title: string; starts_at: string }>).map((e) => [e.id, e]))
  return rows.flatMap((r) => {
    const s = sess.find((x) => x.id === r.session_id)
    if (!s) return []
    const e = ev.get(s.calendar_event_id)
    return [{ reviewId: r.id, sessionId: s.id, calendarEventId: s.calendar_event_id, title: e?.title ?? '', startsAt: e?.starts_at ?? null, deferredAt: r.updated_at }]
  })
}
