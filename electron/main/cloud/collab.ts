import { getSupabase, getAccessToken, getSupabaseUrl, requireSessionUserId } from './supabase'
import { getPrisma } from '../database'
import * as core from '../../../src/lib/collabCore'
import * as dashboard from '../../../src/lib/staffDashboardCore'
import * as devPlan from '../../../src/lib/devPlanCore'
import * as calendar from '../../../src/lib/calendarCore'
import * as vodReview from '../../../src/lib/vodReviewCore'
import * as wellbeing from '../../../src/lib/wellbeingCore'
import * as teamOps from '../../../src/lib/teamOpsCore'
import * as announcements from '../../../src/lib/announcementsCore'
import * as report from '../../../src/lib/reportCore'
import type { TeamWeeklyReport } from '../../../src/lib/report'
import * as trials from '../../../src/lib/trialsCore'
import * as scrimsRead from '../../../src/lib/scrimsCore'
import * as discussion from '../../../src/lib/discussionCore'
import * as microReview from '../../../src/lib/microReviewCloudCore'
import type { MicroVerdictInput, TeamCodexRuleInput } from '../../../src/lib/microReview/types'
import type { DiscussionSubjectType } from '../../../src/lib/discussion'
import type { AssignedObjective, GroupKind, GroupLogoImage, GroupRole, GroupSharing } from '../../../src/lib/collab'
import type { AxisStatus, NewAxisInput, NewDevPlanPeriod } from '../../../src/lib/devPlan'
import type { NewAvailabilityExceptionInput, NewAvailabilityRuleInput, NewEventInput, NewEventRequestInput, EventRequestStatus, EventResponseStatus } from '../../../src/lib/calendar'
import type { AssignmentStatus, NewVodAssignmentInput, NewVodCommentInput, NewVodSessionInput } from '../../../src/lib/vodReview'
import type { NewWellbeingCheckinInput } from '../../../src/lib/wellbeing'
import type { NewTaskInput, TaskStatus } from '../../../src/lib/teamOps'
import type { NewAnnouncementInput } from '../../../src/lib/announcements'
import type { NewTrialCandidateInput, NewTrialEvaluationInput, TrialStatus } from '../../../src/lib/trials'

/**
 * Desktop entry points for W3 collaboration. The data access itself lives in
 * `src/lib/collabCore.ts`, shared with the web app; this file only supplies
 * the signed-in client, the user id and the local player identity.
 */

async function me(): Promise<string> {
  // Local session, no server round trip (supabase.ts getSessionUserId).
  return requireSessionUserId()
}

async function localIdentity(): Promise<core.MemberIdentity> {
  const u = await getPrisma().user.findFirst({ where: { isActive: true } })
  if (!u) return { displayName: null, riotId: null }
  return { displayName: u.displayName || u.summonerName, riotId: u.tagLine ? `${u.summonerName}#${u.tagLine}` : u.summonerName }
}

// ── Profile look (Team → Roster player cards) ──────────────────────────────
// The profile icon and banner live in the renderer (per-device preference);
// it reports them here, and they are copied to every membership of the
// signed-in player: right away, after creating or joining a group, and on
// the next group listing after a sign-in. One try per look and account,
// retried after 10 minutes when it failed (offline, or the columns are not
// there yet).

type Look = { iconId: string; bannerId: string }
let myLook: Look | null = null
let lastLookTry: { key: string; at: number; ok: boolean } | null = null
const LOOK_RETRY_MS = 10 * 60_000

async function signedInUid(): Promise<string | null> {
  const token = await getAccessToken().catch(() => null)
  return token ? me().catch(() => null) : null
}

async function shareLook(uid: string, force = false): Promise<boolean> {
  if (!myLook) return false
  const key = `${uid}|${myLook.iconId}|${myLook.bannerId}`
  if (!force && lastLookTry?.key === key && (lastLookTry.ok || Date.now() - lastLookTry.at < LOOK_RETRY_MS)) return lastLookTry.ok
  const ok = await core.setMyLook(getSupabase(), uid, myLook).catch(() => false)
  lastLookTry = { key, at: Date.now(), ok }
  return ok
}

export async function setMyLook(look: Look): Promise<boolean> {
  myLook = look
  const uid = await signedInUid()
  return uid ? shareLook(uid) : false
}

/** New team logo (or none) for a group; the previous file goes. */
export async function setGroupLogo(groupId: string, image: GroupLogoImage | null): Promise<string | null> {
  const sb = getSupabase()
  const prev = await sb.from('groups').select('logo_url').eq('id', groupId).maybeSingle()
  return core.setGroupLogo(sb, groupId, image, (prev.data as { logo_url?: string | null } | null)?.logo_url ?? null)
}

export async function listMemberLooks() {
  const uid = await signedInUid()
  return uid ? core.listMemberLooks(getSupabase(), uid) : []
}

export async function listMyGroups() {
  const uid = await me()
  const groups = await core.listMyGroups(getSupabase(), uid)
  if (groups.length > 0) void shareLook(uid)
  return groups
}

export async function createGroup(name: string, kind: GroupKind): Promise<string> {
  const sb = getSupabase()
  const id = await core.createGroup(sb, name, kind)
  const uid = await me()
  await core.updateMyMemberProfile(sb, uid, id, await localIdentity()).catch(() => {})
  await shareLook(uid, true)
  return id
}

export const createInvite = (groupId: string, role: Exclude<GroupRole, 'owner'>, days: number) =>
  core.createInvite(getSupabase(), groupId, role, days)
export async function joinGroup(code: string): Promise<string> {
  const id = await core.joinGroup(getSupabase(), code, await localIdentity())
  const uid = await signedInUid()
  if (uid) await shareLook(uid, true)
  return id
}
export const leaveGroup = async (groupId: string) => core.leaveGroup(getSupabase(), await me(), groupId)
export const deleteGroup = (groupId: string) => core.deleteGroup(getSupabase(), groupId)
export const removeMember = (groupId: string, userId: string) => core.removeMember(getSupabase(), groupId, userId)
export const setCaptain = (groupId: string, userId: string, isCaptain: boolean) => core.setCaptain(getSupabase(), groupId, userId, isCaptain)
export const setMemberRole = (groupId: string, userId: string, role: Exclude<GroupRole, 'owner'>) => core.setMemberRole(getSupabase(), groupId, userId, role)
export const setSharing = async (groupId: string, s: GroupSharing) => core.setSharing(getSupabase(), await me(), groupId, s)
export const getPlayerSessions = (playerId: string) => core.getPlayerSessions(getSupabase(), playerId)
export const listComments = async (reviewId: string, playerId?: string) =>
  core.listComments(getSupabase(), playerId ?? (await me()), reviewId)
export const listMyOpenComments = async () => core.listMyOpenComments(getSupabase(), await me())
export const addComment = async (c: Parameters<typeof core.addComment>[2]) => core.addComment(getSupabase(), await me(), c)
export const setCommentResolved = (id: string, resolved: boolean) => core.setCommentResolved(getSupabase(), id, resolved)
export const deleteComment = (id: string) => core.deleteComment(getSupabase(), id)
export const listAssignments = async (playerId?: string, onlyOpen = true) =>
  core.listAssignments(getSupabase(), playerId ?? (await me()), onlyOpen)
export const assignObjective = async (a: Parameters<typeof core.assignObjective>[2]) => core.assignObjective(getSupabase(), await me(), a)
export const setAssignmentStatus = (id: string, status: AssignedObjective['status']) => core.setAssignmentStatus(getSupabase(), id, status)

export const getStaffDashboard = (groupId: string) => dashboard.getStaffDashboard(getSupabase(), groupId)

export const devPlanGetMine = async (groupId: string) => devPlan.getMyDevPlan(getSupabase(), groupId, await me())
export const devPlanGetForPlayer = (groupId: string, playerId: string) => devPlan.getDevPlanForPlayer(getSupabase(), groupId, playerId)
export const devPlanCreate = (groupId: string, playerId: string, title: string, axes: NewAxisInput[], period?: NewDevPlanPeriod) =>
  devPlan.createDevPlan(getSupabase(), groupId, playerId, title, axes, period)
export const devPlanSetAxisStatus = (axisId: string, status: AxisStatus) => devPlan.setAxisStatus(getSupabase(), axisId, status)
export const devPlanAddAxis = (planId: string, axis: NewAxisInput) => devPlan.addAxis(getSupabase(), planId, axis)
export const devPlanDeleteAxis = (axisId: string) => devPlan.deleteAxis(getSupabase(), axisId)
export const devPlanAddCheckin = (planId: string, note: string) => devPlan.addCheckin(getSupabase(), planId, note)
export const devPlanSetProgress = (axisId: string, input: { playerMarkedDone?: boolean; playerNote?: string | null }) =>
  devPlan.setProgress(getSupabase(), axisId, input)

export const calendarListEvents = (groupId: string, fromISO: string, toISO: string) => calendar.listEvents(getSupabase(), groupId, fromISO, toISO)
export const calendarGetEvent = (id: string) => calendar.getEvent(getSupabase(), id)
export const calendarCreateEvent = (groupId: string, input: NewEventInput) => calendar.createEvent(getSupabase(), groupId, input)
export const calendarUpdateEvent = (id: string, input: NewEventInput) => calendar.updateEvent(getSupabase(), id, input)
export const calendarDeleteEvent = (id: string) => calendar.deleteEvent(getSupabase(), id)
export const calendarRespond = (eventId: string, status: EventResponseStatus, note?: string | null) => calendar.respondToEvent(getSupabase(), eventId, status, note)
export const availabilityListRules = (groupId: string) => calendar.listAvailabilityRules(getSupabase(), groupId)
export const availabilitySetRule = (groupId: string, input: NewAvailabilityRuleInput) => calendar.setAvailabilityRule(getSupabase(), groupId, input)
export const availabilityDeleteRule = (id: string) => calendar.deleteAvailabilityRule(getSupabase(), id)
export const availabilityListExceptions = (groupId: string, fromDate: string, toDate: string) =>
  calendar.listAvailabilityExceptions(getSupabase(), groupId, fromDate, toDate)
export const availabilitySetException = (groupId: string, input: NewAvailabilityExceptionInput) =>
  calendar.setAvailabilityException(getSupabase(), groupId, input)
export const calendarCreateRequest = (groupId: string, input: NewEventRequestInput) => calendar.createEventRequest(getSupabase(), groupId, input)
export const calendarListRequests = (groupId: string) => calendar.listEventRequests(getSupabase(), groupId)
export const calendarSetRequestStatus = (id: string, status: Exclude<EventRequestStatus, 'pending'>) => calendar.setEventRequestStatus(getSupabase(), id, status)
export const calendarDeleteRequest = (id: string) => calendar.deleteEventRequest(getSupabase(), id)
export const availabilityDeleteException = (id: string) => calendar.deleteAvailabilityException(getSupabase(), id)
export const calendarGetSubscription = (groupId: string) => calendar.getCalendarSubscription(getSupabase(), groupId, getSupabaseUrl())
export const calendarCreateSubscription = (groupId: string) => calendar.createCalendarSubscription(getSupabase(), groupId, getSupabaseUrl())
export const calendarRevokeSubscription = (id: string) => calendar.revokeCalendarSubscription(getSupabase(), id)

export const discussionList = (subjectType: DiscussionSubjectType, subjectId: string) => discussion.listDiscussion(getSupabase(), subjectType, subjectId)
export const discussionAdd = (groupId: string, subjectType: DiscussionSubjectType, subjectId: string, body: string) =>
  discussion.addDiscussionComment(getSupabase(), groupId, subjectType, subjectId, body)
export const discussionDelete = (id: string) => discussion.deleteDiscussionComment(getSupabase(), id)

export const vodReviewListSessions = (groupId: string) => vodReview.listSessions(getSupabase(), groupId)
export const vodReviewCreateSession = (groupId: string, input: NewVodSessionInput) => vodReview.createSession(getSupabase(), groupId, input)
export const vodReviewDeleteSession = (id: string) => vodReview.deleteSession(getSupabase(), id)
export const vodReviewAddComment = (sessionId: string, input: NewVodCommentInput) => vodReview.addComment(getSupabase(), sessionId, input)
export const vodReviewDeleteComment = (id: string) => vodReview.deleteComment(getSupabase(), id)
export const vodReviewAddActionItem = (sessionId: string, text: string) => vodReview.addActionItem(getSupabase(), sessionId, text)
export const vodReviewSetActionItemDone = (id: string, done: boolean) => vodReview.setActionItemDone(getSupabase(), id, done)
export const vodReviewDeleteActionItem = (id: string) => vodReview.deleteActionItem(getSupabase(), id)
export const vodReviewSetAssignment = (sessionId: string, input: NewVodAssignmentInput) => vodReview.setAssignment(getSupabase(), sessionId, input)
export const vodReviewSetAssignmentStatus = (id: string, status: AssignmentStatus) => vodReview.setAssignmentStatus(getSupabase(), id, status)
export const vodReviewDeleteAssignment = (id: string) => vodReview.deleteAssignment(getSupabase(), id)

export const wellbeingAddCheckin = (input: NewWellbeingCheckinInput) => wellbeing.addCheckin(getSupabase(), input)
export const wellbeingListMine = async (limit?: number) => wellbeing.listMine(getSupabase(), await me(), limit)
export const wellbeingListForGroup = (playerIds: string[]) => wellbeing.listForGroup(getSupabase(), playerIds)
export const wellbeingGetLoadThreshold = (groupId: string) => wellbeing.getWeeklyLoadThreshold(getSupabase(), groupId)
export const wellbeingSetLoadThreshold = (groupId: string, hours: number) => wellbeing.setWeeklyLoadThreshold(getSupabase(), groupId, hours)

export const announcementsList = (groupId: string) => announcements.listAnnouncements(getSupabase(), groupId)
export const announcementsCreate = (groupId: string, input: NewAnnouncementInput) => announcements.createAnnouncement(getSupabase(), groupId, input)
export const announcementsSetPinned = (id: string, pinned: boolean) => announcements.setAnnouncementPinned(getSupabase(), id, pinned)
export const announcementsDelete = (id: string) => announcements.deleteAnnouncement(getSupabase(), id)
export const announcementsListMyDismissals = () => announcements.listMyDismissals(getSupabase())
export const announcementsDismiss = (announcementId: string) => announcements.dismissAnnouncement(getSupabase(), announcementId)

export const tasksList = (groupId: string) => teamOps.listTasks(getSupabase(), groupId)
export const tasksCreate = (groupId: string, input: NewTaskInput) => teamOps.createTask(getSupabase(), groupId, input)
export const tasksSetStatus = (id: string, status: TaskStatus) => teamOps.setTaskStatus(getSupabase(), id, status)
export const tasksDelete = (id: string) => teamOps.deleteTask(getSupabase(), id)

export const staffNotesList = (groupId: string, playerId: string) => teamOps.listStaffNotes(getSupabase(), groupId, playerId)
export const staffNotesAdd = (groupId: string, playerId: string, body: string) => teamOps.addStaffNote(getSupabase(), groupId, playerId, body)
export const staffNotesDelete = (id: string) => teamOps.deleteStaffNote(getSupabase(), id)

export const reportGetWeekly = (groupId: string, weekStart: string) => report.computeTeamWeeklyReport(getSupabase(), groupId, weekStart)
export const reportGetForEvent = (groupId: string, eventId: string) => report.computeTeamReportForEvent(getSupabase(), groupId, eventId)
export const reportCreateShare = (groupId: string, groupName: string, r: TeamWeeklyReport) =>
  report.createReportShare(getSupabase(), groupId, groupName, r, getSupabaseUrl())
export const reportRevokeShare = (id: string) => report.revokeReportShare(getSupabase(), id)

export const trialsList = (groupId: string) => trials.listCandidates(getSupabase(), groupId)
export const trialsCreate = (groupId: string, input: NewTrialCandidateInput) => trials.createCandidate(getSupabase(), groupId, input)
export const trialsSetStatus = (id: string, status: TrialStatus) => trials.setCandidateStatus(getSupabase(), id, status)
export const trialsDelete = (id: string) => trials.deleteCandidate(getSupabase(), id)
export const trialsAddEvaluation = (candidateId: string, input: NewTrialEvaluationInput) => trials.addEvaluation(getSupabase(), candidateId, input)
export const trialsDeleteEvaluation = (id: string) => trials.deleteEvaluation(getSupabase(), id)

export const scrimsListForGroup = (groupId: string) => scrimsRead.listScrimsForGroup(getSupabase(), groupId)

// ── Micro-review, coach side (src/lib/microReviewCloudCore.ts) ──────────
let microCloudWarned = false
/** Best effort, never throws: signed out or migration not applied → skipped. */
export async function microReviewPushAnswer(input: microReview.PushAnswerInput): Promise<void> {
  try {
    if (!(await getAccessToken())) return
    await microReview.pushAnswer(getSupabase(), await me(), input)
  } catch (err) {
    if (!microCloudWarned) console.warn('[microreview] cloud push skipped:', (err as Error)?.message ?? err)
    microCloudWarned = true
  }
}
export const microReviewCloudPlayerAnswers = (playerId: string) => microReview.listPlayerAnswers(getSupabase(), playerId)
export const microReviewCloudMyVerdicts = async () => microReview.listMyReviewedAnswers(getSupabase(), await me())
export const microReviewCloudSetVerdict = async (input: MicroVerdictInput) => microReview.setVerdict(getSupabase(), await me(), input)
export const teamCodexList = (groupIds: string[]) => microReview.listTeamCodex(getSupabase(), groupIds)
export const teamCodexAdd = (input: TeamCodexRuleInput) => microReview.addTeamCodexRule(getSupabase(), input)
export const teamCodexDelete = (id: string) => microReview.deleteTeamCodexRule(getSupabase(), id)
