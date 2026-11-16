import * as core from '@/lib/collabCore'
import * as notifications from '@/lib/notificationsCore'
import * as team from '@/lib/teamCore'
import { scoutMemberWeb, autoFillPoolWeb } from './scoutingWeb'
import * as dashboardCore from '@/lib/staffDashboardCore'
import * as devPlanCore from '@/lib/devPlanCore'
import * as calendarCore from '@/lib/calendarCore'
import * as vodReviewCore from '@/lib/vodReviewCore'
import * as wellbeingCore from '@/lib/wellbeingCore'
import * as teamOpsCore from '@/lib/teamOpsCore'
import * as announcementsCore from '@/lib/announcementsCore'
import * as teamSessionsCore from '@/lib/teamSessionsCore'
import * as teamSessionReviewsCore from '@/lib/teamSessionReviewsCore'
import { getMatch as getMatchWeb } from './riotWeb'
import * as reportCore from '@/lib/reportCore'
import * as trialsCore from '@/lib/trialsCore'
import * as scrimsReadCore from '@/lib/scrimsCore'
import * as discussionCore from '@/lib/discussionCore'
import * as access from '@/lib/accessCore'
import { sendFeedback, listMyFeedback, type FeedbackInput } from '@/lib/feedback'
import type { CloudStatus, CloudUser } from '@/lib/ipc'
import { sb, currentUserId, supabaseConfigured, supabaseUrl } from './supabase'

declare const __APP_VERSION__: string

/**
 * Web implementation of the slice of `window.api` used by the shared
 * screens (CloudGate, Coaching page, comment threads, assigned objectives).
 * Same method names and error codes as the desktop IPC, so the React
 * components run unchanged.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function toUser(u: { id: string; email?: string | null; is_anonymous?: boolean; user_metadata?: Record<string, unknown> } | null | undefined): CloudUser | null {
  if (!u || u.is_anonymous) return null
  return { id: u.id, email: u.email ?? null, hasPassword: access.hasPassword(u) }
}


/** On the web there is no local Riot profile: show the e-mail's name part. */
async function webIdentity(): Promise<core.MemberIdentity> {
  const { data } = await sb.auth.getUser()
  const email = data.user?.email ?? ''
  return { displayName: email ? email.split('@')[0].slice(0, 64) : null, riotId: null }
}

/**
 * Links opened from the desktop app (`#handoff=<token_hash>`, single use,
 * see the web-handoff Edge Function) sign the browser in without an e-mail
 * code; invite links (`#invite=<code>`) pre-fill the sign-in screen. The
 * fragment never reaches a server and is removed from the address bar at once.
 */
let pendingHandoff: Promise<void> = Promise.resolve()
let pendingInvite: string | null = null

function consumeUrlFragment(): void {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const handoff = params.get('handoff')
  const invite = params.get('invite')
  if (!handoff && !invite) return
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  if (invite) {
    const code = access.normaliseInviteCode(invite)
    if (access.INVITE_CODE.test(code)) pendingInvite = code
  }
  if (handoff && /^[A-Za-z0-9_-]{16,128}$/.test(handoff) && supabaseConfigured) {
    pendingHandoff = sb.auth.verifyOtp({ token_hash: handoff, type: 'magiclink' })
      .then(() => undefined, () => undefined)
  }
}

/**
 * E14: the web Team page is group-scoped (one roster per group), but the
 * desktop IPC methods it reuses (listTeams/addTeamMember/...) carry no
 * group id at all — they're scoped to "the active local user" instead.
 * The web Team page calls `teamSetActiveGroup` once when the user picks a
 * group, and every team/draft method below reads it from here. A `teamId`
 * argument then disambiguates "the group's own roster" (teamId ===
 * activeGroupId) from "a scouted opponent's roster" (teamId === that
 * opponent's team_scouting id) — see teamCore.ts's listGroupTeams.
 */
let activeGroupId: string | null = null
function requireActiveGroup(): string {
  if (!activeGroupId) throw new Error('No active group — open the Team page from a group first.')
  return activeGroupId
}
/** null when `teamId` is the group's own roster, else the scouting_id. */
function scoutingIdFor(teamId: string): string | null {
  return teamId === activeGroupId ? null : teamId
}

export const webApi = {
  /** Invite code from an invite link, for the sign-in screen. */
  pendingInviteCode: (): string | null => pendingInvite,
  // ── account ──
  async cloudStatus(): Promise<CloudStatus> {
    if (!supabaseConfigured) return { configured: false, user: null, riotMode: 'none', lastBackupAt: null }
    await pendingHandoff
    const { data } = await sb.auth.getSession()
    return { configured: true, user: toUser(data.session?.user), riotMode: 'none', lastBackupAt: null }
  },
  async cloudSendCode(email: string, inviteCode?: string) {
    const address = email.trim().toLowerCase()
    if (!EMAIL.test(address)) throw new Error('Invalid input for cloud:send-code')
    const invite = inviteCode ? access.normaliseInviteCode(inviteCode) : undefined
    if (invite !== undefined && !access.INVITE_CODE.test(invite)) throw new Error('INVITE_INVALID')
    await access.sendSignInCode(sb, address, invite)
    return { sent: true }
  },
  async cloudVerifyCode(email: string, code: string) {
    if (!/^\d{6,10}$/.test(code.trim())) throw new Error('invalid code')
    const { data, error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' })
    if (error) throw new Error(access.authErrorCode(error.message))
    return toUser(data.session?.user)
  },
  async cloudSignInPassword(email: string, password: string) {
    const address = email.trim().toLowerCase()
    if (!EMAIL.test(address)) throw new Error('Invalid input for cloud:send-code')
    const session = await access.signInWithPassword(sb, address, password)
    return toUser(session?.user)
  },
  async cloudSetPassword(password: string) {
    await access.setPassword(sb, password)
    const { data } = await sb.auth.getUser()
    return toUser(data.user)
  },
  async cloudSignOut() {
    await sb.auth.signOut({ scope: 'local' }) // this browser only
    return { signedOut: true }
  },
  onCloudAuthChanged(cb: (user: CloudUser | null) => void) {
    const { data } = sb.auth.onAuthStateChange((_e, session) => cb(toUser(session?.user)))
    return () => data.subscription.unsubscribe()
  },

  // ── invite-only access (admins) ──
  accessIsAdmin: async () => access.isAppAdmin(sb, await currentUserId()),
  accessListInvites: () => access.listAccessInvites(sb),
  accessCreateInvite: (opts: Parameters<typeof access.createAccessInvite>[1]) => access.createAccessInvite(sb, opts),
  async accessRevokeInvite(code: string) {
    await access.revokeAccessInvite(sb, access.normaliseInviteCode(code))
    return { revoked: true }
  },

  // ── collaboration (same semantics as electron/main/cloud/collab.ts) ──
  collabListGroups: async () => core.listMyGroups(sb, await currentUserId()),
  async collabCreateGroup(name: string, kind: 'team' | 'coaching') {
    const id = await core.createGroup(sb, name.trim(), kind)
    await core.updateMyMemberProfile(sb, await currentUserId(), id, await webIdentity()).catch(() => {})
    return id
  },
  collabCreateInvite: (groupId: string, role: 'coach' | 'analyst' | 'player', days: number) => core.createInvite(sb, groupId, role, days),
  collabJoin: async (code: string) => core.joinGroup(sb, code.trim().toUpperCase(), await webIdentity()),
  collabLeave: async (groupId: string) => core.leaveGroup(sb, await currentUserId(), groupId),
  collabDeleteGroup: (groupId: string) => core.deleteGroup(sb, groupId),
  collabRemoveMember: (groupId: string, userId: string) => core.removeMember(sb, groupId, userId),
  collabSetCaptain: (groupId: string, userId: string, isCaptain: boolean) => core.setCaptain(sb, groupId, userId, isCaptain),

  // ── Phase 3: team sessions ──
  teamSessionsListForGroup: (groupId: string) => teamSessionsCore.listSessionsForGroup(sb, groupId),
  teamSessionGetByEvent: (calendarEventId: string) => teamSessionsCore.getSessionByEvent(sb, calendarEventId),
  teamSessionStart: (id: string, responsibleUserIds: string[], queueFilter: Parameters<typeof teamSessionsCore.startSession>[3]) =>
    teamSessionsCore.startSession(sb, id, responsibleUserIds, queueFilter),
  teamSessionEnd: (id: string) => teamSessionsCore.endSession(sb, id),
  teamSessionGetObjectives: (sessionId: string) => teamSessionsCore.getObjectives(sb, sessionId),
  teamSessionSetObjectives: (sessionId: string, objectiveIds: string[], kpiIds: string[]) => teamSessionsCore.setObjectives(sb, sessionId, objectiveIds, kpiIds),
  teamSessionHasLive: () => teamSessionsCore.hasLiveSessionForUser(sb),
  teamSessionListMyLive: () => teamSessionsCore.listMyLiveSessions(sb),
  teamSessionReportGame: (sessionId: string, matchId: string) => teamSessionsCore.reportSessionGame(sb, sessionId, matchId),
  groupFundamentalsList: (groupId: string) => teamSessionsCore.listGroupFundamentals(sb, groupId),
  groupFundamentalsAdd: (groupId: string, input: Parameters<typeof teamSessionsCore.addGroupFundamental>[2]) => teamSessionsCore.addGroupFundamental(sb, groupId, input),

  // ── Phase 4: per-game stats ──
  teamSessionListGames: (sessionId: string) => teamSessionsCore.listGames(sb, sessionId),
  teamSessionFetchMatch: async (gameId: string) => {
    const game = await teamSessionsCore.getGame(sb, gameId)
    if (!game) throw new Error('Game not found')
    if (game.matchJson) return game.matchJson
    const matchJson = await getMatchWeb(game.matchId, 'EUW1')
    await teamSessionsCore.cacheGameMatch(sb, gameId, matchJson)
    return matchJson
  },
  teamSessionSetOurTeamId: (gameId: string, ourTeamId: 100 | 200) => teamSessionsCore.setOurTeamId(sb, gameId, ourTeamId),
  teamSessionSetEnemyTeamName: (gameId: string, name: string | null) => teamSessionsCore.setEnemyTeamName(sb, gameId, name),

  // ── Phase 5: team session reviews (CRUD only — recording/transcription/
  // YouTube upload are desktop-only, see src/components/TeamSession) ──
  teamSessionReviewsListForSession: (sessionId: string) => teamSessionReviewsCore.listReviewsForSession(sb, sessionId),
  teamSessionReviewGetForGame: (gameId: string) => teamSessionReviewsCore.getReviewForGame(sb, gameId),
  teamSessionReviewGetForScope: (sessionId: string, scope: 'session' | 'meeting') => teamSessionReviewsCore.getReviewForScope(sb, sessionId, scope),
  teamSessionReviewCreate: (sessionId: string, gameId: string | null, scope: Parameters<typeof teamSessionReviewsCore.createReview>[3], status: Parameters<typeof teamSessionReviewsCore.createReview>[4]) =>
    teamSessionReviewsCore.createReview(sb, sessionId, gameId, scope, status),
  teamSessionReviewUpdate: (id: string, patch: Parameters<typeof teamSessionReviewsCore.updateReview>[2]) => teamSessionReviewsCore.updateReview(sb, id, patch),
  teamSessionFeedbackList: (sessionId: string) => teamSessionReviewsCore.listFeedbackForSession(sb, sessionId),
  teamSessionFeedbackSubmit: (sessionId: string, body: string, transcript?: string | null) => teamSessionReviewsCore.submitFeedback(sb, sessionId, body, transcript ?? null),
  collabSetSharing: async (groupId: string, s: { shareReviews: boolean; shareStats: boolean; shareTeam: boolean; shareWellbeing: boolean }) =>
    core.setSharing(sb, await currentUserId(), groupId, s),
  collabPlayerSessions: (playerId: string) => core.getPlayerSessions(sb, playerId),
  collabListComments: async (reviewId: string, playerId?: string) => core.listComments(sb, playerId ?? (await currentUserId()), reviewId),
  collabMyOpenComments: async () => core.listMyOpenComments(sb, await currentUserId()),
  collabAddComment: async (c: Parameters<typeof core.addComment>[2]) => core.addComment(sb, await currentUserId(), c),
  collabResolveComment: (id: string, resolved: boolean) => core.setCommentResolved(sb, id, resolved),
  collabDeleteComment: (id: string) => core.deleteComment(sb, id),
  collabListAssignments: async (playerId?: string, onlyOpen?: boolean) =>
    core.listAssignments(sb, playerId ?? (await currentUserId()), onlyOpen ?? true),
  collabAssignObjective: async (a: Parameters<typeof core.assignObjective>[2]) => core.assignObjective(sb, await currentUserId(), a),
  collabSetAssignmentStatus: (id: string, status: 'open' | 'done' | 'dismissed') => core.setAssignmentStatus(sb, id, status),
  collabStaffDashboard: (groupId: string) => dashboardCore.getStaffDashboard(sb, groupId),

  // ── E3: individual development plans ──
  devPlanGetMine: async (groupId: string) => devPlanCore.getMyDevPlan(sb, groupId, await currentUserId()),
  devPlanGetForPlayer: (groupId: string, playerId: string) => devPlanCore.getDevPlanForPlayer(sb, groupId, playerId),
  devPlanCreate: (groupId: string, playerId: string, title: string, axes: Parameters<typeof devPlanCore.createDevPlan>[4], period?: Parameters<typeof devPlanCore.createDevPlan>[5]) =>
    devPlanCore.createDevPlan(sb, groupId, playerId, title, axes, period),
  devPlanSetAxisStatus: (axisId: string, status: 'active' | 'done' | 'dropped') => devPlanCore.setAxisStatus(sb, axisId, status),
  devPlanAddCheckin: (planId: string, note: string) => devPlanCore.addCheckin(sb, planId, note),
  devPlanSetProgress: (axisId: string, input: { playerMarkedDone?: boolean; playerNote?: string | null }) =>
    devPlanCore.setProgress(sb, axisId, input),

  // ── E4: planning & presence ──
  calendarListEvents: (groupId: string, fromISO: string, toISO: string) => calendarCore.listEvents(sb, groupId, fromISO, toISO),
  calendarGetEvent: (id: string) => calendarCore.getEvent(sb, id),
  calendarCreateEvent: (groupId: string, input: Parameters<typeof calendarCore.createEvent>[2]) => calendarCore.createEvent(sb, groupId, input),
  calendarUpdateEvent: (id: string, input: Parameters<typeof calendarCore.updateEvent>[2]) => calendarCore.updateEvent(sb, id, input),
  calendarDeleteEvent: (id: string) => calendarCore.deleteEvent(sb, id),
  availabilityListRules: (groupId: string) => calendarCore.listAvailabilityRules(sb, groupId),
  availabilitySetRule: (groupId: string, input: Parameters<typeof calendarCore.setAvailabilityRule>[2]) => calendarCore.setAvailabilityRule(sb, groupId, input),
  availabilityDeleteRule: (id: string) => calendarCore.deleteAvailabilityRule(sb, id),
  availabilityListExceptions: (groupId: string, fromDate: string, toDate: string) => calendarCore.listAvailabilityExceptions(sb, groupId, fromDate, toDate),
  availabilitySetException: (groupId: string, input: Parameters<typeof calendarCore.setAvailabilityException>[2]) => calendarCore.setAvailabilityException(sb, groupId, input),
  availabilityDeleteException: (id: string) => calendarCore.deleteAvailabilityException(sb, id),
  calendarGetSubscription: (groupId: string) => calendarCore.getCalendarSubscription(sb, groupId, supabaseUrl),
  calendarCreateSubscription: (groupId: string) => calendarCore.createCalendarSubscription(sb, groupId, supabaseUrl),
  calendarRevokeSubscription: (id: string) => calendarCore.revokeCalendarSubscription(sb, id),
  calendarCreateRequest: (groupId: string, input: Parameters<typeof calendarCore.createEventRequest>[2]) => calendarCore.createEventRequest(sb, groupId, input),
  calendarListRequests: (groupId: string) => calendarCore.listEventRequests(sb, groupId),
  calendarSetRequestStatus: (id: string, status: Parameters<typeof calendarCore.setEventRequestStatus>[2]) => calendarCore.setEventRequestStatus(sb, id, status),
  calendarDeleteRequest: (id: string) => calendarCore.deleteEventRequest(sb, id),

  // ── E7 v2: discussion threads (scrim/draft) ──
  discussionList: (subjectType: Parameters<typeof discussionCore.listDiscussion>[1], subjectId: string) => discussionCore.listDiscussion(sb, subjectType, subjectId),
  discussionAdd: (groupId: string, subjectType: Parameters<typeof discussionCore.addDiscussionComment>[2], subjectId: string, body: string) =>
    discussionCore.addDiscussionComment(sb, groupId, subjectType, subjectId, body),
  discussionDelete: (id: string) => discussionCore.deleteDiscussionComment(sb, id),

  // ── E5: collaborative VOD review ──
  vodReviewListSessions: (groupId: string) => vodReviewCore.listSessions(sb, groupId),
  vodReviewCreateSession: (groupId: string, input: Parameters<typeof vodReviewCore.createSession>[2]) => vodReviewCore.createSession(sb, groupId, input),
  vodReviewDeleteSession: (id: string) => vodReviewCore.deleteSession(sb, id),
  vodReviewAddComment: (sessionId: string, input: Parameters<typeof vodReviewCore.addComment>[2]) => vodReviewCore.addComment(sb, sessionId, input),
  vodReviewDeleteComment: (id: string) => vodReviewCore.deleteComment(sb, id),
  vodReviewAddActionItem: (sessionId: string, text: string) => vodReviewCore.addActionItem(sb, sessionId, text),
  vodReviewSetActionItemDone: (id: string, done: boolean) => vodReviewCore.setActionItemDone(sb, id, done),
  vodReviewDeleteActionItem: (id: string) => vodReviewCore.deleteActionItem(sb, id),
  vodReviewSetAssignment: (sessionId: string, input: Parameters<typeof vodReviewCore.setAssignment>[2]) => vodReviewCore.setAssignment(sb, sessionId, input),
  vodReviewSetAssignmentStatus: (id: string, status: 'pending' | 'done') => vodReviewCore.setAssignmentStatus(sb, id, status),
  vodReviewDeleteAssignment: (id: string) => vodReviewCore.deleteAssignment(sb, id),

  // ── E6: wellbeing & load ──
  wellbeingAddCheckin: (input: Parameters<typeof wellbeingCore.addCheckin>[1]) => wellbeingCore.addCheckin(sb, input),
  wellbeingListMine: async (limit?: number) => wellbeingCore.listMine(sb, await currentUserId(), limit),
  wellbeingListForGroup: (playerIds: string[]) => wellbeingCore.listForGroup(sb, playerIds),
  wellbeingGetLoadThreshold: (groupId: string) => wellbeingCore.getWeeklyLoadThreshold(sb, groupId),
  wellbeingSetLoadThreshold: (groupId: string, hours: number) => wellbeingCore.setWeeklyLoadThreshold(sb, groupId, hours),

  // ── E7: communication & tasks ──
  announcementsList: (groupId: string) => announcementsCore.listAnnouncements(sb, groupId),
  announcementsCreate: (groupId: string, input: Parameters<typeof announcementsCore.createAnnouncement>[2]) => announcementsCore.createAnnouncement(sb, groupId, input),
  announcementsSetPinned: (id: string, pinned: boolean) => announcementsCore.setAnnouncementPinned(sb, id, pinned),
  announcementsDelete: (id: string) => announcementsCore.deleteAnnouncement(sb, id),
  announcementsListMyDismissals: () => announcementsCore.listMyDismissals(sb),
  announcementsDismiss: (announcementId: string) => announcementsCore.dismissAnnouncement(sb, announcementId),
  tasksList: (groupId: string) => teamOpsCore.listTasks(sb, groupId),
  tasksCreate: (groupId: string, input: Parameters<typeof teamOpsCore.createTask>[2]) => teamOpsCore.createTask(sb, groupId, input),
  tasksSetStatus: (id: string, status: 'open' | 'done') => teamOpsCore.setTaskStatus(sb, id, status),
  tasksDelete: (id: string) => teamOpsCore.deleteTask(sb, id),
  staffNotesList: (groupId: string, playerId: string) => teamOpsCore.listStaffNotes(sb, groupId, playerId),
  staffNotesAdd: (groupId: string, playerId: string, body: string) => teamOpsCore.addStaffNote(sb, groupId, playerId, body),
  staffNotesDelete: (id: string) => teamOpsCore.deleteStaffNote(sb, id),

  // ── E9: weekly reports ──
  reportGetWeekly: (groupId: string, weekStart: string) => reportCore.computeTeamWeeklyReport(sb, groupId, weekStart),
  reportGetForEvent: (groupId: string, eventId: string) => reportCore.computeTeamReportForEvent(sb, groupId, eventId),
  reportCreateShare: (groupId: string, groupName: string, report: Parameters<typeof reportCore.createReportShare>[3]) =>
    reportCore.createReportShare(sb, groupId, groupName, report, supabaseUrl),
  reportRevokeShare: (id: string) => reportCore.revokeReportShare(sb, id),

  // ── E10: recruitment trials ──
  trialsList: (groupId: string) => trialsCore.listCandidates(sb, groupId),
  trialsCreate: (groupId: string, input: Parameters<typeof trialsCore.createCandidate>[2]) => trialsCore.createCandidate(sb, groupId, input),
  trialsSetStatus: (id: string, status: 'trialing' | 'kept' | 'rejected') => trialsCore.setCandidateStatus(sb, id, status),
  trialsDelete: (id: string) => trialsCore.deleteCandidate(sb, id),
  trialsAddEvaluation: (candidateId: string, input: Parameters<typeof trialsCore.addEvaluation>[2]) => trialsCore.addEvaluation(sb, candidateId, input),
  trialsDeleteEvaluation: (id: string) => trialsCore.deleteEvaluation(sb, id),

  // ── E5 follow-up: read-only scrims list ──
  scrimsListForGroup: (groupId: string) => scrimsReadCore.listScrimsForGroup(sb, groupId),

  // ── W5: notifications ──
  notificationsList: async (onlyUnread?: boolean) =>
    notifications.listNotifications(sb, await currentUserId(), { onlyUnread }),
  notificationsUnreadCount: async () => notifications.countUnreadNotifications(sb, await currentUserId()),
  async notificationsMarkRead(id: string) {
    await notifications.markNotificationRead(sb, id)
    return { ok: true }
  },
  async notificationsMarkAllRead() {
    await notifications.markAllNotificationsRead(sb, await currentUserId())
    return { ok: true }
  },
  notificationPrefsGet: async () => notifications.getNotificationPrefs(sb, await currentUserId()),
  notificationPrefsSet: async (prefs: Parameters<typeof notifications.setNotificationPrefs>[2]) =>
    notifications.setNotificationPrefs(sb, await currentUserId(), prefs),

  // ── E1: shared team workspace (read-only snapshot view) ──
  teamGetShared: (groupId: string) => team.getSharedTeam(sb, groupId),

  // ── E14: full Team page on the web (roster/pool/draft/scouting) ──
  // Called by the real desktop tab components (RosterTab/ChampPoolTab/
  // DraftTab/ScoutingTab, src/pages/Team/*.tsx) via the web Team page
  // (web/src/pages/TeamPage.tsx), which calls teamSetActiveGroup first.
  teamSetActiveGroup(groupId: string | null) { activeGroupId = groupId },
  listTeams: (opts?: { isOpponent?: boolean }) => team.listGroupTeams(sb, requireActiveGroup(), opts ?? {}),
  async createTeam(data: { name: string; tag?: string; notes?: string; isOpponent?: boolean }) {
    if (!data.isOpponent) {
      // The group's own roster always exists implicitly — nothing to
      // create. Not actually reachable from the web Team page (it never
      // shows a "create team" prompt for the own roster), kept defensive.
      return (await team.listGroupTeams(sb, requireActiveGroup(), { isOpponent: false }))[0]
    }
    return team.createOpponentTeam(sb, requireActiveGroup(), { name: data.name, tag: data.tag ?? null, notes: data.notes ?? null })
  },
  async deleteTeam(id: string) {
    if (id === activeGroupId) throw new Error('Cannot delete the group\'s own roster from here.')
    await team.deleteOpponentTeam(sb, id)
    return { ok: true as const }
  },
  addTeamMember: (teamId: string, data: Parameters<typeof team.addRosterMember>[3]) =>
    team.addRosterMember(sb, requireActiveGroup(), scoutingIdFor(teamId), data),
  updateTeamMember: (memberId: string, data: Parameters<typeof team.updateRosterMember>[2]) =>
    team.updateRosterMember(sb, memberId, data),
  async removeTeamMember(memberId: string) {
    await team.removeRosterMember(sb, memberId)
    return { ok: true as const }
  },
  dedupeTeamMembers: (teamId: string) => team.dedupeRosterMembers(sb, requireActiveGroup(), scoutingIdFor(teamId)),
  listChampionPool: (memberId: string) => team.listPoolForMember(sb, memberId),
  upsertChampionPool: (memberId: string, championKey: string, role: string, data: Parameters<typeof team.upsertPoolEntry>[4]) =>
    team.upsertPoolEntry(sb, memberId, championKey, role, data),
  async removeChampionPoolEntry(entryId: string) {
    await team.removePoolEntry(sb, entryId)
    return { ok: true as const }
  },
  async scoutMember(memberId: string, count?: number, opts?: { roleOnly?: boolean }) {
    const member = await team.getRosterMember(sb, memberId)
    return scoutMemberWeb(member, count, opts)
  },
  async autoFillPool(memberId: string, opts?: { matchCount?: number; masteryCount?: number; roleOnly?: boolean }) {
    const member = await team.getRosterMember(sb, memberId)
    return autoFillPoolWeb(member, opts)
  },
  listDrafts: () => team.listGroupDrafts(sb, requireActiveGroup()),
  createDraft: (data: Parameters<typeof team.createGroupDraft>[2]) => team.createGroupDraft(sb, requireActiveGroup(), data),
  updateDraft: (id: string, data: Parameters<typeof team.updateGroupDraft>[2]) => team.updateGroupDraft(sb, id, data),
  async deleteDraft(id: string) {
    await team.deleteGroupDraft(sb, id)
    return { ok: true as const }
  },
  duplicateDraft: (id: string) => team.duplicateGroupDraft(sb, requireActiveGroup(), id),

  // ── bug reports / feature requests ──
  feedbackSend: async (report: FeedbackInput) =>
    sendFeedback(sb, await currentUserId(), report, {
      source: 'web',
      appVersion: `web-${__APP_VERSION__}`,
      platform: navigator.userAgent.slice(0, 200),
    }),
  feedbackList: async () => listMyFeedback(sb, await currentUserId()),
}

/** Installs the adapter as `window.api` before React renders. */
export function installWebApi(): void {
  consumeUrlFragment()
  ;(window as unknown as { api: typeof webApi }).api = webApi
}
