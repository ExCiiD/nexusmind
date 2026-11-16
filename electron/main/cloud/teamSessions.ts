import { getSupabase } from './supabase'
import { getMatch } from '../riotClient'
import * as core from '../../../src/lib/teamSessionsCore'
import type { NewGroupFundamentalInput, SessionQueueFilter } from '../../../src/lib/teamSessions'

/** The Riot match-v5 route is derived from the matchId's own platform
 *  prefix (e.g. "EUW1_..."), so this fallback region only matters for a
 *  malformed matchId — see getMatch's own routing logic in riotClient.ts. */
const FALLBACK_REGION = 'EUW1'

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
export const teamSessionListGames = (sessionId: string) => core.listGames(getSupabase(), sessionId)
export const teamSessionSetOurTeamId = (gameId: string, ourTeamId: 100 | 200) => core.setOurTeamId(getSupabase(), gameId, ourTeamId)
export const teamSessionSetEnemyTeamName = (gameId: string, name: string | null) => core.setEnemyTeamName(getSupabase(), gameId, name)

/** Cache-or-fetch (Phase 4): the first viewer to open a game's stats pays
 *  the Riot API round-trip, every later one (any device, any platform)
 *  reads the cached `match_json` instead. */
export async function teamSessionFetchMatch(gameId: string): Promise<unknown> {
  const sb = getSupabase()
  const game = await core.getGame(sb, gameId)
  if (!game) throw new Error('Game not found')
  if (game.matchJson) return game.matchJson
  const matchJson = await getMatch(game.matchId, FALLBACK_REGION)
  await core.cacheGameMatch(sb, gameId, matchJson)
  return matchJson
}
