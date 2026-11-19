import { z } from 'zod'
import { validatedHandle } from './validate'
import * as teamSessions from '../cloud/teamSessions'

const uuid = z.string().uuid()
const objectiveId = z.string().min(1).max(64)
const kpiId = z.string().min(1).max(64)
const queueFilter = z.enum(['flex', 'scrim', 'ranked5', 'all']).nullable()

/** Phase 3 (Planning rework §9): team session lifecycle — objectives,
 *  start/end, games and custom fundamentals. Games are reported to live
 *  sessions by the main process itself (reportGameToLiveTeamSessions in
 *  index.ts), not through IPC. */
export function registerTeamSessionHandlers() {
  validatedHandle('team-session:get-by-event', z.tuple([uuid]), (_e, calendarEventId) => teamSessions.teamSessionGetByEvent(calendarEventId))
  validatedHandle('team-session:start', z.tuple([uuid, z.array(uuid).min(1).max(10), queueFilter]),
    (_e, id, responsibleUserIds, filter) => teamSessions.teamSessionStart(id, responsibleUserIds, filter))
  validatedHandle('team-session:end', z.tuple([uuid]), (_e, id) => teamSessions.teamSessionEnd(id))
  validatedHandle('team-session:get-objectives', z.tuple([uuid]), (_e, sessionId) => teamSessions.teamSessionGetObjectives(sessionId))
  validatedHandle('team-session:set-objectives', z.tuple([uuid, z.array(objectiveId).min(1).max(3), z.array(kpiId).max(20)]),
    (_e, sessionId, objectiveIds, kpiIds) => teamSessions.teamSessionSetObjectives(sessionId, objectiveIds, kpiIds))
  validatedHandle('team-session:list-my-live', z.tuple([]), () => teamSessions.teamSessionListMyLive())
  validatedHandle('team-session:list-games', z.tuple([uuid]), (_e, sessionId) => teamSessions.teamSessionListGames(sessionId))
  validatedHandle('team-session:fetch-match', z.tuple([uuid]), (_e, gameId) => teamSessions.teamSessionFetchMatch(gameId))
  validatedHandle('team-session:set-our-team-id', z.tuple([uuid, z.union([z.literal(100), z.literal(200)])]),
    (_e, gameId, ourTeamId) => teamSessions.teamSessionSetOurTeamId(gameId, ourTeamId))
  validatedHandle('team-session:set-enemy-team-name', z.tuple([uuid, z.string().trim().max(80).nullable()]),
    (_e, gameId, name) => teamSessions.teamSessionSetEnemyTeamName(gameId, name))

  const fundamentalInput = z.object({ label: z.string().trim().min(1).max(80), description: z.string().max(500).nullable().optional() })
  validatedHandle('group-fundamentals:list', z.tuple([uuid]), (_e, groupId) => teamSessions.groupFundamentalsList(groupId))
  validatedHandle('group-fundamentals:add', z.tuple([uuid, fundamentalInput]), (_e, groupId, input) => teamSessions.groupFundamentalsAdd(groupId, input))
}
