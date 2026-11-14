import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, Film, Loader2, Plus, Square, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import type { NewVodAssignmentInput, TeamMistakeTag, VodReviewSession } from '@/lib/vodReview'
import type { ScrimSummary } from '@/lib/scrims'

const TEAM_TAGS: TeamMistakeTag[] = ['rotation', 'objective_setup', 'communication', 'other']

const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

interface Props { groups: Group[]; myUserId: string; nameOf: (userId: string) => string }

/** E5 (docs/PLAN_GESTION_EQUIPE.md): a scrim VOD review session — timestamped comments, team-mistake tags, action items, per-player watch assignments. */
export function VodReviewSection({ groups, myUserId, nameOf }: Props) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [groupId, setGroupId] = useState(groups[0]?.id ?? null)
  const group = groups.find((g) => g.id === groupId)
  const isStaff = group?.myRole !== 'player'

  const [sessions, setSessions] = useState<VodReviewSession[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scrims, setScrims] = useState<ScrimSummary[]>([])

  const load = useCallback(async () => {
    if (!groupId) return
    setSessions(null)
    try {
      const [s, sc] = await Promise.all([window.api.vodReviewListSessions(groupId), window.api.scrimsListForGroup(groupId).catch(() => [])])
      setSessions(s)
      setScrims(sc)
      setSelectedId((prev) => (prev && s.some((x) => x.id === prev)) ? prev : (s[0]?.id ?? null))
    } catch (err) {
      setSessions([])
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [groupId, t, toast])

  useEffect(() => { load() }, [load])

  if (groups.length === 0) return null
  const session = sessions?.find((s) => s.id === selectedId) ?? null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Film className="h-5 w-5 text-hextech-gold" />{t('vodReview.title', { defaultValue: 'VOD review' })}
          </CardTitle>
          {groups.length > 1 && (
            <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value)}
              className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1 text-xs text-hextech-text">
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>
        <CardDescription>{t('vodReview.desc', { defaultValue: 'Review a scrim VOD together: timestamped comments, team mistakes, action items, and watch assignments.' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isStaff && groupId && <NewSessionForm groupId={groupId} scrims={scrims} onCreated={load} />}

        {sessions === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-hextech-text-dim" />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">{t('vodReview.none', { defaultValue: 'No review session yet.' })}</p>
        ) : (
          <>
            <Select value={selectedId ?? ''} onValueChange={setSelectedId}>
              <SelectTrigger className="w-full md:w-96"><SelectValue /></SelectTrigger>
              <SelectContent>
                {sessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.title} — {new Date(s.createdAt).toLocaleDateString(i18n.language)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {session && (
              <SessionDetail key={session.id} session={session} group={group!} isStaff={isStaff} myUserId={myUserId} nameOf={nameOf} scrims={scrims} onChanged={load} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function NewSessionForm({ groupId, scrims, onCreated }: { groupId: string; scrims: ScrimSummary[]; onCreated: () => void }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [vodUrl, setVodUrl] = useState('')
  const [scrimId, setScrimId] = useState('')
  const [creating, setCreating] = useState(false)

  const create = async () => {
    if (!title.trim() || !vodUrl.trim()) return
    setCreating(true)
    try {
      await window.api.vodReviewCreateSession(groupId, { title: title.trim(), vodUrl: vodUrl.trim(), scrimId: scrimId || null })
      setTitle(''); setVodUrl(''); setScrimId('')
      onCreated()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-hextech-border-dim p-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="flex-1 min-w-[10rem]" placeholder={t('vodReview.sessionTitlePlaceholder', { defaultValue: 'e.g. Scrim vs Rival — game 2' })} />
      <Input value={vodUrl} onChange={(e) => setVodUrl(e.target.value)} maxLength={500} className="flex-1 min-w-[12rem]" placeholder={t('vodReview.vodUrlPlaceholder', { defaultValue: 'VOD link (YouTube, clip…)' })} />
      {scrims.length > 0 && (
        <Select value={scrimId} onValueChange={setScrimId}>
          <SelectTrigger className="w-56"><SelectValue placeholder={t('vodReview.linkScrim', { defaultValue: 'Link to a scrim (optional)' })} /></SelectTrigger>
          <SelectContent>
            {scrims.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.title}{s.opponent ? ` vs ${s.opponent}` : ''} — {new Date(s.scheduledAt).toLocaleDateString(i18n.language)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button size="sm" onClick={create} disabled={!title.trim() || !vodUrl.trim() || creating}>
        {creating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('vodReview.newSession', { defaultValue: 'New session' })}
      </Button>
    </div>
  )
}

function SessionDetail({ session, group, isStaff, myUserId, nameOf, scrims, onChanged }: {
  session: VodReviewSession; group: Group; isStaff: boolean; myUserId: string; nameOf: (id: string) => string; scrims: ScrimSummary[]; onChanged: () => void
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const members = useMemo(() => group.members, [group])
  const linkedScrim = session.scrimId ? scrims.find((s) => s.id === session.scrimId) : null

  const err = (e: unknown) => toast({ title: t(collabErrorKey(e)), variant: 'destructive' })

  // comments
  const [commentTime, setCommentTime] = useState('')
  const [commentTag, setCommentTag] = useState<TeamMistakeTag | 'none'>('none')
  const [commentBody, setCommentBody] = useState('')
  const [addingComment, setAddingComment] = useState(false)

  const addComment = async () => {
    if (!commentBody.trim()) return
    setAddingComment(true)
    try {
      await window.api.vodReviewAddComment(session.id, {
        videoTimeSec: commentTime ? Number(commentTime) : null,
        teamTag: commentTag === 'none' ? null : commentTag,
        body: commentBody.trim(),
      })
      setCommentTime(''); setCommentBody(''); setCommentTag('none')
      onChanged()
    } catch (e) { err(e) } finally { setAddingComment(false) }
  }

  // action items
  const [newAction, setNewAction] = useState('')
  const addAction = async () => {
    if (!newAction.trim()) return
    try { await window.api.vodReviewAddActionItem(session.id, newAction.trim()); setNewAction(''); onChanged() }
    catch (e) { err(e) }
  }
  const toggleAction = async (id: string, done: boolean) => {
    try { await window.api.vodReviewSetActionItemDone(id, !done); onChanged() } catch (e) { err(e) }
  }
  const removeAction = async (id: string) => {
    try { await window.api.vodReviewDeleteActionItem(id); onChanged() } catch (e) { err(e) }
  }

  // assignments
  const [assignPlayer, setAssignPlayer] = useState('')
  const [assignStart, setAssignStart] = useState('')
  const [assignEnd, setAssignEnd] = useState('')
  const addAssignment = async () => {
    const input: NewVodAssignmentInput = { playerId: assignPlayer, rangeStartSec: Number(assignStart), rangeEndSec: Number(assignEnd) }
    if (!input.playerId || !(input.rangeEndSec > input.rangeStartSec)) return
    try {
      await window.api.vodReviewSetAssignment(session.id, input)
      setAssignPlayer(''); setAssignStart(''); setAssignEnd('')
      onChanged()
    } catch (e) { err(e) }
  }
  const markAssignmentDone = async (id: string, status: 'pending' | 'done') => {
    try { await window.api.vodReviewSetAssignmentStatus(id, status === 'done' ? 'pending' : 'done'); onChanged() } catch (e) { err(e) }
  }
  const removeAssignment = async (id: string) => {
    try { await window.api.vodReviewDeleteAssignment(id); onChanged() } catch (e) { err(e) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-hextech-border-dim p-3">
        <div>
          <a href={session.vodUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-hextech-gold underline">{session.vodUrl}</a>
          {linkedScrim && (
            <p className="text-xs text-hextech-text-dim">
              {t('vodReview.linkedScrim', { defaultValue: 'Scrim: {{title}}', title: linkedScrim.title })}
            </p>
          )}
        </div>
        {isStaff && (
          <Button size="sm" variant="ghost" onClick={async () => { try { await window.api.vodReviewDeleteSession(session.id); onChanged() } catch (e) { err(e) } }}>
            <Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" />
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-hextech-text-bright">{t('vodReview.comments', { defaultValue: 'Timestamped comments' })}</h4>
        {session.comments.length > 0 && (
          <ul className="space-y-1">
            {session.comments.map((c) => (
              <li key={c.id} className="rounded bg-hextech-elevated/30 px-2 py-1 text-sm text-hextech-text">
                {c.videoTimeSec != null && <span className="mr-1 font-mono text-hextech-gold">{fmtTime(c.videoTimeSec)}</span>}
                {c.teamTag && <span className="mr-1 rounded bg-hextech-gold/10 px-1.5 py-0.5 text-[10px] text-hextech-gold">{t(`vodReview.tag.${c.teamTag}`)}</span>}
                <span className="text-xs text-hextech-text-dim">{nameOf(c.authorId)}:</span> {c.body}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Input value={commentTime} onChange={(e) => setCommentTime(e.target.value)} type="number" min={0} className="w-24" placeholder={t('vodReview.seconds', { defaultValue: 'sec' })} />
          <Select value={commentTag} onValueChange={(v) => setCommentTag(v as TeamMistakeTag | 'none')}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('vodReview.tag.none', { defaultValue: 'No tag' })}</SelectItem>
              {TEAM_TAGS.map((tag) => <SelectItem key={tag} value={tag}>{t(`vodReview.tag.${tag}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Textarea value={commentBody} onChange={(e) => setCommentBody(e.target.value)} rows={1} maxLength={2000} className="flex-1 min-w-[10rem]" placeholder={t('vodReview.commentPlaceholder', { defaultValue: 'Comment…' })} />
          <Button size="sm" onClick={addComment} disabled={!commentBody.trim() || addingComment}>
            {addingComment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-hextech-text-bright">{t('vodReview.actionItems', { defaultValue: 'Actions to remember' })}</h4>
        {session.actionItems.length > 0 && (
          <ul className="space-y-1">
            {session.actionItems.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-sm text-hextech-text">
                <button className="flex items-center gap-2 text-left" onClick={() => toggleAction(a.id, a.done)}>
                  {a.done ? <CheckSquare className="h-4 w-4 text-hextech-green" /> : <Square className="h-4 w-4 text-hextech-text-dim" />}
                  <span className={a.done ? 'line-through text-hextech-text-dim' : ''}>{a.text}</span>
                </button>
                <Button size="sm" variant="ghost" onClick={() => removeAction(a.id)}><Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" /></Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input value={newAction} onChange={(e) => setNewAction(e.target.value)} maxLength={500} className="flex-1" placeholder={t('vodReview.actionPlaceholder', { defaultValue: 'New action item…' })} />
          <Button size="sm" variant="outline" onClick={addAction} disabled={!newAction.trim()}><Plus className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-hextech-text-bright">{t('vodReview.assignments', { defaultValue: 'Watch assignments' })}</h4>
        {session.assignments.length > 0 && (
          <ul className="space-y-1">
            {session.assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-sm text-hextech-text">
                <span>{nameOf(a.playerId)}: {fmtTime(a.rangeStartSec)}–{fmtTime(a.rangeEndSec)}</span>
                <div className="flex items-center gap-2">
                  <span className={a.status === 'done' ? 'text-hextech-green' : 'text-hextech-gold'}>{t(`vodReview.status.${a.status}`)}</span>
                  {a.playerId === myUserId && (
                    <Button size="sm" variant="outline" onClick={() => markAssignmentDone(a.id, a.status)}>
                      {t(a.status === 'done' ? 'vodReview.markPending' : 'vodReview.markDone', { defaultValue: a.status === 'done' ? 'Mark pending' : 'Mark done' })}
                    </Button>
                  )}
                  {isStaff && <Button size="sm" variant="ghost" onClick={() => removeAssignment(a.id)}><Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" /></Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {isStaff && (
          <div className="flex flex-wrap gap-2">
            <Select value={assignPlayer} onValueChange={setAssignPlayer}>
              <SelectTrigger className="w-48"><SelectValue placeholder={t('vodReview.pickPlayer', { defaultValue: 'Pick a player' })} /></SelectTrigger>
              <SelectContent>
                {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.displayName || m.riotId || m.userId}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={assignStart} onChange={(e) => setAssignStart(e.target.value)} type="number" min={0} className="w-24" placeholder={t('vodReview.startSec', { defaultValue: 'start sec' })} />
            <Input value={assignEnd} onChange={(e) => setAssignEnd(e.target.value)} type="number" min={0} className="w-24" placeholder={t('vodReview.endSec', { defaultValue: 'end sec' })} />
            <Button size="sm" variant="outline" onClick={addAssignment} disabled={!assignPlayer || !assignStart || !assignEnd}>
              <Plus className="mr-1 h-3.5 w-3.5" />{t('vodReview.assign', { defaultValue: 'Assign' })}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
