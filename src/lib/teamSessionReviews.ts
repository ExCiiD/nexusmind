/** Renderer-side mirror of the team-session review tables (Phase 5,
 *  Planning rework — docs/PLAN_GESTION_EQUIPE.md §9). */

export type ReviewScope = 'per_game' | 'session' | 'meeting'
export type ReviewStatus = 'pending' | 'recording' | 'processing' | 'done' | 'deferred'
export type YoutubeVisibility = 'public' | 'unlisted' | 'private'

export interface TeamSessionReview {
  id: string
  sessionId: string
  /** Null for a session-level or meeting review — see the unique partial
   *  indexes in the e_phase5_team_session_reviews migration. */
  gameId: string | null
  scope: ReviewScope
  recordedBy: string | null
  recordingLocalPath: string | null
  youtubeUrl: string | null
  youtubeVisibility: YoutubeVisibility
  transcript: string | null
  summary: string | null
  status: ReviewStatus
  createdAt: string
  updatedAt: string
}

export interface TeamSessionReviewPatch {
  recordingLocalPath?: string | null
  youtubeUrl?: string | null
  youtubeVisibility?: YoutubeVisibility
  transcript?: string | null
  summary?: string | null
  status?: ReviewStatus
}

export interface TeamSessionFeedback {
  sessionId: string
  userId: string
  body: string
  transcript: string | null
  createdAt: string
}

/**
 * Server-only (no local Prisma data) — same pattern as teamSessions.ts.
 * Desktop and web implement every method identically, though in practice
 * only desktop ever calls the record/transcribe/upload-driving ones (no
 * screen+voice capture or local Whisper model on the web build).
 */
export interface TeamSessionReviewApi {
  teamSessionReviewsListForSession: (sessionId: string) => Promise<TeamSessionReview[]>
  teamSessionReviewGetForGame: (gameId: string) => Promise<TeamSessionReview | null>
  teamSessionReviewGetForScope: (sessionId: string, scope: 'session' | 'meeting') => Promise<TeamSessionReview | null>
  teamSessionReviewCreate: (sessionId: string, gameId: string | null, scope: ReviewScope, status: ReviewStatus) => Promise<string>
  teamSessionReviewUpdate: (id: string, patch: TeamSessionReviewPatch) => Promise<void>
  teamSessionFeedbackList: (sessionId: string) => Promise<TeamSessionFeedback[]>
  teamSessionFeedbackSubmit: (sessionId: string, body: string, transcript?: string | null) => Promise<void>
}
