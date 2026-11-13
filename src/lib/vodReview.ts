/** Renderer-side mirror of the shared VOD review tables (E5). */

export type TeamMistakeTag = 'rotation' | 'objective_setup' | 'communication' | 'other'
export type AssignmentStatus = 'pending' | 'done'

export interface VodReviewComment {
  id: string
  sessionId: string
  authorId: string
  videoTimeSec: number | null
  teamTag: TeamMistakeTag | null
  body: string
  createdAt: string
}

export interface VodReviewActionItem {
  id: string
  sessionId: string
  text: string
  done: boolean
  doneBy: string | null
  doneAt: string | null
  createdBy: string
  createdAt: string
}

export interface VodReviewAssignment {
  id: string
  sessionId: string
  playerId: string
  rangeStartSec: number
  rangeEndSec: number
  status: AssignmentStatus
  createdAt: string
  updatedAt: string
}

export interface VodReviewSession {
  id: string
  groupId: string
  scrimId: string | null
  title: string
  vodUrl: string
  createdBy: string
  createdAt: string
  updatedAt: string
  comments: VodReviewComment[]
  actionItems: VodReviewActionItem[]
  assignments: VodReviewAssignment[]
}

export interface NewVodSessionInput {
  scrimId?: string | null
  title: string
  vodUrl: string
}

export interface NewVodCommentInput {
  videoTimeSec?: number | null
  teamTag?: TeamMistakeTag | null
  body: string
}

export interface NewVodAssignmentInput {
  playerId: string
  rangeStartSec: number
  rangeEndSec: number
}

/**
 * All of this is server-only (no local Prisma data), so desktop and web
 * implement every method the same way — same pattern as devPlan.ts.
 */
export interface VodReviewApi {
  vodReviewListSessions: (groupId: string) => Promise<VodReviewSession[]>
  vodReviewCreateSession: (groupId: string, input: NewVodSessionInput) => Promise<string>
  vodReviewDeleteSession: (id: string) => Promise<void>
  vodReviewAddComment: (sessionId: string, input: NewVodCommentInput) => Promise<void>
  vodReviewDeleteComment: (id: string) => Promise<void>
  vodReviewAddActionItem: (sessionId: string, text: string) => Promise<void>
  vodReviewSetActionItemDone: (id: string, done: boolean) => Promise<void>
  vodReviewDeleteActionItem: (id: string) => Promise<void>
  vodReviewSetAssignment: (sessionId: string, input: NewVodAssignmentInput) => Promise<void>
  vodReviewSetAssignmentStatus: (id: string, status: AssignmentStatus) => Promise<void>
  vodReviewDeleteAssignment: (id: string) => Promise<void>
}
