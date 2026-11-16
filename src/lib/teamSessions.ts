/** Renderer-side mirror of the team-session tables (Phase 3, Planning
 *  rework — docs/PLAN_GESTION_EQUIPE.md §9). */

export type TeamSessionStatus = 'scheduled' | 'live' | 'ended'

/** 'all' means no filter; null means the responsible hasn't picked one yet. */
export type SessionQueueFilter = 'flex' | 'scrim' | 'ranked5' | 'all'

export interface TeamSession {
  id: string
  groupId: string
  calendarEventId: string
  status: TeamSessionStatus
  /** Captured at start time, not derived live — see teamSessionsCore.ts. */
  responsibleUserIds: string[]
  queueFilter: SessionQueueFilter | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string
}

export interface TeamSessionObjectives {
  sessionId: string
  objectiveIds: string[]
  kpiIds: string[]
  setBy: string | null
  setAt: string
}

/** The "+ Add a fundamental" target — objective-only, no KPI authoring
 *  (see src/lib/fundamentals.ts for how this merges with the static list). */
export interface GroupFundamental {
  id: string
  groupId: string
  label: string
  description: string | null
  createdBy: string
  createdAt: string
}

export interface NewGroupFundamentalInput {
  label: string
  description?: string | null
}

export interface TeamSessionGame {
  id: string
  sessionId: string
  matchId: string
  reportedBy: string | null
  status: 'pending_fetch' | 'fetched' | 'error'
  createdAt: string
}

/**
 * Server-only (no local Prisma data), so desktop and web implement every
 * method the same way — same pattern as calendar.ts.
 */
export interface TeamSessionApi {
  teamSessionsListForGroup: (groupId: string) => Promise<TeamSession[]>
  teamSessionGetByEvent: (calendarEventId: string) => Promise<TeamSession | null>
  teamSessionStart: (id: string, responsibleUserIds: string[], queueFilter: SessionQueueFilter | null) => Promise<void>
  teamSessionEnd: (id: string) => Promise<void>
  teamSessionGetObjectives: (sessionId: string) => Promise<TeamSessionObjectives | null>
  teamSessionSetObjectives: (sessionId: string, objectiveIds: string[], kpiIds: string[]) => Promise<void>
  teamSessionHasLive: () => Promise<boolean>
  teamSessionListMyLive: () => Promise<TeamSession[]>
  groupFundamentalsList: (groupId: string) => Promise<GroupFundamental[]>
  groupFundamentalsAdd: (groupId: string, input: NewGroupFundamentalInput) => Promise<string>
  teamSessionReportGame: (sessionId: string, matchId: string) => Promise<void>
}
