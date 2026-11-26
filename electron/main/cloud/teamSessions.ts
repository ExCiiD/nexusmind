import { getSupabase, requireSessionUserId } from './supabase'
import { getMatch } from '../riotClient'
import * as core from '../../../src/lib/teamSessionsCore'
import * as history from '../../../src/lib/teamSessionHistoryCore'
import type { TeamSessionHistoryFilters } from '../../../src/lib/teamSessionHistory'
import * as prep from '../../../src/lib/sessionPrepCore'
import * as myTeam from '../../../src/lib/myTeamCore'
import * as org from '../../../src/lib/organisationCore'
import type { PlayerObjectivesInput, SessionDraftInput } from '../../../src/lib/sessionPrep'
import { getPrisma } from '../database'
import { resolveMediaFile } from '../mediaAccess'
import { withLocalRecording } from './teamSessionReviews'
import { attachBaseline, getPlayerSessionStats } from '../../../src/lib/playerSessionStatsCore'
import { localBaseline30d } from '../soloPlayerStats'
import { teamGameTimelineWithPlayers } from './analyst'
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

export const teamSessionGetByEvent = (calendarEventId: string) => core.getSessionByEvent(getSupabase(), calendarEventId)
export const teamSessionStart = (id: string, responsibleUserIds: string[], queueFilter: SessionQueueFilter | null) =>
  core.startSession(getSupabase(), id, responsibleUserIds, queueFilter)
export const teamSessionEnd = (id: string) => core.endSession(getSupabase(), id)
export const teamSessionGetObjectives = (sessionId: string) => core.getObjectives(getSupabase(), sessionId)
export const teamSessionSetObjectives = (sessionId: string, objectiveIds: string[], kpiIds: string[]) =>
  requireSessionUserId().then((uid) => core.setObjectives(getSupabase(), uid, sessionId, objectiveIds, kpiIds))
export const teamSessionGetAttendance = (sessionId: string) => core.getAttendance(getSupabase(), sessionId)
export const teamSessionSetAttendance = (sessionId: string, userId: string, present: boolean | null) =>
  core.setAttendance(getSupabase(), sessionId, userId, present)
export const teamSessionListMyLive = () => core.listMyLiveSessions(getSupabase())
export const groupFundamentalsList = (groupId: string) => core.listGroupFundamentals(getSupabase(), groupId)
export const groupFundamentalsAdd = (groupId: string, input: NewGroupFundamentalInput) => core.addGroupFundamental(getSupabase(), groupId, input)
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

// ── Team session history (DESIGN_STATE.md § 15, docs/contracts/team-session-history.md) ──
export const teamSessionHistoryList = (groupId: string, filters: TeamSessionHistoryFilters) =>
  requireSessionUserId().then((uid) => history.listTeamSessionHistory(getSupabase(), uid, groupId, filters))
export async function teamSessionHistoryDetail(sessionId: string) {
  const detail = await history.getTeamSessionHistoryDetail(getSupabase(), sessionId)
  // The cloud keeps recordings by file name: this PC's full path when the file is here.
  const reviews = await Promise.all(detail.reviews.map(withLocalRecording))
  const recording = detail.meeting?.recording
  if (detail.meeting && recording?.localPath) {
    detail.meeting = { ...detail.meeting, recording: { ...recording, localPath: await resolveMediaFile(recording.localPath) } }
  }
  return { ...detail, reviews }
}
/** Individual stats (contract § 7). `enrich` reads Riot, one game at a time, in the background; never otherwise. */
export const teamSessionPlayerStats = async (sessionId: string, opts?: { enrich?: boolean }) => {
  const stats = await getPlayerSessionStats(getSupabase(), sessionId, opts?.enrich ? teamGameTimelineWithPlayers : undefined)
  // The 30-day baseline (the Dashboard's stats) exists on this PC for the signed-in player only (contract § B5).
  const uid = await requireSessionUserId()
  return stats.some((s) => s.memberId === uid) ? attachBaseline(stats, uid, await localBaseline30d().catch(() => null)) : stats
}
export const teamSessionSetObjectiveResult = (sessionId: string, objectiveId: string, gameId: string | null, met: boolean | null) =>
  history.setObjectiveResult(getSupabase(), sessionId, objectiveId, gameId, met)

// ── Preparing a session ahead (docs/contracts/session-prep.md) ──
// ── § 18: "Relancer" and the published dossiers (docs/contracts/organisation.md) ──
export const calendarRemindResponses = (eventId: string, userIds?: string[]) => org.remindEventResponses(getSupabase(), eventId, userIds)
export const calendarListReminders = (eventIds: string[]) => org.listEventReminders(getSupabase(), eventIds)
export const opponentDossierListPublished = (groupId: string) => org.listPublishedDossiers(getSupabase(), groupId)

// ── What my groups give me, across all of them (docs/AUDIT_LIAISONS.md L2-L6) ──
export const myNextEvent = () => requireSessionUserId().then((uid) => myTeam.getMyNextEvent(getSupabase(), uid))
export const myOpenTasks = () => requireSessionUserId().then((uid) => myTeam.listMyOpenTasks(getSupabase(), uid))
export const mySessionObjectives = () => requireSessionUserId().then((uid) => myTeam.listMySessionObjectives(getSupabase(), uid))
export const myVodActionItems = (all?: boolean) => requireSessionUserId().then((uid) => myTeam.listMyVodActionItems(getSupabase(), uid, all ?? false))

export const sessionPrepGet = (sessionId: string) => prep.getSessionPrep(getSupabase(), sessionId)
export const sessionPrepReadyForEvents = (calendarEventIds: string[]) => prep.prepReadyForEvents(getSupabase(), calendarEventIds)
export const sessionPrepSetMessage = (sessionId: string, text: string | null) => prep.setPrepMessage(getSupabase(), sessionId, text)
export const sessionPrepSetPlayerObjectives = (sessionId: string, playerId: string, value: PlayerObjectivesInput | null) =>
  prep.setPlayerObjectives(getSupabase(), sessionId, playerId, value)
export const sessionPrepAttachDraft = (sessionId: string, draft: SessionDraftInput) => prep.attachDraft(getSupabase(), sessionId, draft)
export const sessionPrepAttachSharedDraft = (sessionId: string, teamDraftId: string) => prep.attachSharedDraft(getSupabase(), sessionId, teamDraftId)
export const sessionPrepRemoveDraft = (draftId: string) => prep.removeDraft(getSupabase(), draftId)
export const sessionPrepReorderDrafts = (sessionId: string, draftIds: string[]) => prep.reorderDrafts(getSupabase(), sessionId, draftIds)

/** A draft of the local Draft Sim (the active user's DraftPrep), copied onto the session. */
export async function sessionPrepAttachLocalDraft(sessionId: string, draftPrepId: string): Promise<string> {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  const draft = user ? await prisma.draftPrep.findFirst({ where: { id: draftPrepId, userId: user.id } }) : null
  if (!draft) throw new Error('NOT_FOUND')
  return prep.attachDraft(getSupabase(), sessionId, prep.draftInputFromLocal(draft))
}
