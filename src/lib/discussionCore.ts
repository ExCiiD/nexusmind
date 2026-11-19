import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiscussionComment, DiscussionSubjectType } from './discussion'
import { fail } from './supabaseErrors'

/**
 * Discussion threads on a scrim or a draft (E7 v2) — same pattern as
 * vodReviewCore.ts (no author display-name join; callers resolve names
 * through the group members list they already have, via a `nameOf`
 * helper, same as VodReviewSection/ScrimsPage already do).
 */

interface CommentRow { id: string; group_id: string; subject_type: DiscussionSubjectType; subject_id: string; author_id: string; body: string; created_at: string }
const toComment = (r: CommentRow): DiscussionComment => ({
  id: r.id, groupId: r.group_id, subjectType: r.subject_type, subjectId: r.subject_id, authorId: r.author_id, body: r.body, createdAt: r.created_at,
})

export async function listDiscussion(sb: SupabaseClient, subjectType: DiscussionSubjectType, subjectId: string): Promise<DiscussionComment[]> {
  const { data, error } = await sb.from('team_discussion_comments')
    .select('id, group_id, subject_type, subject_id, author_id, body, created_at')
    .eq('subject_type', subjectType).eq('subject_id', subjectId).order('created_at')
  if (error) fail(error, 'list discussion')
  return (data as CommentRow[]).map(toComment)
}

export async function addDiscussionComment(
  sb: SupabaseClient, groupId: string, subjectType: DiscussionSubjectType, subjectId: string, body: string,
): Promise<string> {
  const { data, error } = await sb.from('team_discussion_comments')
    .insert({ group_id: groupId, subject_type: subjectType, subject_id: subjectId, body })
    .select('id').single()
  if (error) fail(error, 'add discussion comment')
  return data.id
}

export async function deleteDiscussionComment(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('team_discussion_comments').delete().eq('id', id)
  if (error) fail(error, 'delete discussion comment')
}
