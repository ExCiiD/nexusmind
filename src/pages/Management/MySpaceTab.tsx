import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { CalendarClock, Check, ClipboardCheck, HeartPulse, ListTodo, Megaphone, Pin, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/data-state'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { collabErrorKey, type Group } from '@/lib/collab'
import { resolveAttendeeScope } from '@/lib/calendarCore'
import { KIND_STYLE, localDateKey } from '@/lib/planningView'
import { weekStart } from '@/lib/teamSessionHistoryView'
import { sortAnnouncements } from '@/lib/mySpaceView'
import { AssignedObjectivesCard } from '@/components/Coaching/AssignedObjectivesCard'
import { MyAvailabilityEditor } from '@/components/Planning/MyAvailabilityDialog'
import { TimeSelect, hmToMin, minToHm } from '@/components/Planning/TimeSelect'
import { MyCheckin } from '@/pages/Coaching/WellbeingSection'
import type { AvailabilityException, AvailabilityRule, CalendarEvent, CalendarEventKind } from '@/lib/calendar'
import type { Announcement } from '@/lib/announcements'
import type { Task } from '@/lib/teamOps'
import type { NameOf } from '@/hooks/useCollab'

const SESSION_KINDS: CalendarEventKind[] = ['scrim', 'flex', 'tournament', 'meeting']
const DAY = 86_400_000

export function Panel({ title, icon, right, children, className }: { title: string; icon: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('space-y-3 rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright">{icon}{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

const Skeleton = ({ h = 'h-24' }: { h?: string }) => <div className={cn('animate-pulse rounded-md bg-hextech-elevated/60', h)} aria-busy />

/**
 * « Mon espace » (docs/DESIGN_STATE.md § 16): Management for a member without a management or coach role (a player,
 * captain included) — one screen instead of the tabs: the next session and this week with my answers, my availability
 * edited in the page, the group's announcements, my tasks, my wellbeing, my assigned goals. Each card loads and fails
 * on its own.
 */
export function MySpaceTab({ group, myUserId, nameOf }: { group: Group; myUserId: string; nameOf: NameOf }) {
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-7">
        <ThisWeek group={group} myUserId={myUserId} />
        <MyAvailability groupId={group.id} myUserId={myUserId} />
        <Announcements groupId={group.id} nameOf={nameOf} />
      </div>
      <div className="space-y-4 lg:col-span-5">
        <MyTasks groupId={group.id} myUserId={myUserId} />
        <WellbeingPanel myUserId={myUserId} />
        <AssignedObjectivesCard planLink />
      </div>
    </div>
  )
}

/* ─── 1. This week, and the next session ─── */

function ThisWeek({ group, myUserId }: { group: Group; myUserId: string }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [prepReady, setPrepReady] = useState<Set<string>>(new Set())
  const monday = useMemo(() => weekStart(new Date()), [])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * DAY)), [monday])

  const load = useCallback(async () => {
    setFailed(false)
    try {
      // This week, and two weeks ahead for the next session.
      const list = await window.api.calendarListEvents(group.id, monday.toISOString(), new Date(monday.getTime() + 21 * DAY).toISOString())
      setEvents(list)
    } catch { setFailed(true) }
  }, [group.id, monday])
  useEffect(() => { void load() }, [load])

  const mine = useMemo(() => (events ?? []).filter((e) => resolveAttendeeScope(e.attendeeScope, group.members, e.attendeeUserIds).includes(myUserId)), [events, group.members, myUserId])
  const now = Date.now()
  const next = mine.filter((e) => SESSION_KINDS.includes(e.kind) && new Date(e.endsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null

  // « Préparation prête » once the coach set an objective (§ 17): one request for the events shown.
  const sessionIds = mine.filter((e) => SESSION_KINDS.includes(e.kind)).map((e) => e.id).join(',')
  useEffect(() => {
    if (!sessionIds || !window.api.sessionPrepReadyForEvents) { setPrepReady(new Set()); return }
    let alive = true
    window.api.sessionPrepReadyForEvents(sessionIds.split(','))
      .then((ids) => { if (alive) setPrepReady(new Set(ids)) })
      .catch(() => { if (alive) setPrepReady(new Set()) })
    return () => { alive = false }
  }, [sessionIds])

  const respond = async (e: CalendarEvent, status: 'confirmed' | 'declined') => {
    try { await window.api.calendarRespond(e.id, status); await load() } catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }
  const time = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const relative = (iso: string) => {
    const mins = Math.round((new Date(iso).getTime() - now) / 60_000)
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
    return mins <= 0 ? t('mySpace.now') : mins < 60 ? rtf.format(mins, 'minute') : mins < 48 * 60 ? rtf.format(Math.round(mins / 60), 'hour') : rtf.format(Math.round(mins / 1440), 'day')
  }
  const answerOf = (e: CalendarEvent) => e.responses?.find((r) => r.userId === myUserId)?.status ?? null

  return (
    <Panel title={t('mySpace.thisWeek')} icon={<CalendarClock className="h-4 w-4 text-hextech-gold" />}>
      {failed ? <ErrorState title={t('mySpace.loadFailed')} cause={t('teamSessions.loadFailedCause')} onRetry={() => { void load() }} /> : !events ? <Skeleton h="h-40" /> : (
        <>
          {next && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-hextech-gold/40 bg-hextech-gold/5 px-3 py-2.5" style={{ borderLeft: `3px solid ${KIND_STYLE[next.kind].accent}` }}>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-hextech-gold">{t('mySpace.next')}</p>
                <p className="truncate text-sm font-semibold text-hextech-text-bright">
                  {next.title} · {new Date(next.startsAt).toLocaleDateString(i18n.language, { weekday: 'short' })} {time(next.startsAt)} · {relative(next.startsAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {prepReady.has(next.id) && <span className="rounded bg-hextech-green/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-hextech-green">{t('sessionPrep.ready')}</span>}
                <Button asChild size="sm"><Link to={`/team-session/${encodeURIComponent(next.id)}`}>{t('mySpace.seePrep')}</Link></Button>
              </div>
            </div>
          )}
          <ol className="grid gap-1.5 sm:grid-cols-7">
            {days.map((d) => {
              const key = localDateKey(d)
              const dayEvents = mine.filter((e) => localDateKey(new Date(e.startsAt)) === key)
              const today = key === localDateKey(new Date())
              return (
                <li key={key} className={cn('min-h-[88px] rounded-md border p-1.5', today ? 'border-hextech-gold/50 bg-hextech-gold/5' : 'border-hextech-border-dim')}>
                  <p className={cn('mb-1 font-mono text-[10px] uppercase', today ? 'text-hextech-gold' : 'text-hextech-text-dim')}>
                    {d.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' })}
                  </p>
                  <div className="space-y-1">
                    {dayEvents.map((e) => {
                      const answer = answerOf(e)
                      return (
                        <div key={e.id} className="rounded border border-hextech-border-dim bg-hextech-black/40 p-1 text-[10px] leading-tight" style={{ borderLeft: `2px solid ${KIND_STYLE[e.kind].accent}` }}>
                          <p className="font-mono text-hextech-text-dim">{time(e.startsAt)}</p>
                          <p className="truncate font-medium text-hextech-text-bright" title={e.title}>{e.title}</p>
                          {prepReady.has(e.id) && <p className="font-mono text-[8px] font-bold uppercase text-hextech-green">{t('sessionPrep.ready')}</p>}
                          <div className="mt-1 flex gap-0.5">
                            <button type="button" onClick={() => { void respond(e, 'confirmed') }} aria-pressed={answer === 'confirmed'}
                              aria-label={t('mySpace.willBeThere', { title: e.title })} title={t('planning.match.iWillBeThere')}
                              className={cn('flex h-5 flex-1 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold', answer === 'confirmed' ? 'bg-hextech-green/25 text-hextech-green' : 'text-hextech-text-dim hover:bg-hextech-elevated')}>
                              <Check className="h-3 w-3" />
                            </button>
                            <button type="button" onClick={() => { void respond(e, 'declined') }} aria-pressed={answer === 'declined'}
                              aria-label={t('mySpace.cannot', { title: e.title })} title={t('planning.match.iCannot')}
                              className={cn('flex h-5 flex-1 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold', answer === 'declined' ? 'bg-hextech-red/25 text-hextech-red' : 'text-hextech-text-dim hover:bg-hextech-elevated')}>
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </li>
              )
            })}
          </ol>
          {mine.length === 0 && <p className="text-xs text-hextech-text-dim">{t('mySpace.nothingThisWeek')}</p>}
        </>
      )}
    </Panel>
  )
}

/* ─── 2. My availability, in the page ─── */

function MyAvailability({ groupId, myUserId }: { groupId: string; myUserId: string }) {
  const { t } = useTranslation()
  const [rules, setRules] = useState<AvailabilityRule[] | null>(null)
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([])
  const [failed, setFailed] = useState(false)
  const [editRules, setEditRules] = useState(false)
  const monday = useMemo(() => weekStart(new Date()), [])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * DAY)), [monday])

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [r, ex] = await Promise.all([
        window.api.availabilityListRules(groupId),
        window.api.availabilityListExceptions(groupId, localDateKey(days[0]), localDateKey(days[6])),
      ])
      setRules(r.filter((x) => x.userId === myUserId))
      setExceptions(ex.filter((x) => x.userId === myUserId))
    } catch { setFailed(true) }
  }, [groupId, myUserId, days])
  useEffect(() => { void load() }, [load])

  return (
    <Panel title={t('mySpace.availability')} icon={<ClipboardCheck className="h-4 w-4 text-hextech-gold" />}
      right={<button type="button" onClick={() => setEditRules((v) => !v)} aria-expanded={editRules} className="text-xs text-hextech-text-dim hover:text-hextech-gold">{t('mySpace.editUsual')}</button>}>
      {failed ? <ErrorState title={t('mySpace.loadFailed')} cause={t('teamSessions.loadFailedCause')} onRetry={() => { void load() }} /> : !rules ? <Skeleton h="h-56" /> : (
        <>
          {editRules && <UsualRulesEditor groupId={groupId} rules={rules} onSaved={() => { setEditRules(false); void load() }} />}
          <MyAvailabilityEditor groupId={groupId} days={days} myRules={rules} myExceptions={exceptions} onSaved={() => { void load() }} />
        </>
      )}
    </Panel>
  )
}

/** « Mes dispos habituelles »: one slot per weekday (the recurring rule), or none. */
function UsualRulesEditor({ groupId, rules, onSaved }: { groupId: string; rules: AvailabilityRule[]; onSaved: () => void }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const order = [1, 2, 3, 4, 5, 6, 0]
  const [rows, setRows] = useState(() => Object.fromEntries(order.map((wd) => {
    const r = rules.find((x) => x.weekday === wd)
    return [wd, { on: !!r, start: r ? hmToMin(r.startTime) : 19 * 60, end: r ? hmToMin(r.endTime) || 1440 : 23 * 60 }]
  })) as Record<number, { on: boolean; start: number; end: number }>)
  const [saving, setSaving] = useState(false)
  const name = (wd: number) => new Date(2026, 10, 15 + ((wd + 7) % 7)).toLocaleDateString(i18n.language, { weekday: 'long' }) // 15 Nov 2026 is a Sunday
  const invalid = order.some((wd) => rows[wd].on && rows[wd].end <= rows[wd].start)

  const save = async () => {
    setSaving(true)
    try {
      for (const r of rules) await window.api.availabilityDeleteRule(r.id)
      for (const wd of order) if (rows[wd].on) await window.api.availabilitySetRule(groupId, { weekday: wd, startTime: minToHm(rows[wd].start), endTime: minToHm(rows[wd].end) })
      toast({ title: t('mySpace.usualSaved'), variant: 'gold' })
      onSaved()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-hextech-border-dim bg-hextech-black/30 p-3">
      <p className="text-xs text-hextech-text-dim">{t('mySpace.usualHint')}</p>
      {order.map((wd) => (
        <div key={wd} className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex w-28 items-center gap-1.5 capitalize text-hextech-text-bright">
            <input type="checkbox" checked={rows[wd].on} onChange={(e) => setRows((s) => ({ ...s, [wd]: { ...s[wd], on: e.target.checked } }))} className="accent-hextech-gold" />
            {name(wd)}
          </label>
          {rows[wd].on && (
            <>
              <TimeSelect id={`usual-${wd}-start`} value={rows[wd].start} to={1425} onChange={(m) => setRows((s) => ({ ...s, [wd]: { ...s[wd], start: m } }))} />
              <span aria-hidden className="text-hextech-text-dim">→</span>
              <TimeSelect id={`usual-${wd}-end`} value={rows[wd].end} from={15} to={1440} invalid={rows[wd].end <= rows[wd].start} onChange={(m) => setRows((s) => ({ ...s, [wd]: { ...s[wd], end: m } }))} />
            </>
          )}
        </div>
      ))}
      <div className="flex justify-end pt-1">
        <Button size="sm" disabled={saving || invalid} onClick={() => { void save() }}>{t('mySpace.saveUsual')}</Button>
      </div>
    </div>
  )
}

/* ─── 3. Announcements ─── */

/** § 16.3 (and § 18.1 with « + Publier une annonce »): the group's announcements, newest pinned first. */
export function Announcements({ groupId, nameOf, action }: { groupId: string; nameOf: NameOf; action?: ReactNode }) {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [all, setAll] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try { setItems(sortAnnouncements(await window.api.announcementsList(groupId))) } catch { setFailed(true) }
  }, [groupId])
  useEffect(() => { void load() }, [load])

  const shown = items ? (all ? items : items.slice(0, 1)) : []
  return (
    <Panel title={t('mySpace.announcements')} icon={<Megaphone className="h-4 w-4 text-hextech-gold" />} right={action}>
      {failed ? <ErrorState title={t('mySpace.loadFailed')} cause={t('teamSessions.loadFailedCause')} onRetry={() => { void load() }} /> : !items ? <Skeleton /> : items.length === 0 ? (
        <p className="text-sm text-hextech-text-dim">{t('mySpace.noAnnouncement')}</p>
      ) : (
        <>
          <ul className="space-y-3">
            {shown.map((a) => (
              <li key={a.id} className="space-y-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-hextech-text-bright">
                  {a.pinned && <Pin className="h-3.5 w-3.5 text-hextech-gold" aria-label={t('mySpace.pinned')} />}{a.title}
                </p>
                <AnnouncementBody body={a.body} />
                <p className="text-[11px] text-hextech-text-dim">
                  {a.createdBy ? `${nameOf(a.createdBy)} · ` : ''}{new Date(a.createdAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' })}
                </p>
              </li>
            ))}
          </ul>
          {items.length > 1 && (
            <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="text-sm font-medium text-hextech-gold hover:text-hextech-gold-bright">
              {all ? t('mySpace.fewerAnnouncements') : t('mySpace.allAnnouncements', { count: items.length })}
            </button>
          )}
        </>
      )}
    </Panel>
  )
}

/** Cut to 3 lines; « Voir tout le message » unfolds it in place when it is longer. */
function AnnouncementBody({ body }: { body: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  const measure = useCallback((el: HTMLParagraphElement | null) => {
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [])
  return (
    <div>
      <p ref={open ? undefined : measure} className={cn('whitespace-pre-wrap text-sm text-hextech-text', !open && 'line-clamp-3')}>{body}</p>
      {(clamped || open) && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-0.5 text-xs font-medium text-hextech-gold hover:text-hextech-gold-bright">
          {open ? t('mySpace.collapse') : t('mySpace.seeAll')}
        </button>
      )}
    </div>
  )
}

/* ─── 4. My tasks ─── */

function MyTasks({ groupId, myUserId }: { groupId: string; myUserId: string }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [items, setItems] = useState<Task[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<'open' | 'done'>('open')

  const load = useCallback(async () => {
    setFailed(false)
    try { setItems((await window.api.tasksList(groupId)).filter((x) => x.assigneeId === myUserId)) } catch { setFailed(true) }
  }, [groupId, myUserId])
  useEffect(() => { void load() }, [load])

  const toggle = async (task: Task) => {
    const status = task.status === 'done' ? 'open' : 'done'
    setItems((list) => list?.map((x) => (x.id === task.id ? { ...x, status } : x)) ?? null)
    try { await window.api.tasksSetStatus(task.id, status) } catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }); void load() }
  }
  const today = localDateKey(new Date())
  const list = (items ?? []).filter((x) => x.status === filter).sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'))

  return (
    <Panel title={t('mySpace.tasks')} icon={<ListTodo className="h-4 w-4 text-hextech-gold" />}
      right={(
        <div role="radiogroup" aria-label={t('mySpace.tasks')} className="flex overflow-hidden rounded-md border border-hextech-border-dim text-xs">
          {(['open', 'done'] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}
              className={cn('px-2 py-0.5', filter === f ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text-dim hover:text-hextech-text')}>
              {t(`mySpace.taskFilter.${f}`)}
            </button>
          ))}
        </div>
      )}>
      {failed ? <ErrorState title={t('mySpace.loadFailed')} cause={t('teamSessions.loadFailedCause')} onRetry={() => { void load() }} /> : !items ? <Skeleton /> : list.length === 0 ? (
        <p className="text-sm text-hextech-text-dim">{filter === 'open' ? t('mySpace.noTask') : t('mySpace.noDoneTask')}</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((task) => (
            <li key={task.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={task.status === 'done'} onChange={() => { void toggle(task) }} aria-label={t('mySpace.markDone', { title: task.title })} className="accent-hextech-gold" />
              <span className={cn('min-w-0 flex-1 truncate', task.status === 'done' ? 'text-hextech-text-dim line-through' : 'text-hextech-text-bright')}>{task.title}</span>
              {task.dueDate && (
                <span className={cn('shrink-0 font-mono text-[11px]', task.status === 'open' && task.dueDate < today ? 'text-hextech-red' : 'text-hextech-text-dim')}>
                  {new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}


/* ─── 5. My wellbeing ─── */

function WellbeingPanel({ myUserId }: { myUserId: string }) {
  const { t } = useTranslation()
  return (
    <Panel title={t('mySpace.wellbeing')} icon={<HeartPulse className="h-4 w-4 text-hextech-gold" />}>
      <MyCheckin myUserId={myUserId} />
    </Panel>
  )
}
