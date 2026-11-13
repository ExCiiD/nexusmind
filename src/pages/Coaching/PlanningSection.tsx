import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Download, Loader2, Plus, Trash2, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import { eventsToICS, type AvailabilityException, type AvailabilityRule, type CalendarEvent, type CalendarEventKind, type CommonFreeWindow } from '@/lib/calendar'
import { findCommonAvailability } from '@/lib/calendarCore'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
const KINDS: CalendarEventKind[] = ['tournament', 'team_review', 'one_on_one', 'soloq_block', 'rest', 'other']

function startOfWeek(d: Date): Date {
  const out = new Date(d)
  const day = out.getDay()
  const diff = (day === 0 ? -6 : 1) - day // Monday-based week
  out.setDate(out.getDate() + diff)
  out.setHours(0, 0, 0, 0)
  return out
}
const toDateKey = (d: Date) => d.toISOString().slice(0, 10)

interface Props { groups: Group[]; myUserId: string }

/** E4 (docs/PLAN_GESTION_EQUIPE.md): week calendar, recurring availability, common free slots, .ics export. */
export function PlanningSection({ groups, myUserId }: Props) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [groupId, setGroupId] = useState(groups[0]?.id ?? null)
  const group = groups.find((g) => g.id === groupId)
  const isStaff = group?.myRole !== 'player'

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [rules, setRules] = useState<AvailabilityRule[]>([])
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([])
  const [starterIds, setStarterIds] = useState<string[]>([])

  const weekEnd = useMemo(() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); return d }, [weekStart])

  const load = useCallback(async () => {
    if (!groupId) return
    setEvents(null)
    try {
      const [ev, r, ex, shared] = await Promise.all([
        window.api.calendarListEvents(groupId, weekStart.toISOString(), weekEnd.toISOString()),
        window.api.availabilityListRules(groupId),
        window.api.availabilityListExceptions(groupId, toDateKey(weekStart), toDateKey(weekEnd)),
        window.api.teamGetShared(groupId).catch(() => ({ roster: [] as { userId: string | null; status: string }[] })),
      ])
      setEvents(ev)
      setRules(r)
      setExceptions(ex)
      setStarterIds(shared.roster.filter((m) => m.status === 'starter' && m.userId).map((m) => m.userId as string))
    } catch (err) {
      setEvents([])
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [groupId, weekStart, weekEnd, t, toast])

  useEffect(() => { load() }, [load])

  if (groups.length === 0) return null

  const days = WEEKDAYS.map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d })
  const commonFree: CommonFreeWindow[] = starterIds.length > 0 ? findCommonAvailability(rules, exceptions, starterIds, toDateKey(weekStart)) : []

  const downloadICS = async () => {
    if (!groupId) return
    try {
      const from = new Date()
      const to = new Date(); to.setDate(to.getDate() + 60)
      const upcoming = await window.api.calendarListEvents(groupId, from.toISOString(), to.toISOString())
      const ics = eventsToICS(upcoming, group?.name ?? 'Ascend')
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(group?.name ?? 'ascend').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-5 w-5 text-hextech-gold" />{t('planning.title', { defaultValue: 'Planning' })}
          </CardTitle>
          <div className="flex items-center gap-2">
            {groups.length > 1 && (
              <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value)}
                className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1 text-xs text-hextech-text">
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
            <Button size="sm" variant="outline" onClick={downloadICS}>
              <Download className="mr-1 h-3.5 w-3.5" />{t('planning.exportIcs', { defaultValue: 'Export .ics' })}
            </Button>
          </div>
        </div>
        <CardDescription>{t('planning.desc', { defaultValue: 'Team calendar, recurring availability, and common free slots.' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Button size="sm" variant="outline" onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() - 7); return d })}>←</Button>
          <span className="text-sm text-hextech-text-dim">
            {weekStart.toLocaleDateString(i18n.language)} – {days[6].toLocaleDateString(i18n.language)}
          </span>
          <Button size="sm" variant="outline" onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7); return d })}>→</Button>
        </div>

        {isStaff && groupId && <NewEventForm groupId={groupId} onCreated={load} />}

        {events === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-hextech-text-dim" />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map((d) => {
              const key = toDateKey(d)
              const dayEvents = events.filter((e) => e.startsAt.slice(0, 10) === key)
              return (
                <div key={key} className="rounded-lg border border-hextech-border-dim p-2">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-hextech-text-dim">
                    {d.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })}
                  </div>
                  {dayEvents.length === 0 ? (
                    <p className="text-[11px] text-hextech-text-dim">—</p>
                  ) : (
                    <ul className="space-y-1">
                      {dayEvents.map((e) => (
                        <li key={e.id} className="rounded bg-hextech-elevated/40 px-1.5 py-1 text-[11px] text-hextech-text">
                          <span className="text-hextech-gold">{new Date(e.startsAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</span>
                          {' '}{e.title}
                          <div className="text-[10px] text-hextech-text-dim">{t(`planning.kind.${e.kind}`)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {isStaff && (
          <div className="rounded-lg border border-hextech-border-dim p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-hextech-text-bright">
              <Users className="h-4 w-4 text-hextech-gold" />{t('planning.commonFree', { defaultValue: 'When all starters are free' })}
            </div>
            {starterIds.length === 0 ? (
              <p className="text-xs text-hextech-text-dim">{t('planning.noStarters', { defaultValue: 'No starters with a linked account in the published roster yet.' })}</p>
            ) : commonFree.length === 0 ? (
              <p className="text-xs text-hextech-text-dim">{t('planning.noCommonSlot', { defaultValue: 'No common free slot this week.' })}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {commonFree.map((w, i) => (
                  <li key={i} className="rounded bg-hextech-green/10 px-2 py-0.5 text-hextech-green">
                    {new Date(w.date).toLocaleDateString(i18n.language, { weekday: 'short' })} {w.startTime}–{w.endTime}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {groupId && <AvailabilityEditor groupId={groupId} myUserId={myUserId} rules={rules.filter((r) => r.userId === myUserId)} exceptions={exceptions.filter((e) => e.userId === myUserId)} onChanged={load} />}
      </CardContent>
    </Card>
  )
}

function NewEventForm({ groupId, onCreated }: { groupId: string; onCreated: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [kind, setKind] = useState<CalendarEventKind>('team_review')
  const [title, setTitle] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)

  const canCreate = title.trim().length > 0 && startsAt && endsAt && new Date(endsAt) > new Date(startsAt)

  const create = async () => {
    setCreating(true)
    try {
      await window.api.calendarCreateEvent(groupId, {
        kind, title: title.trim(), startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
        notes: notes.trim() || null,
      })
      setTitle(''); setStartsAt(''); setEndsAt(''); setNotes('')
      onCreated()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
      <div className="flex flex-wrap gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as CalendarEventKind)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {KINDS.map((k) => <SelectItem key={k} value={k}>{t(`planning.kind.${k}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="flex-1 min-w-[10rem]" placeholder={t('planning.eventTitlePlaceholder', { defaultValue: 'Event title…' })} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="w-56" aria-label={t('planning.starts', { defaultValue: 'Starts' })} />
        <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-56" aria-label={t('planning.ends', { defaultValue: 'Ends' })} />
      </div>
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} maxLength={2000} placeholder={t('planning.notesPlaceholder', { defaultValue: 'Notes (optional)…' })} />
      <Button size="sm" onClick={create} disabled={!canCreate || creating}>
        {creating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('planning.addEvent', { defaultValue: 'Add event' })}
      </Button>
    </div>
  )
}

function AvailabilityEditor({ groupId, rules, exceptions, onChanged }: {
  groupId: string; myUserId: string; rules: AvailabilityRule[]; exceptions: AvailabilityException[]; onChanged: () => void
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [weekday, setWeekday] = useState('1')
  const [start, setStart] = useState('18:00')
  const [end, setEnd] = useState('22:00')
  const [adding, setAdding] = useState(false)
  const [exceptionDate, setExceptionDate] = useState('')

  const weekdayLabel = (w: number) => new Date(2024, 0, 7 + w).toLocaleDateString(i18n.language, { weekday: 'long' })

  const addRule = async () => {
    if (start >= end) return
    setAdding(true)
    try {
      await window.api.availabilitySetRule(groupId, { weekday: Number(weekday), startTime: start, endTime: end })
      onChanged()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  const removeRule = async (id: string) => {
    try { await window.api.availabilityDeleteRule(id); onChanged() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  const addExceptionUnavailable = async () => {
    if (!exceptionDate) return
    try {
      await window.api.availabilitySetException(groupId, { date: exceptionDate, available: false })
      setExceptionDate('')
      onChanged()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }

  const removeException = async (id: string) => {
    try { await window.api.availabilityDeleteException(id); onChanged() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  return (
    <div className="space-y-3 rounded-lg border border-hextech-border-dim p-3">
      <h4 className="text-sm font-medium text-hextech-text-bright">{t('planning.myAvailability', { defaultValue: 'My availability' })}</h4>
      {rules.length > 0 && (
        <ul className="space-y-1">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between text-sm text-hextech-text">
              <span>{weekdayLabel(r.weekday)} {r.startTime}–{r.endTime}</span>
              <Button size="sm" variant="ghost" onClick={() => removeRule(r.id)}><Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={weekday} onValueChange={setWeekday}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WEEKDAYS.map((w) => <SelectItem key={w} value={String(w)}>{weekdayLabel(w)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-28" />
        <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-28" />
        <Button size="sm" variant="outline" onClick={addRule} disabled={adding}>
          <Plus className="mr-1 h-3.5 w-3.5" />{t('planning.addSlot', { defaultValue: 'Add slot' })}
        </Button>
      </div>

      {exceptions.length > 0 && (
        <ul className="space-y-1 pt-1">
          {exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between text-xs text-hextech-text-dim">
              <span>{new Date(e.date).toLocaleDateString(i18n.language)} — {t('planning.unavailable', { defaultValue: 'unavailable' })}</span>
              <Button size="sm" variant="ghost" onClick={() => removeException(e.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input type="date" value={exceptionDate} onChange={(e) => setExceptionDate(e.target.value)} className="w-44" />
        <Button size="sm" variant="outline" onClick={addExceptionUnavailable} disabled={!exceptionDate}>
          {t('planning.markUnavailable', { defaultValue: "Mark that day as unavailable" })}
        </Button>
      </div>
    </div>
  )
}
