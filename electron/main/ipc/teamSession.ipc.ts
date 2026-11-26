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

  // Team session history (DESIGN_STATE.md § 15).
  const historyFilters = z.object({
    kind: z.enum(['all', 'flex', 'scrim', 'tournament', 'meeting', 'other']),
    period: z.enum(['30d', 'season', 'all']),
    before: z.string().datetime({ offset: true }).nullish(),
    limit: z.number().int().min(1).max(50).optional(),
  }).strict()
  validatedHandle('team-session-history:list', z.tuple([uuid, historyFilters]), (_e, groupId, filters) => teamSessions.teamSessionHistoryList(groupId, filters))
  validatedHandle('team-session-history:detail', z.tuple([uuid]), (_e, sessionId) => teamSessions.teamSessionHistoryDetail(sessionId))
  validatedHandle('team-session-history:player-stats', z.tuple([uuid, z.object({ enrich: z.boolean().optional() }).strict().optional()]),
    (_e, sessionId, opts) => teamSessions.teamSessionPlayerStats(sessionId, opts))
  validatedHandle('team-session-history:set-objective-result', z.tuple([uuid, objectiveId, uuid.nullable(), z.boolean().nullable()]),
    (_e, sessionId, objective, gameId, met) => teamSessions.teamSessionSetObjectiveResult(sessionId, objective, gameId, met))

  // Preparing a session ahead (docs/contracts/session-prep.md).
  const playerObjectives = z.object({
    objectiveIds: z.array(objectiveId).max(2),
    kpiIds: z.array(kpiId).max(10),
    note: z.string().max(140).nullable(),
  }).strict()
  const champion = z.string().min(1).max(40)
  const slots = z.array(z.union([champion, z.array(champion).max(10)])).max(5)
  const draftInput = z.object({
    sourceId: z.string().min(1).max(128).nullable(),
    name: z.string().trim().min(1).max(80),
    bluePicks: slots, blueBans: slots, redPicks: slots, redBans: slots,
    myTeamSide: z.enum(['blue', 'red']),
    notes: z.string().max(4000).nullable(),
  }).strict()
  const recordId = z.string().min(1).max(64)
  // § 18: "Relancer" and the published dossiers.
  validatedHandle('organisation:remind', z.tuple([uuid, z.array(uuid).max(50).optional()]), (_e, eventId, ids) => teamSessions.calendarRemindResponses(eventId, ids))
  validatedHandle('organisation:reminders', z.tuple([z.array(uuid).max(200)]), (_e, ids) => teamSessions.calendarListReminders(ids))
  validatedHandle('organisation:published-dossiers', z.tuple([uuid]), (_e, groupId) => teamSessions.opponentDossierListPublished(groupId))
  // What my groups give me (docs/AUDIT_LIAISONS.md L2-L6).
  validatedHandle('my-team:next-event', z.tuple([]), () => teamSessions.myNextEvent())
  validatedHandle('my-team:open-tasks', z.tuple([]), () => teamSessions.myOpenTasks())
  validatedHandle('my-team:session-objectives', z.tuple([]), () => teamSessions.mySessionObjectives())
  validatedHandle('my-team:vod-action-items', z.tuple([z.boolean().optional()]), (_e, all) => teamSessions.myVodActionItems(all))
  validatedHandle('session-prep:get', z.tuple([uuid]), (_e, sessionId) => teamSessions.sessionPrepGet(sessionId))
  validatedHandle('session-prep:ready-for-events', z.tuple([z.array(uuid).max(200)]), (_e, ids) => teamSessions.sessionPrepReadyForEvents(ids))
  validatedHandle('session-prep:set-message', z.tuple([uuid, z.string().max(280).nullable()]), (_e, sessionId, text) => teamSessions.sessionPrepSetMessage(sessionId, text))
  validatedHandle('session-prep:set-player-objectives', z.tuple([uuid, uuid, playerObjectives.nullable()]),
    (_e, sessionId, playerId, value) => teamSessions.sessionPrepSetPlayerObjectives(sessionId, playerId, value))
  validatedHandle('session-prep:attach-draft', z.tuple([uuid, draftInput]), (_e, sessionId, draft) => teamSessions.sessionPrepAttachDraft(sessionId, draft))
  validatedHandle('session-prep:attach-local-draft', z.tuple([uuid, recordId]), (_e, sessionId, id) => teamSessions.sessionPrepAttachLocalDraft(sessionId, id))
  validatedHandle('session-prep:attach-shared-draft', z.tuple([uuid, uuid]), (_e, sessionId, id) => teamSessions.sessionPrepAttachSharedDraft(sessionId, id))
  validatedHandle('session-prep:remove-draft', z.tuple([uuid]), (_e, draftId) => teamSessions.sessionPrepRemoveDraft(draftId))
  validatedHandle('session-prep:reorder-drafts', z.tuple([uuid, z.array(uuid).max(100)]), (_e, sessionId, ids) => teamSessions.sessionPrepReorderDrafts(sessionId, ids))
}
