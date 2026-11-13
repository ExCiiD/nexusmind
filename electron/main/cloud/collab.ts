import { getSupabase, getAccessToken } from './supabase'
import { getPrisma } from '../database'
import * as core from '../../../src/lib/collabCore'
import type { AssignedObjective, GroupKind, GroupRole, GroupSharing } from '../../../src/lib/collab'

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
