import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clock, Loader2, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { collabErrorKey, type ReviewComment } from '@/lib/collab'

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseTime(v: string): number | null {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(v.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

interface CommentThreadProps {
  reviewId: string
  /** The review's owner. Omit when the current user is the player. */
  playerId?: string
  /** Group to post in. Omit on the player side: replies go to the thread's group. */
  groupId?: string
  gameId?: string | null
  myUserId: string
  /** Resolves an author id to a display name. */
  authorName: (userId: string) => string
  /** Hide entirely when there is nothing to show (player side). */
  hideWhenEmpty?: boolean
  onLoaded?: (comments: ReviewComment[]) => void
}

/** Coach ↔ player conversation on one review, optionally at a video timestamp. */
export function CommentThread({ reviewId, playerId, groupId, gameId, myUserId, authorName, hideWhenEmpty, onLoaded }: CommentThreadProps) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [comments, setComments] = useState<ReviewComment[] | null>(null)
  const [body, setBody] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await window.api.collabListComments(reviewId, playerId)
      setComments(list)
      onLoaded?.(list)
    } catch {
      setComments([])
    }
  }, [reviewId, playerId, onLoaded])

  useEffect(() => { load() }, [load])

  const targetGroup = groupId ?? comments?.[0]?.groupId
  const isPlayer = !playerId

  const send = async () => {
    if (!targetGroup || !body.trim()) return
    setBusy(true)
    try {
      await window.api.collabAddComment({
        groupId: targetGroup,
        playerId,
        reviewId,
        gameId: gameId ?? null,
        videoTimeSec: parseTime(time),
        body,
      })
      setBody('')
      setTime('')
      await load()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const toggleResolved = async (c: ReviewComment) => {
    await window.api.collabResolveComment(c.id, !c.resolved).catch(() => {})
    await load()
  }

  const remove = async (c: ReviewComment) => {
    await window.api.collabDeleteComment(c.id).catch(() => {})
    await load()
  }

  if (comments === null) return <Loader2 className="h-4 w-4 animate-spin text-hextech-text-dim" />
  if (hideWhenEmpty && comments.length === 0) return null

  return (
    <div className="space-y-3">
      {comments.length === 0 && <p className="text-xs text-hextech-text-dim">{t('coaching.comments.empty')}</p>}
      <ul className="space-y-2">
        {comments.map((c) => {
          const mine = c.authorId === myUserId
          return (
            <li
              key={c.id}
              className={cn(
                'rounded-lg border p-3 text-sm',
                mine ? 'border-hextech-border-dim bg-hextech-elevated/30' : 'border-hextech-gold/30 bg-hextech-gold/5',
                c.resolved && 'opacity-60',
              )}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-hextech-text-dim">
                <span className="font-medium text-hextech-text-bright">{mine ? t('coaching.comments.you') : authorName(c.authorId)}</span>
                {c.videoTimeSec !== null && (
                  <span className="flex items-center gap-1 rounded bg-hextech-elevated px-1.5 py-0.5 text-hextech-gold">
                    <Clock className="h-3 w-3" />{formatTime(c.videoTimeSec)}
                  </span>
                )}
                <span>{new Date(c.createdAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}</span>
                <div className="ml-auto flex gap-1">
                  {(isPlayer || mine) && (
                    <button onClick={() => toggleResolved(c)} title={t('coaching.comments.resolve')} className="hover:text-hextech-green">
                      <CheckCircle2 className={cn('h-3.5 w-3.5', c.resolved && 'text-hextech-green')} />
                    </button>
                  )}
                  {mine && (
                    <button onClick={() => remove(c)} title={t('common.delete')} className="hover:text-[#FF4655]">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="whitespace-pre-wrap text-hextech-text">{c.body}</p>
            </li>
          )
        })}
      </ul>

      {targetGroup && (
        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder={isPlayer ? t('coaching.comments.replyPlaceholder') : t('coaching.comments.placeholder')}
          />
          <div className="flex items-center gap-2">
            <Input
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="12:34"
              className="w-24"
              aria-label={t('coaching.comments.timeLabel')}
            />
            <span className="text-xs text-hextech-text-dim">{t('coaching.comments.timeHint')}</span>
            <Button size="sm" className="ml-auto gap-1" disabled={busy || !body.trim()} onClick={send}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {t('coaching.comments.send')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
