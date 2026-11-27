import { sb, currentUserId } from './supabase'
import * as history from '@/lib/teamSessionHistoryCore'
import { getPlayerSessionStats } from '@/lib/playerSessionStatsCore'
import { getSessionCollective } from '@/lib/teamCollectiveStatsCore'
import { teamGameTimelineWithPlayers } from './analystWeb'
import type { TeamSessionHistoryApi } from '@/lib/teamSessionHistory'

/**
 * Team session history, web side (DESIGN_STATE.md § 15, docs/contracts/team-session-history.md): the same core as the
 * desktop (electron/main/cloud/teamSessions.ts). Spread into the web's window.api (web/src/api.ts) like analystWebApi.
 * No Riot call here: missing matches and timelines go through teamSessionFetchMatch and teamObjectivesGameTimeline.
 */
export const teamSessionHistoryWebApi: TeamSessionHistoryApi = {
  teamSessionHistoryList: async (groupId, filters) => history.listTeamSessionHistory(sb, await currentUserId(), groupId, filters),
  teamSessionHistoryDetail: (sessionId) => history.getTeamSessionHistoryDetail(sb, sessionId),
  teamSessionPlayerStats: (sessionId, opts) => getPlayerSessionStats(sb, sessionId, opts?.enrich ? teamGameTimelineWithPlayers : undefined),
  // No raw timeline on the web: the games whose cached summary lacks the ward events have no setup (never a download).
  teamSessionCollectiveStats: (sessionId) => getSessionCollective(sb, sessionId),
  teamSessionSetObjectiveResult: (sessionId, objectiveId, gameId, met) => history.setObjectiveResult(sb, sessionId, objectiveId, gameId, met),
}
