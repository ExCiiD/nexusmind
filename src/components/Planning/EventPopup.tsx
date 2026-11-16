import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trash2, CalendarClock } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { collabErrorKey, type GroupMember } from '@/lib/collab'
import { resolveAttendeeScope } from '@/lib/calendarCore'
import type { AttendeeScope, CalendarEvent, CalendarEventKind } from '@/lib/calendar'
import type { ScrimSummary } from '@/lib/scrims'
import type { HourRange } from './WeekGrid'

const KINDS: CalendarEventKind[] = ['tournament', 'team_review', 'one_on_one', 'soloq_block', 'scrim', 'flex', 'rest', 'meeting', 'other']
const SCRIM_KINDS: CalendarEventKind[] = ['scrim', 'flex']
/** Kinds the `auto_create_team_session` DB trigger turns into a
 *  `team_sessions` row (e_phase3_team_sessions migration) — mirrored here
 *  purely to decide whether to show the "Open team session" link. */
const SESSION_KINDS: CalendarEventKind[] = ['scrim', 'flex', 'tournament', 'meeting']

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  groupId: string
  members: GroupMember[]
  myUserId: string
  scrims: ScrimSummary[]
  /** Set when creating from a grid drag selection. */
  initialRange: HourRange | null
  /** Set when opening an existing event (view/edit/delete). */
  editingEvent: CalendarEvent | null
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
}

/** The event-creation/edit popup opened from WeekGrid's drag selection or by
 *  clicking an existing event (Phase 1). */
export function EventPopup({ groupId, members, myUserId, scrims, initialRange, editingEvent, canDelete, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const navigate = useNavigate()
  const open = !!initialRange || !!editingEvent

  const [kind, setKind] = useState<CalendarEventKind>('team_review')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [notes, setNotes] = useState('')
  const [linkedScrimId, setLinkedScrimId] = useState('')
  const [attendeeScope, setAttendeeScope] = useState<AttendeeScope>('whole_team')
  const [customIds, setCustomIds] = useState<Set<string>>(new Set([myUserId]))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editingEvent) {
      setKind(editingEvent.kind)
      setTitle(editingEvent.title)
      setTitleTouched(true)
      setStartsAt(toLocalInput(new Date(editingEvent.startsAt)))
      setEndsAt(toLocalInput(new Date(editingEvent.endsAt)))
      setNotes(editingEvent.notes ?? '')
      setLinkedScrimId(editingEvent.linkedScrimId ?? '')
      setAttendeeScope(editingEvent.attendeeScope)
      setCustomIds(new Set(editingEvent.attendeeUserIds))
    } else if (initialRange) {
      const start = new Date(initialRange.day)
      start.setHours(initialRange.startHour, 0, 0, 0)
      const end = new Date(initialRange.day)
      end.setHours(initialRange.endHour, 0, 0, 0)
      setKind('team_review')
      setTitle(t('planning.kind.team_review', { defaultValue: 'Team review' }))
      setTitleTouched(false)
      setStartsAt(toLocalInput(start))
      setEndsAt(toLocalInput(end))
      setNotes('')
      setLinkedScrimId('')
      setAttendeeScope('whole_team')
      setCustomIds(new Set([myUserId]))
    }
  }, [editingEvent, initialRange, myUserId, t])

  const changeKind = (k: CalendarEventKind) => {
    setKind(k)
    if (!titleTouched && k !== 'other') setTitle(t(`planning.kind.${k}`))
    if (!titleTouched && k === 'other') setTitle('')
  }

  const pickScrim = (id: string) => {
    setLinkedScrimId(id)
    const s = scrims.find((sc) => sc.id === id)
    if (s && !titleTouched) setTitle(s.opponent ? `${s.title} vs ${s.opponent}` : s.title)
  }

  const toggleCustomMember = (userId: string) => {
    setCustomIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId); else next.add(userId)
      return next
    })
  }

  const canSave = title.trim().length > 0 && startsAt && endsAt && new Date(endsAt) > new Date(startsAt)

  const save = async () => {
    setSaving(true)
    try {
      const attendeeUserIds = attendeeScope === 'custom' ? [...customIds] : resolveAttendeeScope(attendeeScope, members)
      const payload = {
        kind, title: title.trim(), startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
        notes: notes.trim() || null, linkedScrimId: SCRIM_KINDS.includes(kind) ? (linkedScrimId || null) : null,
        attendeeScope, attendeeUserIds,
      }
      if (editingEvent) await window.api.calendarUpdateEvent(editingEvent.id, payload)
      else await window.api.calendarCreateEvent(groupId, payload)
      onSaved()
      onClose()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!editingEvent) return
    setSaving(true)
    try {
      await window.api.calendarDeleteEvent(editingEvent.id)
      onSaved()
      onClose()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editingEvent ? t('planning.editEvent', { defaultValue: 'Edit event' }) : t('planning.addEvent', { defaultValue: 'Add event' })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={kind} onValueChange={(v) => changeKind(v as CalendarEventKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => <SelectItem key={k} value={k}>{t(`planning.kind.${k}`)}</SelectItem>)}
            </SelectContent>
          </Select>

          {kind === 'other' ? (
            <Input value={title} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }} maxLength={120} placeholder={t('planning.eventTitlePlaceholder', { defaultValue: 'Event title…' })} />
          ) : (
            <Input value={title} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }} maxLength={120} />
          )}

          {SCRIM_KINDS.includes(kind) && scrims.length > 0 && (
            <Select value={linkedScrimId || 'none'} onValueChange={(v) => pickScrim(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder={t('planning.linkScrim', { defaultValue: 'Link to an existing scrim (optional)' })} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('planning.linkScrimNone', { defaultValue: '— No linked scrim —' })}</SelectItem>
                {scrims.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}{s.opponent ? ` vs ${s.opponent}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <div className="flex gap-2">
            <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="flex-1" aria-label={t('planning.starts', { defaultValue: 'Starts' })} />
            <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="flex-1" aria-label={t('planning.ends', { defaultValue: 'Ends' })} />
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-hextech-text-dim">{t('planning.attendees', { defaultValue: 'People concerned' })}</p>
            <div className="flex flex-wrap gap-1.5">
              {(['whole_team', 'all_players', 'all_staff', 'custom'] as AttendeeScope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setAttendeeScope(s)}
                  className={cn(
                    'rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                    attendeeScope === s ? 'bg-hextech-gold text-black' : 'bg-hextech-elevated text-hextech-text-dim hover:text-white',
                  )}
                >
                  {t(`planning.attendeeScope.${s}`)}
                </button>
              ))}
            </div>
            {attendeeScope === 'custom' && (
              <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded border border-hextech-border-dim p-2">
                {members.map((m) => (
                  <button
                    key={m.userId}
                    onClick={() => toggleCustomMember(m.userId)}
                    className={cn(
                      'rounded px-2 py-0.5 text-[11px]',
                      customIds.has(m.userId) ? 'bg-hextech-gold/30 text-hextech-gold-bright' : 'bg-hextech-elevated text-hextech-text-dim',
                    )}
                  >
                    {m.displayName || m.riotId || '—'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder={t('planning.notesPlaceholder', { defaultValue: 'Notes (optional)…' })} />

          {editingEvent && SESSION_KINDS.includes(editingEvent.kind) && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => navigate(`/team-session/${editingEvent.id}`)}
            >
              <CalendarClock className="mr-2 h-4 w-4" />{t('planning.openTeamSession', { defaultValue: 'Open team session' })}
            </Button>
          )}
        </div>
        <DialogFooter className="flex items-center !justify-between">
          {editingEvent && canDelete ? (
            <Button variant="ghost" onClick={remove} disabled={saving} className="text-[#E24C3A]">
              <Trash2 className="mr-1 h-3.5 w-3.5" />{t('common.delete', { defaultValue: 'Delete' })}
            </Button>
          ) : <span />}
          <Button onClick={save} disabled={!canSave || saving}>
            {editingEvent ? t('planning.saveEvent', { defaultValue: 'Save' }) : t('planning.addEvent', { defaultValue: 'Add event' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
