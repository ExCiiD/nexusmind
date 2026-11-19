/** Discussion threads on a scrim or a draft (E7 v2). Server-only, same
 *  pattern as vodReview.ts — desktop and web call the same functions. */

export type DiscussionSubjectType = 'scrim' | 'draft'

export interface DiscussionComment {
  id: string
  groupId: string
  subjectType: DiscussionSubjectType
  subjectId: string
  authorId: string | null // null once the author deleted their account (S19-16 / #33)
  body: string
  createdAt: string
}

export interface DiscussionApi {
  discussionList: (subjectType: DiscussionSubjectType, subjectId: string) => Promise<DiscussionComment[]>
  discussionAdd: (groupId: string, subjectType: DiscussionSubjectType, subjectId: string, body: string) => Promise<string>
  discussionDelete: (id: string) => Promise<void>
}
