import { getSupabase, getAccessToken } from './supabase'
import { getPrisma } from '../database'
import * as core from '../../../src/lib/collabCore'
import * as dashboard from '../../../src/lib/staffDashboardCore'
import * as devPlan from '../../../src/lib/devPlanCore'
import * as calendar from '../../../src/lib/calendarCore'
import * as vodReview from '../../../src/lib/vodReviewCore'
import * as wellbeing from '../../../src/lib/wellbeingCore'
import * as teamOps from '../../../src/lib/teamOpsCore'
import type { AssignedObjective, GroupKind, GroupRole, GroupSharing } from '../../../src/lib/collab'
import type { AxisStatus, NewAxisInput } from '../../../src/lib/devPlan'
import type { NewAvailabilityExceptionInput, NewAvailabilityRuleInput, NewEventInput } from '../../../src/lib/calendar'
import type { AssignmentStatus, NewVodAssignmentInput, NewVodCommentInput, NewVodSessionInput } from '../../../src/lib/vodReview'
import type { NewWellbeingCheckinInput } from '../../../src/lib/wellbeing'
import type { NewAnnouncementInput, NewTaskInput, TaskStatus } from '../../../src/lib/teamOps'

/**
 * Desktop entry points for W3 collaboration. The data access itself lives in
 * `src/lib/collabCore.ts`, shared with the web app; this file only supplies
 * the signed-in client, the user id and the local player identity.
 */

async function me(): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new Error('LOGIN_REQUIRED')
  const { data } = await getSupabase().auth.getUser(token)
  if (!data.user) throw new Error('LOGIN_REQUIRED')
  return data.user.id
}

async function localIdentity(): Promise<core.MemberIdentity> {
  const u = await getPrisma().user.findFirst({ where: { isActive: true } })
  if (!u) return { displayName: null, riotId: null }
  return { displayName: u.displayName || u.summonerName, riotId: u.tagLine ? `${u.summonerName}#${u.tagLine}` : u.summonerName }
}

export const listMyGroups = async () => core.listMyGroups(getSupabase(), await me())

export async function createGroup(name: string, kind: GroupKind): Promise<string> {
  const sb = getSupabase()
  const id = await core.createGroup(sb, name, kind)
  await core.updateMyMemberProfile(sb, await me(), id, await localIdentity()).catch(() => {})
  return id
}

export const createInvite = (groupId: string, role: Exclude<GroupRole, 'owner'>, days: number) =>
  core.createInvite(getSupabase(), groupId, role, days)
export const joinGroup = async (code: string) => core.joinGroup(getSupabase(), code, await localIdentity())
export const leaveGroup = async (groupId: string) => core.leaveGroup(getSupabase(), await me(), groupId)
export const deleteGroup = (groupId: string) => core.deleteGroup(getSupabase(), groupId)
export const removeMember = (groupId: string, userId: string) => core.removeMember(getSupabase(), groupId, userId)
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
export const devPlanCreate = (groupId: string, playerId: string, title: string, axes: NewAxisInput[]) =>
  devPlan.createDevPlan(getSupabase(), groupId, playerId, title, axes)
export const devPlanSetAxisStatus = (axisId: string, status: AxisStatus) => devPlan.setAxisStatus(getSupabase(), axisId, status)
export const devPlanAddCheckin = (planId: string, note: string) => devPlan.addCheckin(getSupabase(), planId, note)
export const devPlanSetProgress = (axisId: string, input: { playerMarkedDone?: boolean; playerNote?: string | null }) =>
  devPlan.setProgress(getSupabase(), axisId, input)

export const calendarListEvents = (groupId: string, fromISO: string, toISO: string) => calendar.listEvents(getSupabase(), groupId, fromISO, toISO)
export const calendarCreateEvent = (groupId: string, input: NewEventInput) => calendar.createEvent(getSupabase(), groupId, input)
export const calendarUpdateEvent = (id: string, input: NewEventInput) => calendar.updateEvent(getSupabase(), id, input)
export const calendarDeleteEvent = (id: string) => calendar.deleteEvent(getSupabase(), id)
export const availabilityListRules = (groupId: string) => calendar.listAvailabilityRules(getSupabase(), groupId)
export const availabilitySetRule = (groupId: string, input: NewAvailabilityRuleInput) => calendar.setAvailabilityRule(getSupabase(), groupId, input)
export const availabilityDeleteRule = (id: string) => calendar.deleteAvailabilityRule(getSupabase(), id)
export const availabilityListExceptions = (groupId: string, fromDate: string, toDate: string) =>
  calendar.listAvailabilityExceptions(getSupabase(), groupId, fromDate, toDate)
export const availabilitySetException = (groupId: string, input: NewAvailabilityExceptionInput) =>
  calendar.setAvailabilityException(getSupabase(), groupId, input)
export const availabilityDeleteException = (id: string) => calendar.deleteAvailabilityException(getSupabase(), id)

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

export const announcementsList = (groupId: string) => teamOps.listAnnouncements(getSupabase(), groupId)
export const announcementsCreate = (groupId: string, input: NewAnnouncementInput) => teamOps.createAnnouncement(getSupabase(), groupId, input)
export const announcementsSetPinned = (id: string, pinned: boolean) => teamOps.setAnnouncementPinned(getSupabase(), id, pinned)
export const announcementsDelete = (id: string) => teamOps.deleteAnnouncement(getSupabase(), id)

export const tasksList = (groupId: string) => teamOps.listTasks(getSupabase(), groupId)
export const tasksCreate = (groupId: string, input: NewTaskInput) => teamOps.createTask(getSupabase(), groupId, input)
export const tasksSetStatus = (id: string, status: TaskStatus) => teamOps.setTaskStatus(getSupabase(), id, status)
export const tasksDelete = (id: string) => teamOps.deleteTask(getSupabase(), id)

export const staffNotesList = (groupId: string, playerId: string) => teamOps.listStaffNotes(getSupabase(), groupId, playerId)
export const staffNotesAdd = (groupId: string, playerId: string, body: string) => teamOps.addStaffNote(getSupabase(), groupId, playerId, body)
export const staffNotesDelete = (id: string) => teamOps.deleteStaffNote(getSupabase(), id)
