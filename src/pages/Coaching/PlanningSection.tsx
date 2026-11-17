import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Download, Link2, Loader2, Pencil, Plus, RotateCw, Trash2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import { canEditCalendar as canEditCalendarRole } from '@/lib/permissions'
import { eventsToICS, type AvailabilityException, type AvailabilityRule, type CalendarEvent, type CalendarSubscription, type CommonFreeWindow } from '@/lib/calendar'
import { findCommonAvailability } from '@/lib/calendarCore'
import type { ScrimSummary } from '@/lib/scrims'
import { WeekGrid, GRID_MODES, type GridMode, type HourRange } from '@/components/Planning/WeekGrid'
import { KIND_STYLE, availableAnyTime, availableCount, localDateKey } from '@/lib/planningView'
import type { CalendarEventKind } from '@/lib/calendar'
import { cn } from '@/lib/utils'
import { EventPopup } from '@/components/Planning/EventPopup'
import { RequestEventDialog } from '@/components/Planning/RequestEventDialog'
import { EventRequestsQueue } from '@/components/Planning/EventRequestsQueue'
import { AnnouncementsCard } from '@/components/Planning/AnnouncementsCard'

function startOfWeek(d: Date): Date {
  const out = new Date(d)
  const day = out.getDay()
  const diff = (day === 0 ? -6 : 1) - day // Monday-based week
  out.setDate(out.getDate() + diff)
  out.setHours(0, 0, 0, 0)
  return out
}
// Local calendar day (see localDateKey): the week is shown in the viewer's timezone.
const toDateKey = localDateKey
/** ISO-8601 week number (weeks start Monday; week 1 holds Jan 4th). */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}
const MODE_KEY = 'ascend_planning_mode'
const toTimeKey = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`

interface Props { groups: Group[]; myUserId: string; nameOf: (userId: string) => string }

/** E4/Phase 1 (docs/PLAN_GESTION_EQUIPE.md §9): Google-Calendar-style week
 *  grid — click/drag to create events, a per-day rail to click/drag your own
 *  availability, event requests for non-editors. */
export function PlanningSection({ groups, myUserId, nameOf }: Props) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [groupId, setGroupId] = useState(groups[0]?.id ?? null)
  const group = groups.find((g) => g.id === groupId)
  const canEdit = !!group && canEditCalendarRole(group.myRole)

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [scrims, setScrims] = useState<ScrimSummary[]>([])
  const [rules, setRules] = useState<AvailabilityRule[]>([])
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([])
  const [starterIds, setStarterIds] = useState<string[]>([])
  const [creatingRange, setCreatingRange] = useState<HourRange | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [roster, setRoster] = useState<Array<{ userId: string; displayName: string; role: string }>>([])
  const [mode, setModeState] = useState<GridMode>(() => { try { return localStorage.getItem(MODE_KEY) === 'day' ? 'day' : 'esport' } catch { return 'esport' } })
  const setMode = (m: GridMode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* per-device preference */ } }

  const weekEnd = useMemo(() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); return d }, [weekStart])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d }), [weekStart])

  const load = useCallback(async () => {
    if (!groupId) return
    setEvents(null)
    try {
      const [ev, sc, r, ex, shared] = await Promise.all([
        window.api.calendarListEvents(groupId, weekStart.toISOString(), weekEnd.toISOString()),
        window.api.scrimsListForGroup(groupId).catch(() => []),
        window.api.availabilityListRules(groupId),
        window.api.availabilityListExceptions(groupId, toDateKey(weekStart), toDateKey(weekEnd)),
        window.api.teamGetShared(groupId).catch(() => ({ roster: [] as { userId: string | null; status: string; displayName: string; role: string }[] })),
      ])
      setEvents(ev)
      // Only standalone scrims not yet linked to a calendar event — linked
      // ones already render as their own event block.
      setScrims(sc.filter((s) => !ev.some((e) => e.linkedScrimId === s.id)))
      setRules(r)
      setExceptions(ex)
      setStarterIds(shared.roster.filter((m) => m.status === 'starter' && m.userId).map((m) => m.userId as string))
      setRoster(shared.roster.filter((m) => m.userId).map((m) => ({ userId: m.userId as string, displayName: m.displayName, role: m.role })))
    } catch (err) {
      setEvents([])
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [groupId, weekStart, weekEnd, t, toast])

  useEffect(() => { load() }, [load])

  if (groups.length === 0) return null

  const commonFree: CommonFreeWindow[] = starterIds.length > 0 ? findCommonAvailability(rules, exceptions, starterIds, toDateKey(weekStart)) : []
  const myExceptions = exceptions.filter((e) => e.userId === myUserId)
  const selected = (events ?? []).find((e) => e.id === selectedId) ?? null
  const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
  const windows = commonFree.map((w) => {
    const busy = (events ?? []).find((e) => {
      if (toDateKey(new Date(e.startsAt)) !== w.date) return false
      const s = new Date(e.startsAt).getHours() * 60 + new Date(e.startsAt).getMinutes()
      const en = s + (Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 60000
      return s < toMin(w.endTime) && en > toMin(w.startTime)
    })
    return { ...w, busy }
  })
  const bookWindow = (w: CommonFreeWindow) => {
    const [y, m, d] = w.date.split('-').map(Number)
    const startHour = Math.ceil(toMin(w.startTime) / 60)
    const endHour = Math.min(Math.floor(toMin(w.endTime) / 60) || 24, startHour + 2)
    setEditingEvent(null)
    setCreatingRange({ day: new Date(y, m - 1, d), startHour, endHour: Math.max(endHour, startHour + 1) })
  }
  const deleteSelected = async () => {
    if (!selected) return
    try { await window.api.calendarDeleteEvent(selected.id); setSelectedId(null); load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  const selectAvailabilityRange = async (range: HourRange) => {
    try {
      await window.api.availabilitySetException(groupId!, {
        date: toDateKey(range.day), available: true, startTime: toTimeKey(range.startHour), endTime: toTimeKey(range.endHour),
      })
      load()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }

  const removeAvailabilityException = async (id: string) => {
    try { await window.api.availabilityDeleteException(id); load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  const downloadICS = async () => {
    if (!groupId) return
    try {
      const from = new Date()
      const to = new Date(); to.setDate(to.getDate() + 60)
      const [upcoming, upcomingScrims] = await Promise.all([
        window.api.calendarListEvents(groupId, from.toISOString(), to.toISOString()),
        window.api.scrimsListForGroup(groupId).catch(() => []),
      ])
      const scrimEvents: CalendarEvent[] = upcomingScrims
        .filter((s) => !upcoming.some((e) => e.linkedScrimId === s.id))
        .filter((s) => new Date(s.scheduledAt) >= from && new Date(s.scheduledAt) < to)
        .map((s) => ({
          id: s.id, groupId: groupId!, kind: 'other', title: s.opponent ? `${s.title} vs ${s.opponent}` : s.title,
          startsAt: s.scheduledAt, endsAt: new Date(new Date(s.scheduledAt).getTime() + s.durationMin * 60000).toISOString(),
          notes: null, linkedScrimId: s.id, attendeeScope: 'whole_team', attendeeUserIds: [],
          createdBy: '', createdAt: s.scheduledAt, updatedAt: s.scheduledAt,
        }))
      const ics = eventsToICS([...upcoming, ...scrimEvents], group?.name ?? 'Ascend')
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
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col gap-3 border-b border-hextech-border-dim pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-hextech-gold">{t('planning.kicker')}</span>
            {starterIds.length > 0 && (
              <span className="rounded border border-hextech-green/40 bg-hextech-green/10 px-2 py-0.5 font-mono text-[10px] font-bold text-hextech-green">
                {t('planning.windowsBadge', { count: commonFree.length })}
              </span>
            )}
          </div>
          <h2 className="mt-1 flex items-center gap-2 font-condensed text-3xl font-extrabold uppercase leading-none text-hextech-text-bright">
            <CalendarDays className="h-6 w-6 text-hextech-gold" />{t('planning.heading')}
          </h2>
          <p className="mt-1 text-xs text-hextech-text">{t('planning.hint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {groups.length > 1 && (
            <select value={groupId ?? ''} onChange={(e) => { setGroupId(e.target.value); setSelectedId(null) }}
              className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1.5 text-xs text-hextech-text">
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          {!canEdit && groupId && <RequestEventDialog groupId={groupId} onSent={load} />}
          <Button size="sm" variant="outline" onClick={downloadICS}>
            <Download className="mr-1 h-3.5 w-3.5" />{t('planning.exportIcs', { defaultValue: 'Export .ics' })}
          </Button>
          {canEdit && groupId && <LiveSyncButton groupId={groupId} />}
        </div>
      </div>

      {groupId && <AnnouncementsCard groupId={groupId} canEdit={canEdit} nameOf={nameOf} />}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-9">
          <WeekHeader
            weekStart={weekStart}
            lastDay={days[6]}
            locale={i18n.language}
            onShift={(delta) => { setSelectedId(null); setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7 * delta); return d }) }}
            todayFree={starterIds.length ? availableAnyTime(rules, exceptions, starterIds, toDateKey(new Date())) : null}
            starters={starterIds.length}
            mode={mode}
            onMode={setMode}
          />

          {canEdit && groupId && <EventRequestsQueue groupId={groupId} nameOf={nameOf} />}

          {events === null ? (
            <Loader2 className="h-5 w-5 animate-spin text-hextech-text-dim" />
          ) : (
            <WeekGrid
              days={days}
              mode={mode}
              events={events}
              scrims={scrims}
              rules={rules}
              exceptions={exceptions}
              starterIds={starterIds}
              commonFree={commonFree}
              myAvailabilityExceptions={myExceptions}
              canEditCalendar={canEdit}
              onSelectEventRange={setCreatingRange}
              onSelectAvailabilityRange={selectAvailabilityRange}
              onRemoveAvailabilityException={removeAvailabilityException}
              onEventClick={(e) => setSelectedId((cur) => (cur === e.id ? null : e.id))}
              selectedEventId={selectedId}
            />
          )}
        </div>

        <aside className="space-y-4 xl:col-span-3">
          {/* Common windows */}
          <section className="panel-surface rounded-xl border border-hextech-border-dim p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2 border-b border-hextech-border-dim pb-2">
              <h3 className="flex min-w-0 items-center gap-1.5 whitespace-nowrap font-condensed text-lg font-extrabold uppercase text-hextech-text-bright">
                <Users className="h-4 w-4 shrink-0 text-hextech-green" />{t('planning.windows.title')}
              </h3>
              {starterIds.length > 0 && <span className="shrink-0 font-mono text-[10px] text-hextech-green">{t('planning.windows.starters', { n: starterIds.length })}</span>}
            </div>
            {starterIds.length === 0 ? (
              <p className="text-xs text-hextech-text-dim">{t('planning.noStarters', { defaultValue: 'No starters with a linked account in the published roster yet.' })}</p>
            ) : windows.length === 0 ? (
              <p className="text-xs text-hextech-text-dim">{t('planning.noCommonSlot', { defaultValue: 'No common free slot this week.' })}</p>
            ) : (
              <ul className="space-y-2">
                {windows.map((w, i) => (
                  <li key={i} className={cn('rounded-md border p-2.5', w.busy ? 'border-hextech-border-dim bg-hextech-black/30' : 'border-hextech-green/35 bg-hextech-green/[0.07]')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold uppercase text-hextech-text-bright">
                        {new Date(`${w.date}T12:00:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' })} · {w.startTime}–{w.endTime}
                      </span>
                      {!w.busy && canEdit && (
                        <button onClick={() => bookWindow(w)} className="flex items-center gap-0.5 rounded border border-hextech-gold/50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-hextech-gold hover:bg-hextech-gold/15">
                          <Plus className="h-3 w-3" />{t('planning.windows.book')}
                        </button>
                      )}
                    </div>
                    <p className={cn('mt-0.5 truncate font-mono text-[10px]', w.busy ? 'text-amber-300' : 'text-hextech-green')}>
                      {w.busy ? t('planning.windows.busy', { title: w.busy.title }) : t('planning.windows.free')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Selected event inspector */}
          <section className="panel-surface rounded-xl border border-hextech-border-dim p-4">
            {!selected ? (
              <p className="text-xs text-hextech-text-dim">{t('planning.inspector.empty')}</p>
            ) : (
              <EventInspector
                event={selected}
                roster={roster}
                members={group?.members ?? []}
                rules={rules}
                exceptions={exceptions}
                canEdit={canEdit}
                nameOf={nameOf}
                onClose={() => setSelectedId(null)}
                onEdit={() => setEditingEvent(selected)}
                onDelete={deleteSelected}
              />
            )}
          </section>

          {/* Legend */}
          <section className="panel-surface rounded-xl border border-hextech-border-dim p-4">
            <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-hextech-text">{t('planning.legend')}</h3>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {(['scrim', 'tournament', 'team_review', 'warmup_draft', 'one_on_one', 'meeting', 'soloq_block', 'rest'] as CalendarEventKind[]).map((k) => (
                <li key={k} className="flex items-center gap-1.5 text-[11px] text-hextech-text">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: KIND_STYLE[k].accent }} />{t(`planning.tag.${k}`, { defaultValue: k })}
                </li>
              ))}
              <li className="col-span-2 flex items-center gap-1.5 text-[11px] text-hextech-text">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-hextech-green/50 bg-hextech-green/20" />{t('planning.legendFree')}
              </li>
            </ul>
          </section>
        </aside>
      </div>

      {groupId && (
        <EventPopup
          groupId={groupId}
          members={group?.members ?? []}
          myUserId={myUserId}
          scrims={scrims}
          recentTitles={[...new Set((events ?? []).map((e) => e.title))]}
          initialRange={creatingRange}
          editingEvent={editingEvent}
          canDelete={canEdit}
          onClose={() => { setCreatingRange(null); setEditingEvent(null) }}
          onSaved={load}
        />
      )}
    </div>
  )
}

/** Side panel for the event clicked in the grid: details + who is free. */
function EventInspector({ event, roster, members, rules, exceptions, canEdit, nameOf, onClose, onEdit, onDelete }: {
  event: CalendarEvent
  roster: Array<{ userId: string; displayName: string; role: string }>
  members: Group['members']
  rules: AvailabilityRule[]
  exceptions: AvailabilityException[]
  canEdit: boolean
  nameOf: (id: string) => string
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  useEffect(() => setConfirming(false), [event.id])
  const accent = (KIND_STYLE[event.kind] ?? KIND_STYLE.other).accent
  const start = new Date(event.startsAt)
  const startMin = start.getHours() * 60 + start.getMinutes()
  const durMin = (Date.parse(event.endsAt) - start.getTime()) / 60000
  const key = toDateKey(start)
  const ids = event.attendeeUserIds.length ? event.attendeeUserIds
    : members.filter((m) => event.attendeeScope === 'whole_team'
      || (event.attendeeScope === 'all_players' && m.role === 'player')
      || (event.attendeeScope === 'all_staff' && m.role !== 'player')).map((m) => m.userId)
  const hm = (d: Date) => d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <span className="rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase" style={{ borderColor: `${accent}66`, color: accent }}>
          {t(`planning.tag.${event.kind}`, { defaultValue: event.kind })}
        </span>
        <button onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })} className="text-hextech-text-dim hover:text-hextech-text-bright"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div>
        <h3 className="font-condensed text-xl font-extrabold uppercase leading-tight text-hextech-text-bright">{event.title}</h3>
        <p className="mt-0.5 font-mono text-[11px] text-hextech-text">
          {start.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'short' })} · {hm(start)}–{hm(new Date(event.endsAt))}
        </p>
      </div>
      {event.notes && <p className="whitespace-pre-wrap rounded-md border border-hextech-border-dim bg-hextech-black/30 p-2 text-xs text-hextech-text">{event.notes}</p>}
      {ids.length > 0 && (
        <div>
          <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-hextech-text">{t('planning.inspector.presence')}</div>
          <ul className="space-y-1">
            {ids.map((id) => {
              const free = availableCount(rules, exceptions, [id], key, startMin, startMin + Math.min(durMin, 60)) === 1
              const r = roster.find((x) => x.userId === id)
              return (
                <li key={id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-hextech-text-bright">
                    {r?.displayName || nameOf(id)}{r?.role && <span className="ml-1 font-mono text-[10px] uppercase text-hextech-text-dim">{r.role}</span>}
                  </span>
                  <span className={cn('shrink-0 rounded px-1.5 font-mono text-[9px] font-bold uppercase', free ? 'bg-hextech-green/20 text-hextech-green' : 'bg-amber-400/15 text-amber-300')}>
                    {free ? t('planning.inspector.free') : t('planning.inspector.unknown')}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {canEdit && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />{t('planning.inspector.edit')}</Button>
          <Button size="sm" variant="outline" className="gap-1 text-hextech-red hover:text-hextech-red" onClick={() => (confirming ? onDelete() : setConfirming(true))}><Trash2 className="h-3.5 w-3.5" />{confirming ? t('planning.inspector.confirmDelete') : t('common.delete', { defaultValue: 'Delete' })}</Button>
        </div>
      )}
    </div>
  )
}

/** Week navigation + "today: are all starters available?" + hours mode. */
function WeekHeader({ weekStart, lastDay, locale, onShift, todayFree, starters, mode, onMode }: {
  weekStart: Date
  lastDay: Date
  locale: string
  onShift: (delta: number) => void
  todayFree: number | null
  starters: number
  mode: GridMode
  onMode: (m: GridMode) => void
}) {
  const { t } = useTranslation()
  const fmt = (d: Date) => d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()
  const allFree = todayFree !== null && todayFree === starters
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => onShift(-1)} aria-label={t('planning.grid.prevWeek')}><ChevronLeft className="h-4 w-4" /></Button>
        <div className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-hextech-gold">{t('planning.grid.week', { n: isoWeek(weekStart) })}</p>
          <p className="font-condensed text-2xl font-extrabold uppercase leading-tight text-hextech-text-bright">{fmt(weekStart)} – {fmt(lastDay)}</p>
        </div>
        <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => onShift(1)} aria-label={t('planning.grid.nextWeek')}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {todayFree !== null && (
          <span className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase', allFree ? 'border-hextech-green/40 bg-hextech-green/10 text-hextech-green' : 'border-amber-400/40 bg-amber-400/10 text-amber-300')}>
            <Users className="h-3.5 w-3.5" />{t('planning.grid.todayAvail', { free: todayFree, total: starters })} {allFree ? t('common.yes', { defaultValue: 'oui' }) : t('common.no', { defaultValue: 'non' })}
          </span>
        )}
        <div className="flex rounded-lg border border-hextech-border-dim p-0.5" role="group" aria-label={t('planning.grid.hours')}>
          {(Object.keys(GRID_MODES) as GridMode[]).map((m) => (
            <button key={m} onClick={() => onMode(m)} aria-pressed={mode === m}
              className={cn('rounded-md px-3 py-1.5 font-mono text-[11px] font-semibold uppercase', mode === m ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text-bright hover:bg-hextech-elevated')}>
              {t(`planning.grid.mode.${m}`, { from: String(GRID_MODES[m].start).padStart(2, '0'), to: GRID_MODES[m].end - 1 })}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * E4 v2: live calendar subscription — unlike "Export .ics" (a one-off
 * download), this is a stable URL a calendar app re-fetches on its own
 * schedule (served by the `team-calendar-ics` Edge Function). Staff-only:
 * revoking it breaks the feed for everyone who subscribed, so generating
 * it is a team-wide decision, not a personal export.
 */
function LiveSyncButton({ groupId }: { groupId: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [sub, setSub] = useState<CalendarSubscription | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setSub(undefined)
    window.api.calendarGetSubscription(groupId).then(setSub).catch(() => setSub(null))
  }, [groupId])

  const enable = async () => {
    setBusy(true)
    try { setSub(await window.api.calendarCreateSubscription(groupId)); setOpen(true) }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
    finally { setBusy(false) }
  }

  const regenerate = async () => {
    if (!sub) return
    setBusy(true)
    try {
      await window.api.calendarRevokeSubscription(sub.id)
      setSub(await window.api.calendarCreateSubscription(groupId))
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!sub) return
    await navigator.clipboard.writeText(sub.icsUrl).catch(() => {})
    toast({ title: t('planning.liveSyncCopied', { defaultValue: 'Link copied' }), variant: 'gold' })
  }

  if (sub === undefined) return null

  if (!sub) {
    return (
      <Button size="sm" variant="outline" onClick={enable} disabled={busy}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1 h-3.5 w-3.5" />}
        {t('planning.enableLiveSync', { defaultValue: 'Enable live sync' })}
      </Button>
    )
  }

  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        <Link2 className="mr-1 h-3.5 w-3.5" />{t('planning.liveSync', { defaultValue: 'Live sync' })}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-lg border border-hextech-border-dim bg-hextech-elevated p-3 shadow-lg">
          <p className="mb-2 text-xs text-hextech-text-dim">
            {t('planning.liveSyncHint', { defaultValue: 'Paste this URL into Google/Apple/Outlook "subscribe by URL" — it updates on its own.' })}
          </p>
          <div className="flex items-center gap-1">
            <Input readOnly value={sub.icsUrl} className="flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" variant="outline" onClick={copy}><Copy className="h-3.5 w-3.5" /></Button>
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={regenerate} disabled={busy} className="text-hextech-text-dim">
              <RotateCw className="mr-1 h-3.5 w-3.5" />{t('planning.regenerateLiveSync', { defaultValue: 'Revoke & regenerate' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
