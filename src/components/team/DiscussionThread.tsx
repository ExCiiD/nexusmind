import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey } from '@/lib/collab'
import type { DiscussionComment, DiscussionSubjectType } from '@/lib/discussion'

/**
 * Discussion thread on a scrim or a draft (E7 v2) — a plain, non-timestamped
 * comment list, deliberately simpler than the VOD review comments (E5,
 * which anchor to a video timestamp): there's no video here, just "talk
 * about this scrim/draft". Any group member reads and posts; the author or
 * staff can delete (team_discussion_comments RLS).
 */
interface Props {
  groupId: string
  subjectType: DiscussionSubjectType
  subjectId: string
  myUserId: string
  nameOf: (userId: string) => string
  /** Only staff may delete someone else's comment; the author always can. */
  isStaff: boolean
}

export function DiscussionThread({ groupId, subjectType, subjectId, myUserId, nameOf, isStaff }: Props) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [comments, setComments] = useState<DiscussionComment[] | null>(null)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)

  const load = useCallback(() => {
    window.api.discussionList(subjectType, subjectId).then(setComments).catch(() => setComments([]))
  }, [subjectType, subjectId])
  useEffect(() => { setComments(null); load() }, [load])

  const post = async () => {
    const trimmed = body.trim()
    if (!trimmed) return
    setPosting(true)
    try {
      await window.api.discussionAdd(groupId, subjectType, subjectId, trimmed)
      setBody('')
      load()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setPosting(false)
    }
  }

  const remove = async (id: string) => {
    try { await window.api.discussionDelete(id); load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 font-medium text-hextech-text-bright">
        <MessageSquare className="h-4 w-4 text-hextech-gold" />{t('discussion.title', { defaultValue: 'Discussion' })}
      </h3>
      {comments === null ? (
        <p className="text-xs text-hextech-text-dim">{t('common.loading', { defaultValue: 'Loading…' })}</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-hextech-text-dim italic">{t('discussion.empty', { defaultValue: 'No comments yet.' })}</p>
      ) : (
        <ul className="space-y-1.5">
          {comments.map((c) => (
            <li key={c.id} className="group/comment flex items-start justify-between gap-2 rounded bg-hextech-elevated/30 px-2 py-1.5 text-xs">
              <div>
                <span className="font-medium text-hextech-text-bright">{c.authorId === myUserId ? t('coaching.comments.you', { defaultValue: 'You' }) : nameOf(c.authorId)}</span>
                <span className="ml-1.5 text-[10px] text-hextech-text-dim">{new Date(c.createdAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}</span>
                <p className="mt-0.5 whitespace-pre-wrap text-hextech-text">{c.body}</p>
              </div>
              {(c.authorId === myUserId || isStaff) && (
                <button onClick={() => remove(c.id)} className="shrink-0 text-hextech-text-dim opacity-0 transition-opacity hover:text-[#E24C3A] group-hover/comment:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000}
          placeholder={t('discussion.placeholder', { defaultValue: 'Write a comment…' })}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post() } }}
        />
        <Button size="sm" onClick={post} disabled={posting || !body.trim()}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </section>
  )
}
