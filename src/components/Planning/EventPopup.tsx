import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trash2, CalendarClock, X, SlidersHorizontal } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { collabErrorKey, type GroupMember } from '@/lib/collab'
import { resolveAttendeeScope } from '@/lib/calendarCore'
import { KIND_STYLE, completeTitle, suggestTitle } from '@/lib/planningView'
import type { AttendeeScope, CalendarEvent, CalendarEventKind } from '@/lib/calendar'
import type { ScrimSummary } from '@/lib/scrims'
import type { HourRange } from './WeekGrid'

/** The four big tiles (most frequent team activities), then the rest as chips. */
const MAIN_KINDS: CalendarEventKind[] = ['scrim', 'team_review', 'tournament', 'warmup_draft']
const OTHER_KINDS: CalendarEventKind[] = ['one_on_one', 'meeting', 'soloq_block', 'flex', 'rest', 'other']
const SCRIM_KINDS: CalendarEventKind[] = ['scrim', 'flex']
/** Kinds the `auto_create_team_session` DB trigger turns into a team session. */
/** Event kinds that open a team session (TeamSessionPage). */
export const SESSION_KINDS: CalendarEventKind[] = ['scrim', 'flex', 'tournament', 'meeting']
const DURATIONS = [1, 2, 3]

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const hh = (d: Date) => `${String(d.getHours()).padStart(2, '0')}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`

interface Props {
  groupId: string
  members: GroupMember[]
  myUserId: string
  scrims: ScrimSummary[]
  /** Titles already used this week — extra autocomplete candidates. */
  recentTitles?: string[]
  /** Set when creating from a grid drag selection. */
  initialRange: HourRange | null
  /** Set when opening an existing event (view/edit/delete). */
  editingEvent: CalendarEvent | null
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
}

/**
 * Quick-slot popup (redesign 17/11/2026) opened from a grid drag or an event
 * click. Title is pre-filled from who is concerned (2 people → 1:1, whole
 * team → team meeting, players + coach → VOD review…) until the user types;
 * typing shows an inline completion accepted with Tab or Enter.
 */
export function EventPopup({ groupId, members, myUserId, scrims, recentTitles = [], initialRange, editingEvent, canDelete, onClose, onSaved }: Props) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const navigate = useNavigate()
  const open = !!initialRange || !!editingEvent

  const [kind, setKind] = useState<CalendarEventKind>('scrim')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [customTimes, setCustomTimes] = useState(false)
  const [notes, setNotes] = useState('')
  const [linkedScrimId, setLinkedScrimId] = useState('')
  const [attendeeScope, setAttendeeScope] = useState<AttendeeScope>('all_players')
  const [customIds, setCustomIds] = useState<Set<string>>(new Set([myUserId]))
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

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
      const start = new Date(initialRange.day); start.setHours(initialRange.startHour, 0, 0, 0)
      const end = new Date(initialRange.day); end.setHours(initialRange.endHour, 0, 0, 0)
      setKind('scrim')
      setTitle(t('planning.smartTitle.kind.scrim'))
      setTitleTouched(false)
      setStartsAt(toLocalInput(start))
      setEndsAt(toLocalInput(end))
      setNotes('')
      setLinkedScrimId('')
      setAttendeeScope('all_players')
      setCustomIds(new Set([myUserId]))
    }
    setCustomTimes(false)
  }, [editingEvent, initialRange, myUserId, t])

  const attendeeIds = useMemo(
    () => (attendeeScope === 'custom' ? [...customIds] : resolveAttendeeScope(attendeeScope, members)),
    [attendeeScope, customIds, members],
  )

  /** Title the popup proposes for the current kind + people concerned. */
  const proposedTitle = (k: CalendarEventKind, scope: AttendeeScope, ids: string[]) => {
    const s = suggestTitle(scope, ids, members, myUserId)
    if (s.key === 'kind') return t(`planning.smartTitle.kind.${k}`)
    return t(`planning.smartTitle.${s.key}`, { name: s.name })
  }
  // Keep the pre-filled title in sync until the user types their own.
  useEffect(() => {
    if (!open || titleTouched || editingEvent) return
    setTitle(proposedTitle(kind, attendeeScope, attendeeIds))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, attendeeScope, attendeeIds, open, titleTouched, editingEvent])

  // Autocomplete candidates: every kind's usual titles + titles used this week.
  const candidates = useMemo(() => {
    const base = [...MAIN_KINDS, ...OTHER_KINDS].flatMap((k) => (t(`planning.smartTitle.suggestions.${k}`, { returnObjects: true }) as string[]) ?? [])
    return [...new Set([...base, ...recentTitles].filter((s) => typeof s === 'string' && s.trim()))]
  }, [t, recentTitles])
  const kindOfSuggestion = (label: string): CalendarEventKind | null => {
    for (const k of [...MAIN_KINDS, ...OTHER_KINDS]) {
      const list = t(`planning.smartTitle.suggestions.${k}`, { returnObjects: true }) as string[]
      if (Array.isArray(list) && list.includes(label)) return k
    }
    return null
  }
  const completion = titleTouched ? completeTitle(title, candidates) : null

  const acceptCompletion = () => {
    if (!completion) return false
    setTitle(completion)
    const k = kindOfSuggestion(completion)
    if (k && !editingEvent) setKind(k)
    return true
  }

  const start = startsAt ? new Date(startsAt) : null
  const end = endsAt ? new Date(endsAt) : null
  const durationH = start && end ? (end.getTime() - start.getTime()) / 3_600_000 : 0
  const setDuration = (hours: number) => {
    if (!start) return
    setEndsAt(toLocalInput(new Date(start.getTime() + hours * 3_600_000)))
  }

  const pickScrim = (id: string) => {
    setLinkedScrimId(id)
    const s = scrims.find((sc) => sc.id === id)
    if (s && !titleTouched) { setTitle(s.opponent ? `${s.title} vs ${s.opponent}` : s.title); setTitleTouched(true) }
  }

  const toggleCustomMember = (userId: string) => {
    setCustomIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId); else next.add(userId)
      return next
    })
  }

  const canSave = title.trim().length > 0 && !!start && !!end && end > start

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const payload = {
        kind, title: title.trim(), startsAt: start!.toISOString(), endsAt: end!.toISOString(),
        notes: notes.trim() || null, linkedScrimId: SCRIM_KINDS.includes(kind) ? (linkedScrimId || null) : null,
        attendeeScope, attendeeUserIds: attendeeIds,
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

  const label = 'mb-1.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-hextech-text'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-hextech-gold/30 bg-hextech-dark p-0 [&>button.absolute]:hidden">
        <div className="space-y-5 p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-hextech-border-dim pb-4">
            <div>
              <DialogDescription className="font-mono text-[11px] uppercase tracking-[0.14em] text-hextech-gold">
                {t('planning.popup.kicker')} // {start?.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'short' })}
              </DialogDescription>
              <DialogTitle className="mt-1 font-condensed text-3xl font-extrabold uppercase leading-none text-hextech-text-bright">
                {editingEvent ? t('planning.popup.editTitle') : t('planning.popup.newTitle', { time: start ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : '' })}
              </DialogTitle>
            </div>
            <button onClick={onClose} aria-label={t('common.close')} className="rounded p-1 text-hextech-text hover:bg-hextech-elevated hover:text-hextech-text-bright"><X className="h-4 w-4" /></button>
          </div>

          {/* Type */}
          <section>
            <span className={label}>{t('planning.popup.type')}</span>
            <div className="grid grid-cols-2 gap-2">
              {MAIN_KINDS.map((k) => (
                <KindTile key={k} kind={k} active={kind === k} onClick={() => setKind(k)} big />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {OTHER_KINDS.map((k) => <KindTile key={k} kind={k} active={kind === k} onClick={() => setKind(k)} />)}
            </div>
          </section>

          {/* People concerned (drives the pre-filled title) */}
          <section>
            <span className={label}>{t('planning.attendees', { defaultValue: 'People concerned' })}</span>
            <div className="flex flex-wrap gap-1.5">
              {(['whole_team', 'all_players', 'all_staff', 'custom'] as AttendeeScope[]).map((s) => (
                <button key={s} type="button" onClick={() => setAttendeeScope(s)} aria-pressed={attendeeScope === s}
                  className={cn('rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    attendeeScope === s ? 'border-hextech-gold bg-hextech-gold text-hextech-black' : 'border-hextech-border-dim text-hextech-text-bright hover:border-hextech-border')}>
                  {t(`planning.attendeeScope.${s}`)}
                </button>
              ))}
            </div>
            {attendeeScope === 'custom' && (
              <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-hextech-border-dim p-2">
                {members.map((m) => (
                  <button key={m.userId} type="button" onClick={() => toggleCustomMember(m.userId)} aria-pressed={customIds.has(m.userId)}
                    className={cn('rounded px-2 py-0.5 text-xs', customIds.has(m.userId) ? 'bg-hextech-gold/25 text-hextech-gold-bright ring-1 ring-hextech-gold/50' : 'bg-hextech-elevated text-hextech-text')}>
                    {m.displayName || m.riotId || '—'}
                    <span className="ml-1 text-[10px] text-hextech-text-dim">{t(`coaching.roles.${m.role}`, { defaultValue: m.role })}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Title with inline completion */}
          <section>
            <label className={label} htmlFor="slot-title">{t('planning.popup.titleLabel')}</label>
            <div className="relative rounded-md bg-hextech-black/60">
              {/* Ghost completion behind the (transparent) input: typed text kept
                  invisible for alignment, the rest greyed out. */}
              {completion && (
                <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center whitespace-pre px-3 text-sm font-medium">
                  <span className="invisible">{title}</span>
                  <span className="text-hextech-text-dim">{completion.slice(title.length)}</span>
                </div>
              )}
              <input
                id="slot-title"
                ref={titleRef}
                value={title}
                maxLength={120}
                autoComplete="off"
                onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }}
                onKeyDown={(e) => {
                  if ((e.key === 'Tab' || e.key === 'Enter') && completion) { e.preventDefault(); acceptCompletion() }
                  else if (e.key === 'Enter') e.preventDefault()
                }}
                placeholder={t('planning.eventTitlePlaceholder', { defaultValue: 'Event title…' })}
                className="relative z-10 h-11 w-full rounded-md border border-hextech-border-dim bg-transparent px-3 text-sm font-medium text-hextech-text-bright outline-none focus:border-hextech-gold"
                aria-describedby={completion ? 'slot-title-hint' : undefined}
              />
            </div>
            <p id="slot-title-hint" className="mt-1 h-4 text-[11px] text-hextech-text-dim">
              {completion ? t('planning.popup.completionHint', { value: completion }) : !titleTouched ? t('planning.popup.prefillHint') : ''}
            </p>
          </section>

          {/* Duration */}
          <section>
            <div className="flex items-center justify-between">
              <span className={label}>{t('planning.popup.duration')}</span>
              <button type="button" onClick={() => setCustomTimes((v) => !v)} className="mb-1.5 flex items-center gap-1 text-[11px] text-hextech-text hover:text-hextech-text-bright">
                <SlidersHorizontal className="h-3 w-3" />{t('planning.popup.customTimes')}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map((h) => {
                const active = Math.abs(durationH - h) < 0.01
                return (
                  <button key={h} type="button" onClick={() => setDuration(h)} aria-pressed={active}
                    className={cn('rounded-md border py-2 font-mono text-xs font-semibold transition-colors',
                      active ? 'border-hextech-gold bg-hextech-gold text-hextech-black' : 'border-hextech-border-dim text-hextech-text-bright hover:border-hextech-border')}>
                    {h}h {start && <span className="font-normal opacity-80">({hh(start)}–{hh(new Date(start.getTime() + h * 3_600_000))})</span>}
                  </button>
                )
              })}
            </div>
            {customTimes && (
              <div className="mt-2 flex gap-2">
                <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="flex-1" aria-label={t('planning.starts', { defaultValue: 'Starts' })} />
                <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="flex-1" aria-label={t('planning.ends', { defaultValue: 'Ends' })} />
              </div>
            )}
          </section>

          {SCRIM_KINDS.includes(kind) && scrims.length > 0 && (
            <Select value={linkedScrimId || 'none'} onValueChange={(v) => pickScrim(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder={t('planning.linkScrim', { defaultValue: 'Link to an existing scrim (optional)' })} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('planning.linkScrimNone', { defaultValue: '— No linked scrim —' })}</SelectItem>
                {scrims.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}{s.opponent ? ` vs ${s.opponent}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <section>
            <label className={label} htmlFor="slot-notes">{t('planning.popup.notes')}</label>
            <Textarea id="slot-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder={t('planning.notesPlaceholder', { defaultValue: 'Notes (optional)…' })} />
          </section>

          {editingEvent && SESSION_KINDS.includes(editingEvent.kind) && (
            <Button type="button" variant="outline" className="w-full" onClick={() => navigate(`/team-session/${editingEvent.id}`)}>
              <CalendarClock className="mr-2 h-4 w-4" />{t('planning.openTeamSession', { defaultValue: 'Open team session' })}
            </Button>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-hextech-border-dim pt-4">
            {editingEvent && canDelete ? (
              <Button variant="ghost" onClick={remove} disabled={saving} className="text-hextech-red">
                <Trash2 className="mr-1 h-3.5 w-3.5" />{t('common.delete', { defaultValue: 'Delete' })}
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
              <Button onClick={save} disabled={!canSave || saving} className="font-condensed text-base font-extrabold uppercase tracking-wide">
                {editingEvent ? t('planning.saveEvent', { defaultValue: 'Save' }) : t('planning.popup.submit')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function KindTile({ kind, active, onClick, big }: { kind: CalendarEventKind; active: boolean; onClick: () => void; big?: boolean }) {
  const { t } = useTranslation()
  const accent = KIND_STYLE[kind].accent
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn('flex items-center gap-2 rounded-md border text-left font-mono uppercase transition-colors',
        big ? 'px-3 py-3 text-xs font-semibold' : 'px-2 py-1 text-[10px]',
        active ? 'text-hextech-text-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border')}
      style={active ? { borderColor: accent, backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)` } : undefined}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
      {t(`planning.tag.${kind}`)}
    </button>
  )
}
