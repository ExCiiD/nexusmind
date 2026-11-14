import * as core from '@/lib/collabCore'
import * as notifications from '@/lib/notificationsCore'
import * as team from '@/lib/teamCore'
import * as dashboardCore from '@/lib/staffDashboardCore'
import * as devPlanCore from '@/lib/devPlanCore'
import * as calendarCore from '@/lib/calendarCore'
import * as vodReviewCore from '@/lib/vodReviewCore'
import * as wellbeingCore from '@/lib/wellbeingCore'
import * as teamOpsCore from '@/lib/teamOpsCore'
import * as access from '@/lib/accessCore'
import { sendFeedback, listMyFeedback, type FeedbackInput } from '@/lib/feedback'
import type { CloudStatus, CloudUser } from '@/lib/ipc'
import { sb, currentUserId, supabaseConfigured } from './supabase'

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
  devPlanCreate: (groupId: string, playerId: string, title: string, axes: Parameters<typeof devPlanCore.createDevPlan>[4]) =>
    devPlanCore.createDevPlan(sb, groupId, playerId, title, axes),
  devPlanSetAxisStatus: (axisId: string, status: 'active' | 'done' | 'dropped') => devPlanCore.setAxisStatus(sb, axisId, status),
  devPlanAddCheckin: (planId: string, note: string) => devPlanCore.addCheckin(sb, planId, note),
  devPlanSetProgress: (axisId: string, input: { playerMarkedDone?: boolean; playerNote?: string | null }) =>
    devPlanCore.setProgress(sb, axisId, input),

  // ── E4: planning & presence ──
  calendarListEvents: (groupId: string, fromISO: string, toISO: string) => calendarCore.listEvents(sb, groupId, fromISO, toISO),
  calendarCreateEvent: (groupId: string, input: Parameters<typeof calendarCore.createEvent>[2]) => calendarCore.createEvent(sb, groupId, input),
  calendarUpdateEvent: (id: string, input: Parameters<typeof calendarCore.updateEvent>[2]) => calendarCore.updateEvent(sb, id, input),
  calendarDeleteEvent: (id: string) => calendarCore.deleteEvent(sb, id),
  availabilityListRules: (groupId: string) => calendarCore.listAvailabilityRules(sb, groupId),
  availabilitySetRule: (groupId: string, input: Parameters<typeof calendarCore.setAvailabilityRule>[2]) => calendarCore.setAvailabilityRule(sb, groupId, input),
  availabilityDeleteRule: (id: string) => calendarCore.deleteAvailabilityRule(sb, id),
  availabilityListExceptions: (groupId: string, fromDate: string, toDate: string) => calendarCore.listAvailabilityExceptions(sb, groupId, fromDate, toDate),
  availabilitySetException: (groupId: string, input: Parameters<typeof calendarCore.setAvailabilityException>[2]) => calendarCore.setAvailabilityException(sb, groupId, input),
  availabilityDeleteException: (id: string) => calendarCore.deleteAvailabilityException(sb, id),

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

  // ── E7: communication & tasks ──
  announcementsList: (groupId: string) => teamOpsCore.listAnnouncements(sb, groupId),
  announcementsCreate: (groupId: string, input: Parameters<typeof teamOpsCore.createAnnouncement>[2]) => teamOpsCore.createAnnouncement(sb, groupId, input),
  announcementsSetPinned: (id: string, pinned: boolean) => teamOpsCore.setAnnouncementPinned(sb, id, pinned),
  announcementsDelete: (id: string) => teamOpsCore.deleteAnnouncement(sb, id),
  tasksList: (groupId: string) => teamOpsCore.listTasks(sb, groupId),
  tasksCreate: (groupId: string, input: Parameters<typeof teamOpsCore.createTask>[2]) => teamOpsCore.createTask(sb, groupId, input),
  tasksSetStatus: (id: string, status: 'open' | 'done') => teamOpsCore.setTaskStatus(sb, id, status),
  tasksDelete: (id: string) => teamOpsCore.deleteTask(sb, id),
  staffNotesList: (groupId: string, playerId: string) => teamOpsCore.listStaffNotes(sb, groupId, playerId),
  staffNotesAdd: (groupId: string, playerId: string, body: string) => teamOpsCore.addStaffNote(sb, groupId, playerId, body),
  staffNotesDelete: (id: string) => teamOpsCore.deleteStaffNote(sb, id),

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

  // ── E1: shared team workspace (read-only on the web for now) ──
  teamGetShared: (groupId: string) => team.getSharedTeam(sb, groupId),

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
