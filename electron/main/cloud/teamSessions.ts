import { getSupabase } from './supabase'
import * as core from '../../../src/lib/teamSessionsCore'
import type { NewGroupFundamentalInput, SessionQueueFilter } from '../../../src/lib/teamSessions'

/**
 * Desktop entry points for team sessions (Phase 3, Planning rework). Same
 * pattern as collab.ts — the data access lives in teamSessionsCore.ts,
 * shared with the web app; this file only supplies the signed-in client.
 */

export const teamSessionsListForGroup = (groupId: string) => core.listSessionsForGroup(getSupabase(), groupId)
export const teamSessionGetByEvent = (calendarEventId: string) => core.getSessionByEvent(getSupabase(), calendarEventId)
export const teamSessionStart = (id: string, responsibleUserIds: string[], queueFilter: SessionQueueFilter | null) =>
  core.startSession(getSupabase(), id, responsibleUserIds, queueFilter)
export const teamSessionEnd = (id: string) => core.endSession(getSupabase(), id)
export const teamSessionGetObjectives = (sessionId: string) => core.getObjectives(getSupabase(), sessionId)
export const teamSessionSetObjectives = (sessionId: string, objectiveIds: string[], kpiIds: string[]) =>
  core.setObjectives(getSupabase(), sessionId, objectiveIds, kpiIds)
export const teamSessionHasLive = () => core.hasLiveSessionForUser(getSupabase())
export const teamSessionListMyLive = () => core.listMyLiveSessions(getSupabase())
export const groupFundamentalsList = (groupId: string) => core.listGroupFundamentals(getSupabase(), groupId)
export const groupFundamentalsAdd = (groupId: string, input: NewGroupFundamentalInput) => core.addGroupFundamental(getSupabase(), groupId, input)
export const teamSessionReportGame = (sessionId: string, matchId: string) => core.reportSessionGame(getSupabase(), sessionId, matchId)
