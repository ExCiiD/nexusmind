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
  /** Raw Riot match-v5 payload, cached on first fetch (Phase 4) so every
   *  later viewer skips the Riot API round-trip — see `teamSessionFetchMatch`. */
  matchJson: unknown | null
  /** Which Riot `teamId` (100/200) is "ours" — resolved client-side (needs
   *  the group's roster) once `matchJson` is in hand, then cached here so
   *  it's consistent across viewers even if a roster Riot ID changes later. */
  ourTeamId: 100 | 200 | null
  /** Free-text opponent name for the header ("Our team vs X") — set by a
   *  responsible when the session is scrim/tournament; null falls back to
   *  a generic "Ennemy" label. */
  enemyTeamName: string | null
}

/**
 * Server-only (no local Prisma data), so desktop and web implement every
 * method the same way — same pattern as calendar.ts.
 */
export interface TeamSessionApi {
  teamSessionGetByEvent: (calendarEventId: string) => Promise<TeamSession | null>
  teamSessionStart: (id: string, responsibleUserIds: string[], queueFilter: SessionQueueFilter | null) => Promise<void>
  teamSessionEnd: (id: string) => Promise<void>
  teamSessionGetObjectives: (sessionId: string) => Promise<TeamSessionObjectives | null>
  teamSessionSetObjectives: (sessionId: string, objectiveIds: string[], kpiIds: string[]) => Promise<void>
  teamSessionListMyLive: () => Promise<TeamSession[]>
  groupFundamentalsList: (groupId: string) => Promise<GroupFundamental[]>
  groupFundamentalsAdd: (groupId: string, input: NewGroupFundamentalInput) => Promise<string>
  teamSessionListGames: (sessionId: string) => Promise<TeamSessionGame[]>
  /** Returns the cached raw match if already fetched, otherwise fetches it
   *  from Riot (platform-specific — desktop's riotClient vs web's
   *  riot-proxy fetch) and caches it before returning. */
  teamSessionFetchMatch: (gameId: string) => Promise<unknown>
  teamSessionSetOurTeamId: (gameId: string, ourTeamId: 100 | 200) => Promise<void>
  teamSessionSetEnemyTeamName: (gameId: string, name: string | null) => Promise<void>
}
