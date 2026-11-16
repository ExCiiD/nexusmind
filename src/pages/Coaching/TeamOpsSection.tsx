import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, ListTodo, Loader2, Plus, Square, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import { isLegacyStaff } from '@/lib/permissions'
import type { Task } from '@/lib/teamOps'

interface Props { groups: Group[]; myUserId: string; nameOf: (userId: string) => string }

/** E7 (docs/PLAN_GESTION_EQUIPE.md): assignable to-do tasks, shared
 *  desktop/web. Announcements moved into Planning in Phase 2 of the
 *  Planning rework (§9) — see AnnouncementBubbleStack.tsx. */
export function TeamOpsSection({ groups, myUserId, nameOf }: Props) {
  const { t } = useTranslation()
  const [groupId, setGroupId] = useState(groups[0]?.id ?? null)
  const group = groups.find((g) => g.id === groupId)
  const isStaff = !!group && isLegacyStaff(group.myRole)

  if (groups.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTodo className="h-5 w-5 text-hextech-gold" />{t('teamOps.title', { defaultValue: 'Tasks' })}
          </CardTitle>
          {groups.length > 1 && (
            <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value)}
              className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1 text-xs text-hextech-text">
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>
        <CardDescription>{t('teamOps.desc', { defaultValue: "Assignable to-do tasks for the group." })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {groupId && <TasksPanel groupId={groupId} isStaff={isStaff} myUserId={myUserId} nameOf={nameOf} members={group?.members ?? []} />}
      </CardContent>
    </Card>
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
    <div className="space-y-2">
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
