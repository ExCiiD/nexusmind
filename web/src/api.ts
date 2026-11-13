import * as core from '@/lib/collabCore'
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

function toUser(u: { id: string; email?: string | null; is_anonymous?: boolean } | null | undefined): CloudUser | null {
  if (!u || u.is_anonymous) return null
  return { id: u.id, email: u.email ?? null }
}

function authError(message: string | undefined): Error {
  const m = (message ?? '').toLowerCase()
  if (m.includes('rate limit') || m.includes('security purposes')) return new Error('AUTH_RATE_LIMITED')
  if (m.includes('expired') || m.includes('invalid')) return new Error('AUTH_INVALID_CODE')
  return new Error(message || 'AUTH_FAILED')
}

/** On the web there is no local Riot profile: show the e-mail's name part. */
async function webIdentity(): Promise<core.MemberIdentity> {
  const { data } = await sb.auth.getUser()
  const email = data.user?.email ?? ''
  return { displayName: email ? email.split('@')[0].slice(0, 64) : null, riotId: null }
}

export const webApi = {
  // ── account ──
  async cloudStatus(): Promise<CloudStatus> {
    if (!supabaseConfigured) return { configured: false, user: null, riotMode: 'none', lastBackupAt: null }
    const { data } = await sb.auth.getSession()
    return { configured: true, user: toUser(data.session?.user), riotMode: 'none', lastBackupAt: null }
  },
  async cloudSendCode(email: string) {
    const address = email.trim().toLowerCase()
    if (!EMAIL.test(address)) throw new Error('Invalid input for cloud:send-code')
    const { error } = await sb.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } })
    if (error) throw authError(error.message)
    return { sent: true }
  },
  async cloudVerifyCode(email: string, code: string) {
    if (!/^\d{6,10}$/.test(code.trim())) throw new Error('invalid code')
    const { data, error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' })
    if (error) throw authError(error.message)
    return toUser(data.session?.user)
  },
  async cloudSignOut() {
    await sb.auth.signOut()
    return { signedOut: true }
  },
  onCloudAuthChanged(cb: (user: CloudUser | null) => void) {
    const { data } = sb.auth.onAuthStateChange((_e, session) => cb(toUser(session?.user)))
    return () => data.subscription.unsubscribe()
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
  ;(window as unknown as { api: typeof webApi }).api = webApi
}
