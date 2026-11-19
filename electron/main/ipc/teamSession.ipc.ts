import { z } from 'zod'
import { validatedHandle } from './validate'
import * as teamSessions from '../cloud/teamSessions'
import { getLiveSessionsCached, refreshLiveSessions } from '../sync/syncService'

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
  // Starting or ending a session refreshes the shared live list at once (pushed as 'team-session:live').
  validatedHandle('team-session:start', z.tuple([uuid, z.array(uuid).min(1).max(10), queueFilter]),
    async (_e, id, responsibleUserIds, filter) => {
      const res = await teamSessions.teamSessionStart(id, responsibleUserIds, filter)
      void refreshLiveSessions()
      return res
    })
  validatedHandle('team-session:end', z.tuple([uuid]), async (_e, id) => {
    const res = await teamSessions.teamSessionEnd(id)
    void refreshLiveSessions()
    return res
  })
  // Item I: the last known live sessions, from the sync service's single poller (no request when already known).
  validatedHandle('team-session:live-cached', z.tuple([]), () => getLiveSessionsCached())
  validatedHandle('team-session:get-objectives', z.tuple([uuid]), (_e, sessionId) => teamSessions.teamSessionGetObjectives(sessionId))
  validatedHandle('team-session:get-attendance', z.tuple([uuid]), (_e, sessionId) => teamSessions.teamSessionGetAttendance(sessionId))
  validatedHandle('team-session:set-attendance', z.tuple([uuid, uuid, z.boolean().nullable()]),
    (_e, sessionId, userId, present) => teamSessions.teamSessionSetAttendance(sessionId, userId, present))
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
