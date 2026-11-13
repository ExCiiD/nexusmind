import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AssignedObjective,
  Group,
  GroupKind,
  GroupRole,
  GroupSharing,
  PlayerSessionView,
  ReviewComment,
} from './collab'

/**
 * Collaboration data access, shared by the desktop main process and the web
 * app. Pure: every function takes the signed-in Supabase client and the
 * caller's user id. Access control is entirely in Postgres RLS.
 */

export interface MemberIdentity {
  displayName: string | null
  riotId: string | null
}

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/invalid or expired invite/i.test(msg)) throw new Error('INVITE_INVALID')
  if (/forbidden|only the owner/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  if (/too many groups/i.test(msg)) throw new Error('TOO_MANY_GROUPS')
  throw new Error(msg)
}

const parseJson = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return (v as T) ?? fallback
  try { return JSON.parse(v) as T } catch { return fallback }
}

// ── Groups ──────────────────────────────────────────────────────────────────

export async function listMyGroups(sb: SupabaseClient, uid: string): Promise<Group[]> {
  const { data: memberships, error } = await sb.from('group_members').select('group_id, role').eq('user_id', uid)
  if (error) fail(error, 'list groups failed')
  const ids = (memberships ?? []).map((m) => m.group_id)
  if (ids.length === 0) return []

  const [groups, members, sharing] = await Promise.all([
    sb.from('groups').select('id, name, kind').in('id', ids),
    sb.from('group_members').select('group_id, user_id, role, display_name, riot_id, joined_at').in('group_id', ids),
    sb.from('group_sharing').select('group_id, share_reviews, share_stats, share_team').eq('user_id', uid).in('group_id', ids),
  ])
  if (groups.error) fail(groups.error, 'list groups failed')
  if (members.error) fail(members.error, 'list members failed')

  return (groups.data ?? []).map((g) => {
    const share = sharing.data?.find((s) => s.group_id === g.id)
    return {
      id: g.id,
      name: g.name,
      kind: g.kind as GroupKind,
      myRole: memberships!.find((m) => m.group_id === g.id)!.role as GroupRole,
      members: (members.data ?? [])
        .filter((m) => m.group_id === g.id)
        .map((m) => ({ userId: m.user_id, role: m.role as GroupRole, displayName: m.display_name, riotId: m.riot_id, joinedAt: m.joined_at })),
      sharing: {
        shareReviews: share?.share_reviews ?? true,
        shareStats: share?.share_stats ?? true,
        shareTeam: share?.share_team ?? true,
      },
    }
  })
}

export async function updateMyMemberProfile(sb: SupabaseClient, uid: string, groupId: string, id: MemberIdentity): Promise<void> {
  await sb.from('group_members').update({ display_name: id.displayName, riot_id: id.riotId }).eq('group_id', groupId).eq('user_id', uid)
}

export async function createGroup(sb: SupabaseClient, name: string, kind: GroupKind): Promise<string> {
  const { data, error } = await sb.rpc('create_group', { p_name: name, p_kind: kind })
  if (error) fail(error, 'create group failed')
  return data as string
}

export async function createInvite(sb: SupabaseClient, groupId: string, role: Exclude<GroupRole, 'owner'>, days: number): Promise<string> {
  const { data, error } = await sb.rpc('create_group_invite', { p_group: groupId, p_role: role, p_days: days, p_max_uses: 10 })
  if (error) fail(error, 'invite failed')
  return data as string
}

export async function joinGroup(sb: SupabaseClient, code: string, id: MemberIdentity): Promise<string> {
  const { data, error } = await sb.rpc('join_group', { p_code: code, p_display_name: id.displayName, p_riot_id: id.riotId })
  if (error) fail(error, 'join failed')
  return data as string
}

export async function leaveGroup(sb: SupabaseClient, uid: string, groupId: string): Promise<void> {
  const { error } = await sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', uid)
  if (error) fail(error, 'leave failed')
}

export async function deleteGroup(sb: SupabaseClient, groupId: string): Promise<void> {
  const { error } = await sb.from('groups').delete().eq('id', groupId)
  if (error) fail(error, 'delete failed')
}

export async function removeMember(sb: SupabaseClient, groupId: string, userId: string): Promise<void> {
  const { error } = await sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId)
  if (error) fail(error, 'remove failed')
}

export async function setSharing(sb: SupabaseClient, uid: string, groupId: string, s: GroupSharing): Promise<void> {
  const { error } = await sb.from('group_sharing').upsert({
    group_id: groupId, user_id: uid, share_reviews: s.shareReviews, share_stats: s.shareStats, share_team: s.shareTeam,
  })
  if (error) fail(error, 'sharing update failed')
}

// ── A player's synced sessions (own data, or shared with my group) ─────────

export async function getPlayerSessions(sb: SupabaseClient, playerId: string, limit = 30): Promise<PlayerSessionView[]> {
  const { data, error } = await sb.from('sync_records')
    .select('table_name, record_id, data')
    .eq('user_id', playerId)
    .eq('deleted', false)
    .in('table_name', ['Session', 'Game', 'Review'])
    .limit(5000)
  if (error) fail(error, 'load player data failed')

  const rows = data ?? []
  const reviewsByGame = new Map<string, any>()
  for (const r of rows.filter((x) => x.table_name === 'Review')) reviewsByGame.set((r.data as any).gameId, r.data)
  const gamesBySession = new Map<string, any[]>()
  for (const g of rows.filter((x) => x.table_name === 'Game')) {
    const d = g.data as any
    const list = gamesBySession.get(d.sessionId) ?? []
    list.push(d)
    gamesBySession.set(d.sessionId, list)
  }

  const ts = (v: unknown) => (typeof v === 'number' ? v : Date.parse(String(v ?? '')) || 0)
  return rows
    .filter((x) => x.table_name === 'Session')
    .map((s) => {
      const d = s.data as any
      const games = (gamesBySession.get(d.id) ?? []).sort((a, b) => ts(b.gameEndAt) - ts(a.gameEndAt))
      return {
        id: d.id,
        date: d.date ?? null,
        objectiveIds: parseJson<string[]>(d.objectiveIds, d.objectiveId ? [d.objectiveId] : []),
        status: d.status ?? null,
        sessionConclusion: d.sessionConclusion ?? null,
        games: games.map((g) => {
          const rv = reviewsByGame.get(g.id)
          return {
            id: g.id, matchId: g.matchId, champion: g.champion, role: g.role ?? null, win: !!g.win,
            kills: g.kills, deaths: g.deaths, assists: g.assists, gameEndAt: g.gameEndAt ?? null,
            review: rv
              ? {
                  id: rv.id,
                  freeText: rv.freeText ?? null,
                  kpiScores: parseJson<Record<string, number>>(rv.kpiScores, {}),
                  timelineNotes: parseJson<Array<{ time: string; note: string }>>(rv.timelineNotes, []),
                  objectiveRespected: rv.objectiveRespected ?? null,
                }
              : null,
          }
        }),
      }
    })
    .sort((a, b) => ts(b.date) - ts(a.date))
    .slice(0, limit)
}

// ── Comments ────────────────────────────────────────────────────────────────

const mapComment = (c: any): ReviewComment => ({
  id: c.id, groupId: c.group_id, playerId: c.player_id, reviewId: c.review_id, gameId: c.game_id,
  authorId: c.author_id, parentId: c.parent_id, videoTimeSec: c.video_time_sec, body: c.body,
  resolved: c.resolved, createdAt: c.created_at,
})

export async function listComments(sb: SupabaseClient, ownerId: string, reviewId: string): Promise<ReviewComment[]> {
  const { data, error } = await sb.from('review_comments')
    .select('*').eq('player_id', ownerId).eq('review_id', reviewId).order('created_at', { ascending: true })
  if (error) fail(error, 'load comments failed')
  return (data ?? []).map(mapComment)
}

/** Unresolved comments from others on my reviews (player inbox). */
export async function listMyOpenComments(sb: SupabaseClient, uid: string): Promise<ReviewComment[]> {
  const { data, error } = await sb.from('review_comments')
    .select('*').eq('player_id', uid).eq('resolved', false).neq('author_id', uid)
    .order('created_at', { ascending: false }).limit(100)
  if (error) fail(error, 'load comments failed')
  return (data ?? []).map(mapComment)
}

export async function addComment(sb: SupabaseClient, uid: string, c: {
  groupId: string; playerId?: string; reviewId: string; gameId?: string | null
  parentId?: string | null; videoTimeSec?: number | null; body: string
}): Promise<ReviewComment> {
  const { data, error } = await sb.from('review_comments').insert({
    group_id: c.groupId, player_id: c.playerId ?? uid, review_id: c.reviewId, game_id: c.gameId ?? null,
    author_id: uid, parent_id: c.parentId ?? null, video_time_sec: c.videoTimeSec ?? null, body: c.body.trim(),
  }).select('*').single()
  if (error) fail(error, 'comment failed')
  return mapComment(data)
}

export async function setCommentResolved(sb: SupabaseClient, id: string, resolved: boolean): Promise<void> {
  const { error } = await sb.from('review_comments').update({ resolved }).eq('id', id)
  if (error) fail(error, 'update failed')
}

export async function deleteComment(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('review_comments').delete().eq('id', id)
  if (error) fail(error, 'delete failed')
}

// ── Assigned objectives ─────────────────────────────────────────────────────

const mapAssignment = (a: any): AssignedObjective => ({
  id: a.id, groupId: a.group_id, playerId: a.player_id, assignedBy: a.assigned_by,
  objectiveIds: a.objective_ids ?? [], kpiIds: a.kpi_ids ?? [], note: a.note, dueDate: a.due_date,
  status: a.status, createdAt: a.created_at,
})

export async function listAssignments(sb: SupabaseClient, ownerId: string, onlyOpen = true): Promise<AssignedObjective[]> {
  let q = sb.from('assigned_objectives').select('*').eq('player_id', ownerId).order('created_at', { ascending: false }).limit(50)
  if (onlyOpen) q = q.eq('status', 'open')
  const { data, error } = await q
  if (error) fail(error, 'load assignments failed')
  return (data ?? []).map(mapAssignment)
}

export async function assignObjective(sb: SupabaseClient, uid: string, a: {
  groupId: string; playerId: string; objectiveIds: string[]; kpiIds?: string[]; note?: string | null; dueDate?: string | null
}): Promise<AssignedObjective> {
  const { data, error } = await sb.from('assigned_objectives').insert({
    group_id: a.groupId, player_id: a.playerId, assigned_by: uid, objective_ids: a.objectiveIds,
    kpi_ids: a.kpiIds ?? [], note: a.note ?? null, due_date: a.dueDate ?? null,
  }).select('*').single()
  if (error) fail(error, 'assign failed')
  return mapAssignment(data)
}

export async function setAssignmentStatus(sb: SupabaseClient, id: string, status: AssignedObjective['status']): Promise<void> {
  const { error } = await sb.from('assigned_objectives').update({ status }).eq('id', id)
  if (error) fail(error, 'update failed')
}
