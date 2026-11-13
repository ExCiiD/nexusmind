import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AssignmentStatus, NewVodAssignmentInput, NewVodCommentInput, NewVodSessionInput,
  VodReviewActionItem, VodReviewAssignment, VodReviewComment, VodReviewSession,
} from './vodReview'

/**
 * Collaborative VOD review (E5), same pattern as devPlanCore.ts/calendarCore.ts.
 * Purely server-side — desktop and web call these identically.
 */

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

interface SessionRow { id: string; group_id: string; scrim_id: string | null; title: string; vod_url: string; created_by: string; created_at: string; updated_at: string }
interface CommentRow { id: string; session_id: string; author_id: string; video_time_sec: number | null; team_tag: VodReviewComment['teamTag']; body: string; created_at: string }
interface ActionItemRow { id: string; session_id: string; text: string; done: boolean; done_by: string | null; done_at: string | null; created_by: string; created_at: string }
interface AssignmentRow { id: string; session_id: string; player_id: string; range_start_sec: number; range_end_sec: number; status: AssignmentStatus; created_at: string; updated_at: string }

const toComment = (r: CommentRow): VodReviewComment => ({
  id: r.id, sessionId: r.session_id, authorId: r.author_id, videoTimeSec: r.video_time_sec, teamTag: r.team_tag, body: r.body, createdAt: r.created_at,
})
const toActionItem = (r: ActionItemRow): VodReviewActionItem => ({
  id: r.id, sessionId: r.session_id, text: r.text, done: r.done, doneBy: r.done_by, doneAt: r.done_at, createdBy: r.created_by, createdAt: r.created_at,
})
const toAssignment = (r: AssignmentRow): VodReviewAssignment => ({
  id: r.id, sessionId: r.session_id, playerId: r.player_id, rangeStartSec: r.range_start_sec, rangeEndSec: r.range_end_sec,
  status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
})

async function hydrate(sb: SupabaseClient, session: SessionRow): Promise<VodReviewSession> {
  const [commentsRes, itemsRes, assignmentsRes] = await Promise.all([
    sb.from('vod_review_comments').select('id, session_id, author_id, video_time_sec, team_tag, body, created_at')
      .eq('session_id', session.id).order('video_time_sec', { ascending: true, nullsFirst: false }),
    sb.from('vod_review_action_items').select('id, session_id, text, done, done_by, done_at, created_by, created_at')
      .eq('session_id', session.id).order('created_at'),
    sb.from('vod_review_assignments').select('id, session_id, player_id, range_start_sec, range_end_sec, status, created_at, updated_at')
      .eq('session_id', session.id).order('range_start_sec'),
  ])
  if (commentsRes.error) fail(commentsRes.error, 'comments')
  if (itemsRes.error) fail(itemsRes.error, 'action items')
  if (assignmentsRes.error) fail(assignmentsRes.error, 'assignments')

  return {
    id: session.id, groupId: session.group_id, scrimId: session.scrim_id, title: session.title, vodUrl: session.vod_url,
    createdBy: session.created_by, createdAt: session.created_at, updatedAt: session.updated_at,
    comments: (commentsRes.data as CommentRow[]).map(toComment),
    actionItems: (itemsRes.data as ActionItemRow[]).map(toActionItem),
    assignments: (assignmentsRes.data as AssignmentRow[]).map(toAssignment),
  }
}

export async function listSessions(sb: SupabaseClient, groupId: string): Promise<VodReviewSession[]> {
  const { data, error } = await sb.from('vod_review_sessions')
    .select('id, group_id, scrim_id, title, vod_url, created_by, created_at, updated_at')
    .eq('group_id', groupId).order('created_at', { ascending: false })
  if (error) fail(error, 'list sessions')
  return Promise.all((data as SessionRow[]).map((row) => hydrate(sb, row)))
}

export async function createSession(sb: SupabaseClient, groupId: string, input: NewVodSessionInput): Promise<string> {
  const { data, error } = await sb.from('vod_review_sessions').insert({
    group_id: groupId, scrim_id: input.scrimId ?? null, title: input.title, vod_url: input.vodUrl,
  }).select('id').single()
  if (error) fail(error, 'create session')
  return data.id
}

export async function deleteSession(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('vod_review_sessions').delete().eq('id', id)
  if (error) fail(error, 'delete session')
}

export async function addComment(sb: SupabaseClient, sessionId: string, input: NewVodCommentInput): Promise<void> {
  const { error } = await sb.from('vod_review_comments').insert({
    session_id: sessionId, video_time_sec: input.videoTimeSec ?? null, team_tag: input.teamTag ?? null, body: input.body,
  })
  if (error) fail(error, 'add comment')
}

export async function deleteComment(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('vod_review_comments').delete().eq('id', id)
  if (error) fail(error, 'delete comment')
}

export async function addActionItem(sb: SupabaseClient, sessionId: string, text: string): Promise<void> {
  const { error } = await sb.from('vod_review_action_items').insert({ session_id: sessionId, text })
  if (error) fail(error, 'add action item')
}

export async function setActionItemDone(sb: SupabaseClient, id: string, done: boolean): Promise<void> {
  const { data: userData } = await sb.auth.getUser()
  const { error } = await sb.from('vod_review_action_items').update({
    done, done_by: done ? (userData.user?.id ?? null) : null, done_at: done ? new Date().toISOString() : null,
  }).eq('id', id)
  if (error) fail(error, 'set action item done')
}

export async function deleteActionItem(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('vod_review_action_items').delete().eq('id', id)
  if (error) fail(error, 'delete action item')
}

export async function setAssignment(sb: SupabaseClient, sessionId: string, input: NewVodAssignmentInput): Promise<void> {
  const { error } = await sb.from('vod_review_assignments').insert({
    session_id: sessionId, player_id: input.playerId, range_start_sec: input.rangeStartSec, range_end_sec: input.rangeEndSec,
  })
  if (error) fail(error, 'set assignment')
}

export async function setAssignmentStatus(sb: SupabaseClient, id: string, status: AssignmentStatus): Promise<void> {
  const { error } = await sb.from('vod_review_assignments').update({ status }).eq('id', id)
  if (error) fail(error, 'set assignment status')
}

export async function deleteAssignment(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('vod_review_assignments').delete().eq('id', id)
  if (error) fail(error, 'delete assignment')
}
