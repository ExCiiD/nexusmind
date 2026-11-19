import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AssignedObjective,
  Group,
  GroupKind,
  GroupLogoImage,
  GroupRole,
  GroupSharing,
  MemberLook,
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
    selectGroups(sb, ids),
    sb.from('group_members').select('group_id, user_id, role, is_captain, display_name, riot_id, joined_at').in('group_id', ids),
    sb.from('group_sharing').select('group_id, share_reviews, share_stats, share_team, share_wellbeing').eq('user_id', uid).in('group_id', ids),
  ])
  if (groups.error) fail(groups.error, 'list groups failed')
  if (members.error) fail(members.error, 'list members failed')

  return (groups.data ?? []).map((g) => {
    const share = sharing.data?.find((s) => s.group_id === g.id)
    return {
      id: g.id,
      name: g.name,
      kind: g.kind as GroupKind,
      logoUrl: g.logo_url ?? null,
      myRole: memberships!.find((m) => m.group_id === g.id)!.role as GroupRole,
      members: (members.data ?? [])
        .filter((m) => m.group_id === g.id)
        .map((m) => ({ userId: m.user_id, role: m.role as GroupRole, isCaptain: !!m.is_captain, displayName: m.display_name, riotId: m.riot_id, joinedAt: m.joined_at })),
      sharing: {
        shareReviews: share?.share_reviews ?? true,
        shareStats: share?.share_stats ?? true,
        shareTeam: share?.share_team ?? true,
        shareWellbeing: share?.share_wellbeing ?? false,
      },
    }
  })
}

type GroupRow = { id: string; name: string; kind: string; logo_url?: string | null }

/** The groups' rows, with their logo once the group_logos migration is in
 *  (before it the column is missing: list them without). */
async function selectGroups(sb: SupabaseClient, ids: string[]): Promise<{ data: GroupRow[] | null; error: { message: string; code?: string } | null }> {
  const withLogo = await sb.from('groups').select('id, name, kind, logo_url').in('id', ids)
  if (withLogo.error?.code === '42703') return sb.from('groups').select('id, name, kind').in('id', ids)
  return withLogo
}

// ── Team logos (Coaching → Groupes, player cards) ───────────────────────────
// A group's logo is a file of its folder in the public group-logos bucket
// (`<group id>/logo-<time>.<ext>`), pointed at by groups.logo_url through
// set_group_logo (management only, see 20261119010000_group_logos.sql).

export const GROUP_LOGO_BUCKET = 'group-logos'
export const GROUP_LOGO_MAX_BYTES = 512 * 1024
const LOGO_EXT: Record<GroupLogoImage['contentType'], string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }

/** The bucket path of a logo URL, when it is a file of this group's folder. */
export function logoPathOf(url: string | null | undefined, groupId: string): string | null {
  if (!url) return null
  const marker = `/storage/v1/object/public/${GROUP_LOGO_BUCKET}/`
  const i = url.indexOf(marker)
  if (i < 0) return null
  const path = url.slice(i + marker.length).split(/[?#]/)[0]
  return path.startsWith(`${groupId}/`) && !path.includes('..') ? path : null
}

/**
 * Uploads a new logo (or none) and points the group at it; the previous file
 * is then removed, best effort. Returns the new logo's URL.
 */
export async function setGroupLogo(sb: SupabaseClient, groupId: string, image: GroupLogoImage | null, previousUrl?: string | null): Promise<string | null> {
  let url: string | null = null
  if (image) {
    if (image.bytes.byteLength === 0 || image.bytes.byteLength > GROUP_LOGO_MAX_BYTES) throw new Error('logo too large')
    const path = `${groupId}/logo-${Date.now()}.${LOGO_EXT[image.contentType]}`
    const up = await sb.storage.from(GROUP_LOGO_BUCKET).upload(path, image.bytes, { contentType: image.contentType, cacheControl: '31536000', upsert: false })
    if (up.error) fail(up.error, 'logo upload failed')
    url = sb.storage.from(GROUP_LOGO_BUCKET).getPublicUrl(path).data.publicUrl
  }
  const { error } = await sb.rpc('set_group_logo', { p_group: groupId, p_url: url })
  if (error) fail(error, 'set logo failed')
  const old = logoPathOf(previousUrl, groupId)
  if (old) await sb.storage.from(GROUP_LOGO_BUCKET).remove([old]).catch(() => undefined)
  return url
}

export async function updateMyMemberProfile(sb: SupabaseClient, uid: string, groupId: string, id: MemberIdentity): Promise<void> {
  // Never clears a Riot ID: the web has no account of its own to send.
  const patch = id.riotId ? { display_name: id.displayName, riot_id: id.riotId } : { display_name: id.displayName }
  await sb.from('group_members').update(patch).eq('group_id', groupId).eq('user_id', uid)
}

// ── Profile looks (Team → Roster player cards) ──────────────────────────────
// The icon and banner a player picked on their Profile page, copied on each
// of their memberships so their teammates' roster cards show them. Columns
// added by migration 20261118160000_member_profile_look; before it, reads
// come back empty and writes report false instead of failing the caller.

/** Ids of the app's own artwork only (src/lib/profile.ts), never a URL. */
export const LOOK_ID = /^[a-z0-9_-]{1,32}$/

export async function setMyLook(sb: SupabaseClient, uid: string, look: { iconId: string; bannerId: string }): Promise<boolean> {
  if (!LOOK_ID.test(look.iconId) || !LOOK_ID.test(look.bannerId)) return false
  const { error } = await sb.from('group_members')
    .update({ profile_icon: look.iconId, profile_banner: look.bannerId })
    .eq('user_id', uid)
  return !error
}

export async function listMemberLooks(sb: SupabaseClient, uid: string): Promise<MemberLook[]> {
  const { data: memberships, error } = await sb.from('group_members').select('group_id').eq('user_id', uid)
  if (error || !memberships?.length) return []
  const { data, error: looksError } = await sb.from('group_members')
    .select('user_id, riot_id, profile_icon, profile_banner')
    .in('group_id', memberships.map((m) => m.group_id))
  if (looksError) return []
  const byUser = new Map<string, MemberLook>()
  for (const r of data ?? []) {
    const iconId = typeof r.profile_icon === 'string' && LOOK_ID.test(r.profile_icon) ? r.profile_icon : null
    const bannerId = typeof r.profile_banner === 'string' && LOOK_ID.test(r.profile_banner) ? r.profile_banner : null
    const known = byUser.get(r.user_id)
    if (known && (known.iconId || known.bannerId)) continue
    byUser.set(r.user_id, { userId: r.user_id, riotId: r.riot_id ?? known?.riotId ?? null, iconId, bannerId })
  }
  return [...byUser.values()]
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

/** Joining a group needs the player's Riot account: the group's team (Stats
 *  collectives, Espace d'équipe…) is built from its members' Riot IDs. */
export async function joinGroup(sb: SupabaseClient, code: string, id: MemberIdentity): Promise<string> {
  if (!id.riotId || !id.riotId.includes('#')) throw new Error('RIOT_ACCOUNT_REQUIRED')
  const { data, error } = await sb.rpc('join_group', { p_code: code, p_display_name: id.displayName, p_riot_id: id.riotId })
  if (error) fail(error, 'join failed')
  return data as string
}

/** Owner-only (enforced by the `set_captain` RPC, not by this function) —
 *  flags/unflags one roster player as "captain" (session-management rights,
 *  additive to whatever role they already have; see src/lib/permissions.ts). */
export async function setCaptain(sb: SupabaseClient, groupId: string, userId: string, isCaptain: boolean): Promise<void> {
  const { error } = await sb.rpc('set_captain', { p_group: groupId, p_user: userId, p_value: isCaptain })
  if (error) fail(error, 'set captain failed')
}

/** Owner-only (enforced by the `set_member_role` RPC): gives a member
 *  another role. The owner's own role never changes from here. */
export async function setMemberRole(sb: SupabaseClient, groupId: string, userId: string, role: Exclude<GroupRole, 'owner'>): Promise<void> {
  const { error } = await sb.rpc('set_member_role', { p_group: groupId, p_user: userId, p_role: role })
  if (error) fail(error, 'set member role failed')
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
    share_wellbeing: s.shareWellbeing,
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
