import * as core from '@/lib/collabCore'
import * as notifications from '@/lib/notificationsCore'
import * as team from '@/lib/teamCore'
import { scoutMemberWeb, autoFillPoolWeb } from './scoutingWeb'
import { computeCombinedStatsWeb, computeCustomStatsWeb, computeTeamSynergyStatsWeb, listCustomGamesWeb } from './teamStatsWeb'
import { analystWebApi } from './analystWeb'
import { cardChampionWebApi } from './cardChampionWeb'
import { teamSessionHistoryWebApi } from './teamSessionHistoryWeb'
import { sessionPrepWebApi } from './sessionPrepWeb'
import { myTeamWebApi } from './myTeamWeb'
import { organisationWebApi } from './organisationWeb'
import { realtimeWebApi } from './realtimeWeb'
import * as matchEvents from '@/lib/matchEventCore'
import * as dashboardCore from '@/lib/staffDashboardCore'
import * as devPlanCore from '@/lib/devPlanCore'
import * as calendarCore from '@/lib/calendarCore'
import * as vodReviewCore from '@/lib/vodReviewCore'
import * as microReviewCloud from '@/lib/microReviewCloudCore'
import { builtInTagsAsRows } from '@/lib/mistakeTagCatalog'
import type { MicroVerdictInput, TeamCodexRuleInput } from '@/lib/microReview/types'
import * as wellbeingCore from '@/lib/wellbeingCore'
import * as teamOpsCore from '@/lib/teamOpsCore'
import * as announcementsCore from '@/lib/announcementsCore'
import * as teamSessionsCore from '@/lib/teamSessionsCore'
import type { TeamSession } from '@/lib/teamSessions'
import * as teamSessionReviewsCore from '@/lib/teamSessionReviewsCore'
import { getMatch as getMatchWeb, getAccountByRiotId as getAccountWeb } from './riotWeb'
import { checkRiotAccount } from '@/lib/riotAccountCheck'
import * as reportCore from '@/lib/reportCore'
import * as trialsCore from '@/lib/trialsCore'
import * as scrimsReadCore from '@/lib/scrimsCore'
import * as discussionCore from '@/lib/discussionCore'
import * as access from '@/lib/accessCore'
import { sendFeedback, listMyFeedback, type FeedbackInput } from '@/lib/feedback'
import type { CloudStatus, CloudUser } from '@/lib/ipc'
import type { GroupLogoImage } from '@/lib/collab'
import { sb, currentUserId, supabaseConfigured, supabaseUrl, supabaseAnonKey, WEB_AUTH_STORAGE_KEY } from './supabase'

/** Screens to tell when a sign-out could only be done locally (see cloudSignOut). */
const localSignOutListeners = new Set<(user: CloudUser | null) => void>()
/** The pending server logout of the last offline sign-out, if any. */
let revokeRetry: { stop: () => void } | null = null

// ── The web's single live-session poller (item I, 19/11/2026) ───────────────
// Same contract as the desktop (teamSessionLiveCached / onTeamSessionLive): one shared poll for every screen, run
// only while someone listens, on livePollDelay's cadence (slower while the tab is hidden).
const live: {
  list: TeamSession[] | null
  key: string
  listeners: Set<(sessions: TeamSession[]) => void>
  timer: ReturnType<typeof setTimeout> | null
} = { list: null, key: '', listeners: new Set(), timer: null }

async function refreshLiveWeb(): Promise<TeamSession[]> {
  try {
    const uid = await currentUserId().catch(() => null)
    const list = uid ? await teamSessionsCore.listMyLiveSessions(sb) : []
    live.list = list
    const key = teamSessionsCore.liveSessionsKey(list)
    if (key !== live.key) {
      live.key = key
      for (const cb of live.listeners) cb(list)
    }
  } catch { /* keep the previous list; the next tick retries */ }
  return live.list ?? []
}

function scheduleLiveWeb(): void {
  if (live.timer || live.listeners.size === 0) return
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
  // Scalability lot 1: nothing while the tab is hidden; back to the tab refreshes and restarts (listener below).
  if (!visible) return
  live.timer = setTimeout(async () => {
    live.timer = null
    await refreshLiveWeb()
    scheduleLiveWeb()
  }, teamSessionsCore.livePollDelay(visible, (live.list?.length ?? 0) > 0))
}

if (typeof document !== 'undefined') {
  // Back to the tab: refresh now instead of waiting out the hidden-tab delay.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || live.listeners.size === 0) return
    if (live.timer) { clearTimeout(live.timer); live.timer = null }
    void refreshLiveWeb().then(scheduleLiveWeb)
  })
}

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
  // The local session (no /auth/v1/user request, L15).
  const { data } = await sb.auth.getSession()
  const email = data.session?.user?.email ?? ''
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
  // #40 analyst screens (Objectifs, Journal des drafts, Dossier adverse): analystCore with the web Riot client.
  ...analystWebApi,
  // Team Lobby cards: the champion and skin each member shows (members' looks, my choice, hosted skins).
  ...cardChampionWebApi,
  // Team sessions history (§ 15): list, detail, objective verdicts (teamSessionHistoryCore).
  ...teamSessionHistoryWebApi,
  // § 17: preparing a session ahead (each player's objectives, drafts, message).
  ...sessionPrepWebApi,
  // § 18.5: what the team gives a player (next event, open tasks, session objectives, VOD actions).
  ...myTeamWebApi,
  // § 18: « Relancer », the published opponent dossiers.
  ...organisationWebApi,
  // Realtime instead of polling (docs/contracts/realtime.md): onCloudRealtime, its status.
  ...realtimeWebApi,
  /** Invite code from an invite link, for the sign-in screen. */
  pendingInviteCode: (): string | null => pendingInvite,
  // ── account ──
  async cloudStatus(): Promise<CloudStatus> {
    if (!supabaseConfigured) return { configured: false, user: null, riotMode: 'none', lastBackupAt: null }
    await pendingHandoff
    // AUTH_UNREACHABLE when the auth server could not be reached (not "signed out").
    const session = await access.sessionForStatus(sb)
    return { configured: true, user: toUser(session?.user), riotMode: 'none', lastBackupAt: null }
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
    // The local session, refreshed by setPassword's updateUser (no /auth/v1/user request, L15).
    const { data } = await sb.auth.getSession()
    return toUser(data.session?.user ?? null)
  },
  async cloudSignOut() {
    // This browser only. When the server cannot be reached, forget the
    // session here anyway and tell the screens (no SIGNED_OUT event then).
    const res = await access.signOutThisDevice(sb, () => {
      try {
        window.localStorage.removeItem(WEB_AUTH_STORAGE_KEY)
        window.localStorage.removeItem(`${WEB_AUTH_STORAGE_KEY}-code-verifier`)
      } catch { /* storage blocked: nothing was persisted */ }
      for (const cb of localSignOutListeners) cb(null)
    })
    // R3: send the missed logout again (every minute, and as soon as the
    // browser is back online) while the old access token is valid. Lost if
    // the tab is closed first: the session then stays open on the server.
    if (res.pendingRevoke) {
      const pending = res.pendingRevoke
      revokeRetry?.stop()
      const retry = access.scheduleRevokeRetry(() => access.retryRevoke(supabaseUrl, supabaseAnonKey, pending))
      const onOnline = () => retry.trigger()
      window.addEventListener('online', onOnline)
      revokeRetry = { stop: () => { retry.stop(); window.removeEventListener('online', onOnline) } }
    }
    return { signedOut: true }
  },
  /** Every device and the web (scope global). Throws when the server could not be reached. */
  async cloudSignOutEverywhere() {
    const { error } = await sb.auth.signOut({ scope: 'global' })
    if (error) throw new Error(access.authErrorCode(error.message))
    return { signedOut: true }
  },
  onCloudAuthChanged(cb: (user: CloudUser | null) => void) {
    const { data } = sb.auth.onAuthStateChange((_e, session) => cb(toUser(session?.user)))
    localSignOutListeners.add(cb)
    return () => { data.subscription.unsubscribe(); localSignOutListeners.delete(cb) }
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
  // Perf gain 4: status and groups in one call (the same reads as cloudStatus and collabListGroups).
  async collabBootstrap() {
    const status = await webApi.cloudStatus()
    const groups = status.user ? await core.listMyGroups(sb, status.user.id).catch(() => null) : []
    return { status, groups }
  },
  async collabCreateGroup(name: string, kind: 'team' | 'coaching') {
    const id = await core.createGroup(sb, name.trim(), kind)
    await core.updateMyMemberProfile(sb, await currentUserId(), id, await webIdentity()).catch(() => {})
    return id
  },
  collabCreateInvite: (groupId: string, role: 'coach' | 'manager' | 'analyst' | 'player', days: number) => core.createInvite(sb, groupId, role, days),
  collabJoin: async (code: string, riotId?: string | null) => {
    const id = await core.joinGroup(sb, code.trim().toUpperCase(), { ...(await webIdentity()), riotId: riotId ?? null })
    // My card's champion and skin follow me into the new group (same as the desktop).
    const uid = await currentUserId().catch(() => null)
    if (uid) await core.spreadMyCardChampion(sb, uid)
    return id
  },
  collabLeave: async (groupId: string) => core.leaveGroup(sb, await currentUserId(), groupId),
  collabSetMemberRole: (groupId: string, userId: string, role: Parameters<typeof core.setMemberRole>[3]) => core.setMemberRole(sb, groupId, userId, role),
  // #39: staff roles on top of the main role (owner only, set_member_staff_roles).
  collabSetMemberStaffRoles: (groupId: string, userId: string, roles: Parameters<typeof core.setMemberStaffRoles>[3]) =>
    core.setMemberStaffRoles(sb, groupId, userId, roles),
  // #48: the owner can also be one of the group's players.
  collabSetMyAlsoPlays: (groupId: string, plays: boolean) => core.setMyAlsoPlays(sb, groupId, plays),
  collabDeleteGroup: (groupId: string) => core.deleteGroup(sb, groupId),
  collabRemoveMember: (groupId: string, userId: string) => core.removeMember(sb, groupId, userId),
  collabSetCaptain: (groupId: string, userId: string, isCaptain: boolean) => core.setCaptain(sb, groupId, userId, isCaptain),

  teamSessionGetByEvent: (calendarEventId: string) => teamSessionsCore.getSessionByEvent(sb, calendarEventId),
  teamSessionStart: (id: string, responsibleUserIds: string[], queueFilter: Parameters<typeof teamSessionsCore.startSession>[3]) =>
    teamSessionsCore.startSession(sb, id, responsibleUserIds, queueFilter),
  teamSessionEnd: (id: string) => teamSessionsCore.endSession(sb, id),
  teamSessionGetObjectives: (sessionId: string) => teamSessionsCore.getObjectives(sb, sessionId),
  teamSessionSetObjectives: (sessionId: string, objectiveIds: string[], kpiIds: string[]) => currentUserId().then((uid) => teamSessionsCore.setObjectives(sb, uid, sessionId, objectiveIds, kpiIds)),
  teamSessionGetAttendance: (sessionId: string) => teamSessionsCore.getAttendance(sb, sessionId),
  teamSessionSetAttendance: (sessionId: string, userId: string, present: boolean | null) => teamSessionsCore.setAttendance(sb, sessionId, userId, present),
  teamSessionListMyLive: () => teamSessionsCore.listMyLiveSessions(sb),
  teamSessionLiveCached: () => (live.list ? Promise.resolve(live.list) : refreshLiveWeb()),
  onTeamSessionLive(cb: (sessions: TeamSession[]) => void) {
    live.listeners.add(cb)
    if (live.list) cb(live.list)
    else void refreshLiveWeb()
    scheduleLiveWeb()
    return () => {
      live.listeners.delete(cb)
      if (live.listeners.size === 0 && live.timer) { clearTimeout(live.timer); live.timer = null }
    }
  },
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
  teamSessionReviewCreate: (sessionId: string, gameId: string | null, scope: Parameters<typeof teamSessionReviewsCore.createReview>[4], status: Parameters<typeof teamSessionReviewsCore.createReview>[5]) =>
    currentUserId().then((uid) => teamSessionReviewsCore.createReview(sb, uid, sessionId, gameId, scope, status)),
  teamSessionReviewUpdate: (id: string, patch: Parameters<typeof teamSessionReviewsCore.updateReview>[2]) => teamSessionReviewsCore.updateReview(sb, id, patch),
  teamSessionPendingFinalReviews: async () => teamSessionReviewsCore.listPendingFinalReviews(sb, await currentUserId().catch(() => null)),
  teamSessionFeedbackList: (sessionId: string) => teamSessionReviewsCore.listFeedbackForSession(sb, sessionId),
  teamSessionFeedbackSubmit: (sessionId: string, body: string, transcript?: string | null) => currentUserId().then((uid) => teamSessionReviewsCore.submitFeedback(sb, uid, sessionId, body, transcript ?? null)),
  collabSetSharing: async (groupId: string, s: { shareReviews: boolean; shareStats: boolean; shareTeam: boolean; shareWellbeing: boolean }) =>
    core.setSharing(sb, await currentUserId(), groupId, s),
  /** Same as the desktop (electron/main/cloud/collab.ts): the previous file is removed after the new one is set.
   *  Was missing on the web (#18): the logo picker failed there. */
  async collabSetGroupLogo(groupId: string, image: GroupLogoImage | null) {
    const prev = await sb.from('groups').select('logo_url').eq('id', groupId).maybeSingle()
    return core.setGroupLogo(sb, groupId, image, (prev.data as { logo_url?: string | null } | null)?.logo_url ?? null)
  },
  /** #34: the group's owner, coach or manager unlink its Discord server (checked server side). */
  discordUnlinkGuild: (groupId: string) => core.unlinkGroupDiscord(sb, groupId),
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
  devPlanAddAxis: (planId: string, axis: Parameters<typeof devPlanCore.addAxis>[2]) => devPlanCore.addAxis(sb, planId, axis),
  devPlanDeleteAxis: (axisId: string) => devPlanCore.deleteAxis(sb, axisId),

  // ── E4: planning & presence ──
  calendarListEvents: (groupId: string, fromISO: string, toISO: string) => calendarCore.listEvents(sb, groupId, fromISO, toISO),
  calendarGetEvent: (id: string) => calendarCore.getEvent(sb, id),
  calendarCreateEvent: (groupId: string, input: Parameters<typeof calendarCore.createEvent>[2]) => calendarCore.createEvent(sb, groupId, input),
  calendarUpdateEvent: (id: string, input: Parameters<typeof calendarCore.updateEvent>[2]) => calendarCore.updateEvent(sb, id, input),
  calendarDeleteEvent: (id: string) => calendarCore.deleteEvent(sb, id),
  calendarRespond: (eventId: string, status: Parameters<typeof calendarCore.respondToEvent>[2], note?: string | null) =>
    calendarCore.respondToEvent(sb, eventId, status, note ?? null),
  // #49 scrims in the Planning (docs/CONTRAT_SCRIMS_PLANNING.md).
  calendarSaveMatchEvent: (groupId: string, event: Parameters<typeof matchEvents.saveMatchEvent>[2], match: Parameters<typeof matchEvents.saveMatchEvent>[3]) =>
    matchEvents.saveMatchEvent(sb, groupId, event, match),
  calendarGetMatchEvent: (calendarEventId: string) => matchEvents.getMatchEvent(sb, calendarEventId),
  calendarUpdateMatchDetail: (scrimId: string, patch: Parameters<typeof matchEvents.updateMatchDetail>[2]) => matchEvents.updateMatchDetail(sb, scrimId, patch),
  calendarListKnownOpponents: (groupId: string) => matchEvents.listKnownOpponents(sb, groupId),
  // Interactive priority (not BACKGROUND): the user is waiting on the « ✓ trouvé / Introuvable » next to the field.
  riotAccountExists: (riotId: string, region: string) =>
    checkRiotAccount((gameName, tagLine, r) => getAccountWeb(gameName, tagLine, r), riotId, region),
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
  // Micro-review, coach side (docs/PLAN_MICRO_REVIEW.md)
  microReviewCloudPlayerAnswers: (playerId: string) => microReviewCloud.listPlayerAnswers(sb, playerId),
  microReviewCloudMyVerdicts: async () => microReviewCloud.listMyReviewedAnswers(sb, await currentUserId()),
  microReviewCloudSetVerdict: async (input: MicroVerdictInput) => microReviewCloud.setVerdict(sb, await currentUserId(), input),
  teamCodexList: (groupIds: string[]) => microReviewCloud.listTeamCodex(sb, groupIds),
  teamCodexAdd: (input: TeamCodexRuleInput) => microReviewCloud.addTeamCodexRule(sb, input),
  teamCodexDelete: (id: string) => microReviewCloud.deleteTeamCodexRule(sb, id),
  // No local database on the web: the built-in catalog (the coach corrects with built-in tags).
  listMistakeTags: async () => builtInTagsAsRows(),
  // Local session history only exists on desktop: the team-session objective
  // picker (FundamentalPickerDialog) then simply shows no history.
  getKpiHistory: async () => [],
  getCoachingPatterns: async () => null,
  vodReviewCreateSession: (groupId: string, input: Parameters<typeof vodReviewCore.createSession>[2]) => vodReviewCore.createSession(sb, groupId, input),
  vodReviewDeleteSession: (id: string) => vodReviewCore.deleteSession(sb, id),
  vodReviewAddComment: (sessionId: string, input: Parameters<typeof vodReviewCore.addComment>[2]) => vodReviewCore.addComment(sb, sessionId, input),
  vodReviewDeleteComment: (id: string) => vodReviewCore.deleteComment(sb, id),
  vodReviewAddActionItem: (sessionId: string, text: string) => vodReviewCore.addActionItem(sb, sessionId, text),
  vodReviewSetActionItemDone: (id: string, done: boolean) => currentUserId().then((uid) => vodReviewCore.setActionItemDone(sb, uid, id, done)),
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
  wellbeingConsentGet: async () => wellbeingCore.getConsent(sb, await currentUserId()),
  wellbeingConsentSet: async (granted: boolean, version: 'v0.3') => wellbeingCore.setConsent(sb, await currentUserId(), granted, version),

  // ── E7: communication & tasks ──
  announcementsList: (groupId: string) => announcementsCore.listAnnouncements(sb, groupId),
  announcementsCreate: (groupId: string, input: Parameters<typeof announcementsCore.createAnnouncement>[2]) => announcementsCore.createAnnouncement(sb, groupId, input),
  announcementsSetPinned: (id: string, pinned: boolean) => announcementsCore.setAnnouncementPinned(sb, id, pinned),
  announcementsDelete: (id: string) => announcementsCore.deleteAnnouncement(sb, id),
  announcementsListMyDismissals: () => announcementsCore.listMyDismissals(sb),
  announcementsDismiss: (announcementId: string) => currentUserId().then((uid) => announcementsCore.dismissAnnouncement(sb, uid, announcementId)),
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
  reportGetForPeriod: (groupId: string, from: string, to: string) => reportCore.computeTeamPeriodReport(sb, groupId, from, to),
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
  // #46: the staff link a published roster row to a member, or unlink it (null).
  teamLinkRosterMember: (rosterId: string, userId: string | null) => team.linkRosterMember(sb, rosterId, userId),

  // ── E14: full Team page on the web (roster/pool/draft/scouting) ──
  // Called by the real desktop tab components (RosterTab/ChampPoolTab/
  // DraftTab/ScoutingTab, src/pages/Team/*.tsx) via the web Team page
  // (web/src/pages/TeamPage.tsx), which calls teamSetActiveGroup first.
  teamSetActiveGroup(groupId: string | null) { activeGroupId = groupId },
  // Cloud opponents are always group-scoped (team_scouting.group_id): an
  // explicit `groupId` (#7, same contract as the desktop) wins over the
  // active group; `includeUnassigned` has nothing to add on the web.
  listTeams: (opts?: { isOpponent?: boolean; groupId?: string; includeUnassigned?: boolean }) =>
    team.listGroupTeams(sb, opts?.groupId ?? requireActiveGroup(), { isOpponent: opts?.isOpponent }),
  // #41b Stats collectives: same Core as the desktop handlers, Riot through the proxy with caching (teamStatsWeb.ts).
  // Custom games are read only here: importing and deleting stay on the desktop.
  computeTeamSynergyStats: (teamId: string, opts?: { matchesPerMember?: number; minTogether?: number }) =>
    computeTeamSynergyStatsWeb(requireActiveGroup(), teamId, opts),
  computeCombinedStats: (teamId: string, opts?: { minTogether?: number }) =>
    computeCombinedStatsWeb(requireActiveGroup(), teamId, opts),
  computeCustomStats: (teamId: string, gameType: 'scrim' | 'tournament' | 'all') =>
    computeCustomStatsWeb(requireActiveGroup(), teamId, gameType),
  listCustomGames: (teamId: string, gameType?: 'scrim' | 'tournament') =>
    listCustomGamesWeb(requireActiveGroup(), teamId, gameType),
  async createTeam(data: { name: string; tag?: string; notes?: string; isOpponent?: boolean; groupId?: string }) {
    const groupId = data.groupId ?? requireActiveGroup()
    if (!data.isOpponent) {
      // The group's own roster always exists implicitly — nothing to
      // create. Not actually reachable from the web Team page (it never
      // shows a "create team" prompt for the own roster), kept defensive.
      return (await team.listGroupTeams(sb, groupId, { isOpponent: false }))[0]
    }
    return team.createOpponentTeam(sb, groupId, { name: data.name, tag: data.tag ?? null, notes: data.notes ?? null })
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
