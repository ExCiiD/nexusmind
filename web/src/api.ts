import * as core from '@/lib/collabCore'
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
  collabSetSharing: async (groupId: string, s: { shareReviews: boolean; shareStats: boolean; shareTeam: boolean }) =>
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
