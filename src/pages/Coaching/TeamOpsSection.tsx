import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, ListTodo, Loader2, Megaphone, Pin, Plus, Square, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import type { Announcement, Task } from '@/lib/teamOps'

interface Props { groups: Group[]; myUserId: string; nameOf: (userId: string) => string }

/** E7 (docs/PLAN_GESTION_EQUIPE.md): pinned announcements and assignable to-do tasks, shared desktop/web. */
export function TeamOpsSection({ groups, myUserId, nameOf }: Props) {
  const { t } = useTranslation()
  const [groupId, setGroupId] = useState(groups[0]?.id ?? null)
  const group = groups.find((g) => g.id === groupId)
  const isStaff = group?.myRole !== 'player'

  if (groups.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-5 w-5 text-hextech-gold" />{t('teamOps.title', { defaultValue: 'Announcements & tasks' })}
          </CardTitle>
          {groups.length > 1 && (
            <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value)}
              className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1 text-xs text-hextech-text">
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>
        <CardDescription>{t('teamOps.desc', { defaultValue: "Pinned announcements and assignable to-do tasks for the group." })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {groupId && (
          <>
            <AnnouncementsPanel groupId={groupId} isStaff={isStaff} nameOf={nameOf} />
            <TasksPanel groupId={groupId} isStaff={isStaff} myUserId={myUserId} nameOf={nameOf} members={group?.members ?? []} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function AnnouncementsPanel({ groupId, isStaff, nameOf }: { groupId: string; isStaff: boolean; nameOf: (id: string) => string }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try { setItems(await window.api.announcementsList(groupId)) }
    catch (err) { setItems([]); toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }, [groupId, t, toast])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!title.trim() || !body.trim()) return
    setCreating(true)
    try {
      await window.api.announcementsCreate(groupId, { title: title.trim(), body: body.trim() })
      setTitle(''); setBody('')
      await load()
    } catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
    finally { setCreating(false) }
  }

  const togglePin = async (a: Announcement) => {
    try { await window.api.announcementsSetPinned(a.id, !a.pinned); await load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }
  const remove = async (id: string) => {
    try { await window.api.announcementsDelete(id); await load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-hextech-text-bright">{t('teamOps.announcements', { defaultValue: 'Announcements' })}</h4>
      {isStaff && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-hextech-border-dim p-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="flex-1 min-w-[10rem]" placeholder={t('teamOps.announcementTitlePlaceholder', { defaultValue: 'Title…' })} />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={1} maxLength={4000} className="flex-1 min-w-[12rem]" placeholder={t('teamOps.announcementBodyPlaceholder', { defaultValue: 'Message…' })} />
          <Button size="sm" onClick={create} disabled={!title.trim() || !body.trim() || creating}>
            {creating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('teamOps.post', { defaultValue: 'Post' })}
          </Button>
        </div>
      )}
      {items === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-hextech-text-dim" />
      ) : items.length === 0 ? (
        <p className="text-xs text-hextech-text-dim">{t('teamOps.noAnnouncements', { defaultValue: 'No announcements yet.' })}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <li key={a.id} className="rounded-lg border border-hextech-border-dim p-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    {a.pinned && <Pin className="h-3.5 w-3.5 text-hextech-gold" />}
                    <span className="text-sm font-medium text-hextech-text-bright">{a.title}</span>
                  </div>
                  <p className="text-sm text-hextech-text">{a.body}</p>
                  <p className="text-[11px] text-hextech-text-dim">{nameOf(a.createdBy)} · {new Date(a.createdAt).toLocaleDateString(i18n.language)}</p>
                </div>
                {isStaff && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => togglePin(a)}><Pin className={a.pinned ? 'h-3.5 w-3.5 text-hextech-gold' : 'h-3.5 w-3.5 text-hextech-text-dim'} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(a.id)}><Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" /></Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TasksPanel({ groupId, isStaff, myUserId, nameOf, members }: {
  groupId: string; isStaff: boolean; myUserId: string; nameOf: (id: string) => string; members: Group['members']
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [items, setItems] = useState<Task[] | null>(null)
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try { setItems(await window.api.tasksList(groupId)) }
    catch (err) { setItems([]); toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }, [groupId, t, toast])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!title.trim()) return
    setCreating(true)
    try {
      await window.api.tasksCreate(groupId, { title: title.trim(), assigneeId: assignee || null, dueDate: due || null })
      setTitle(''); setAssignee(''); setDue('')
      await load()
    } catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
    finally { setCreating(false) }
  }

  const toggleStatus = async (tsk: Task) => {
    try { await window.api.tasksSetStatus(tsk.id, tsk.status === 'done' ? 'open' : 'done'); await load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }
  const remove = async (id: string) => {
    try { await window.api.tasksDelete(id); await load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  return (
    <div className="space-y-2 border-t border-hextech-border-dim pt-3">
      <h4 className="flex items-center gap-1.5 text-sm font-medium text-hextech-text-bright">
        <ListTodo className="h-4 w-4 text-hextech-gold" />{t('teamOps.tasks', { defaultValue: 'Tasks' })}
      </h4>
      {isStaff && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-hextech-border-dim p-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="flex-1 min-w-[10rem]" placeholder={t('teamOps.taskTitlePlaceholder', { defaultValue: 'e.g. Prep scouting for Rival' })} />
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger className="w-44"><SelectValue placeholder={t('teamOps.unassigned', { defaultValue: 'Unassigned' })} /></SelectTrigger>
            <SelectContent>
              {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.displayName || m.riotId || m.userId}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
          <Button size="sm" onClick={create} disabled={!title.trim() || creating}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}
      {items === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-hextech-text-dim" />
      ) : items.length === 0 ? (
        <p className="text-xs text-hextech-text-dim">{t('teamOps.noTasks', { defaultValue: 'No tasks yet.' })}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((tsk) => {
            const canToggle = isStaff || tsk.assigneeId === myUserId
            return (
              <li key={tsk.id} className="flex items-center justify-between gap-2 text-sm text-hextech-text">
                <button className="flex items-center gap-2 text-left disabled:cursor-default" disabled={!canToggle} onClick={() => canToggle && toggleStatus(tsk)}>
                  {tsk.status === 'done' ? <CheckSquare className="h-4 w-4 text-hextech-green" /> : <Square className="h-4 w-4 text-hextech-text-dim" />}
                  <span className={tsk.status === 'done' ? 'line-through text-hextech-text-dim' : ''}>{tsk.title}</span>
                  {tsk.assigneeId && <span className="text-xs text-hextech-text-dim">— {nameOf(tsk.assigneeId)}</span>}
                  {tsk.dueDate && <span className="text-xs text-hextech-text-dim">· {new Date(tsk.dueDate).toLocaleDateString(i18n.language)}</span>}
                </button>
                {isStaff && <Button size="sm" variant="ghost" onClick={() => remove(tsk.id)}><Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" /></Button>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
