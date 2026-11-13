/** Renderer-side mirror of electron/main/cloud/collab.ts types. */

export type GroupRole = 'owner' | 'coach' | 'analyst' | 'player'
export type GroupKind = 'team' | 'coaching'

export interface GroupMember {
  userId: string
  role: GroupRole
  displayName: string | null
  riotId: string | null
  joinedAt: string
}

export interface GroupSharing {
  shareReviews: boolean
  shareStats: boolean
  shareTeam: boolean
}

export interface Group {
  id: string
  name: string
  kind: GroupKind
  myRole: GroupRole
  members: GroupMember[]
  sharing: GroupSharing
}

export interface ReviewComment {
  id: string
  groupId: string
  playerId: string
  reviewId: string
  gameId: string | null
  authorId: string
  parentId: string | null
  videoTimeSec: number | null
  body: string
  resolved: boolean
  createdAt: string
}

export interface AssignedObjective {
  id: string
  groupId: string
  playerId: string
  assignedBy: string
  objectiveIds: string[]
  kpiIds: string[]
  note: string | null
  dueDate: string | null
  status: 'open' | 'done' | 'dismissed'
  createdAt: string
}

export interface PlayerReviewView {
  id: string
  freeText: string | null
  kpiScores: Record<string, number>
  timelineNotes: Array<{ time: string; note: string }>
  objectiveRespected: boolean | null
}

export interface PlayerGameView {
  id: string
  matchId: string
  champion: string
  role: string | null
  win: boolean
  kills: number
  deaths: number
  assists: number
  gameEndAt: number | string | null
  review: PlayerReviewView | null
}

export interface PlayerSessionView {
  id: string
  date: number | string | null
  objectiveIds: string[]
  status: string | null
  sessionConclusion: string | null
  games: PlayerGameView[]
}

export interface CollabApi {
  collabListGroups: () => Promise<Group[]>
  collabCreateGroup: (name: string, kind: GroupKind) => Promise<string>
  collabCreateInvite: (groupId: string, role: Exclude<GroupRole, 'owner'>, days: number) => Promise<string>
  collabJoin: (code: string) => Promise<string>
  collabLeave: (groupId: string) => Promise<void>
  collabDeleteGroup: (groupId: string, confirm: 'DELETE') => Promise<void>
  collabRemoveMember: (groupId: string, userId: string) => Promise<void>
  collabSetSharing: (groupId: string, s: GroupSharing) => Promise<void>
  collabPlayerSessions: (playerId: string) => Promise<PlayerSessionView[]>
  collabListComments: (reviewId: string, playerId?: string) => Promise<ReviewComment[]>
  collabMyOpenComments: () => Promise<ReviewComment[]>
  collabAddComment: (c: {
    groupId: string; playerId?: string; reviewId: string; gameId?: string | null
    parentId?: string | null; videoTimeSec?: number | null; body: string
  }) => Promise<ReviewComment>
  collabResolveComment: (id: string, resolved: boolean) => Promise<void>
  collabDeleteComment: (id: string) => Promise<void>
  collabListAssignments: (playerId?: string, onlyOpen?: boolean) => Promise<AssignedObjective[]>
  collabAssignObjective: (a: {
    groupId: string; playerId: string; objectiveIds: string[]; kpiIds?: string[]; note?: string | null; dueDate?: string | null
  }) => Promise<AssignedObjective>
  collabSetAssignmentStatus: (id: string, status: AssignedObjective['status']) => Promise<void>
}

/** Stable error codes thrown by the main process → i18n keys. */
export function collabErrorKey(err: unknown): string {
  const msg = (err as Error)?.message ?? ''
  for (const code of ['INVITE_INVALID', 'FORBIDDEN', 'TOO_MANY_GROUPS', 'LOGIN_REQUIRED']) {
    if (msg.includes(code)) return `coaching.errors.${code}`
  }
  if (msg.includes('invalid code')) return 'coaching.errors.INVITE_INVALID'
  return 'coaching.errors.generic'
}
