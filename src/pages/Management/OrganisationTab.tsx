import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BellRing, CalendarClock, ChevronDown, ListTodo, Plus, UserSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/data-state'
import { cn } from '@/lib/utils'
import type { Group } from '@/lib/collab'
import { resolveAttendeeScope } from '@/lib/calendarCore'
import { KIND_STYLE, availableCount, localDateKey } from '@/lib/planningView'
import { playsInGroup } from '@/lib/permissions'
import { weekStart } from '@/lib/teamSessionHistoryView'
import { PlayersAvailability } from '@/pages/Coaching/PlanningSection'
import type { AvailabilityException, AvailabilityRule, CalendarEvent } from '@/lib/calendar'
import type { Task } from '@/lib/teamOps'
import type { NameOf } from '@/hooks/useCollab'
import { Announcements, Panel } from './MySpaceTab'
import { useToast } from '@/hooks/useToast'
import { isServerNotReadyError } from '@/lib/matchEventView'
import type { EventReminder } from '@/lib/organisation'

const DAY = 86_400_000
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes()

/**
 * « Organisation » (docs/DESIGN_STATE.md § 18.1): Management's first tab for a manager who does not play — the next 7
 * days with each event's attendance and, for an absence, who could replace them (from the availability); the answers
 * still missing under 48 h; the group's open tasks; the announcements; the team's availability for the week. No game
 * or wellbeing data (closed to the manager).
 */
export function OrganisationTab({ group, nameOf, onTab }: { group: Group; nameOf: NameOf; onTab: (tab: 'planning' | 'teamOps') => void }) {
  const { t } = useTranslation()
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [rules, setRules] = useState<AvailabilityRule[]>([])
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([])
  const [failed, setFailed] = useState(false)
  const now = useMemo(() => new Date(), [])
  const monday = useMemo(() => weekStart(now), [now])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * DAY)), [monday])
  const players = useMemo(() => group.members.filter((m) => playsInGroup({ role: m.role, alsoPlays: m.alsoPlays })).map((m) => m.userId), [group.members])

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const to = new Date(Math.max(now.getTime() + 7 * DAY, monday.getTime() + 7 * DAY))
      const [ev, r, ex] = await Promise.all([
        window.api.calendarListEvents(group.id, monday.toISOString(), to.toISOString()),
        window.api.availabilityListRules(group.id),
        window.api.availabilityListExceptions(group.id, localDateKey(monday), localDateKey(to)),
      ])
      setEvents(ev); setRules(r); setExceptions(ex)
    } catch { setFailed(true) }
  }, [group.id, monday, now])
  useEffect(() => { void load() }, [load])

  const upcoming = (events ?? [])
    .filter((e) => new Date(e.endsAt).getTime() > now.getTime() && new Date(e.startsAt).getTime() < now.getTime() + 7 * DAY)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const soon = upcoming.filter((e) => new Date(e.startsAt).getTime() < now.getTime() + 2 * DAY)

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-7">
        <Panel title={t('organisation.upcoming')} icon={<CalendarClock className="h-4 w-4 text-hextech-gold" />}
          right={<Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onTab('planning')}><Plus className="h-3 w-3" />{t('organisation.newEvent')}</Button>}>
          {failed ? <ErrorState title={t('mySpace.loadFailed')} cause={t('teamSessions.loadFailedCause')} onRetry={() => { void load() }} />
            : !events ? <div className="h-32 animate-pulse rounded-md bg-hextech-elevated/60" />
            : upcoming.length === 0 ? <p className="text-sm text-hextech-text-dim">{t('organisation.nothingUpcoming')}</p>
            : <ul className="space-y-2">{upcoming.map((e) => <UpcomingRow key={e.id} event={e} group={group} players={players} rules={rules} exceptions={exceptions} nameOf={nameOf} />)}</ul>}
        </Panel>

        <Panel title={t('organisation.toWatch')} icon={<AlertTriangle className="h-4 w-4 text-hextech-gold" />}>
          {!events ? <div className="h-16 animate-pulse rounded-md bg-hextech-elevated/60" />
            : <ToWatch events={soon} group={group} nameOf={nameOf} />}
        </Panel>

        <Announcements groupId={group.id} nameOf={nameOf}
          action={<Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onTab('planning')}><Plus className="h-3 w-3" />{t('organisation.publish')}</Button>} />
      </div>

      <div className="space-y-4 lg:col-span-5">
        <GroupTasks groupId={group.id} nameOf={nameOf} onNew={() => onTab('teamOps')} />
        {events && <PlayersAvailability ids={players} fromRoster={false} days={days} rules={rules} exceptions={exceptions} nameOf={nameOf} />}
      </div>
    </div>
  )
}

function UpcomingRow({ event: e, group, players, rules, exceptions, nameOf }: {
  event: CalendarEvent
  group: Group
  players: string[]
  rules: AvailabilityRule[]
  exceptions: AvailabilityException[]
  nameOf: NameOf
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const start = new Date(e.startsAt), end = new Date(e.endsAt)
  const ids = resolveAttendeeScope(e.attendeeScope, group.members, e.attendeeUserIds)
  const answers = new Map((e.responses ?? []).map((r) => [r.userId, r]))
  const present = ids.filter((id) => answers.get(id)?.status === 'confirmed').length
  const absent = ids.filter((id) => answers.get(id)?.status === 'declined')
  const noAnswer = ids.length - present - absent.length
  // Who could replace them: players of the group not concerned, free on the whole slot.
  const date = localDateKey(start)
  const subs = players.filter((id) => !ids.includes(id) && availableCount(rules, exceptions, [id], date, minutesOf(start), Math.min(minutesOf(end) || 1440, 1440)) === 1)
  const [showSubs, setShowSubs] = useState(false)

  return (
    <li className="rounded-md border border-hextech-border-dim bg-hextech-black/30" style={{ borderLeft: `3px solid ${KIND_STYLE[e.kind].accent}` }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={absent.length === 0}
        className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left disabled:cursor-default">
        <span className="font-mono text-[11px] text-hextech-text-dim">{start.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' })} · {start.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-hextech-text-bright">{e.title}</span>
        <span className="font-mono text-[11px] text-hextech-text">
          {t('organisation.presence', { present, total: ids.length })}
          {absent.length > 0 && <span className="text-hextech-red"> · {t('organisation.absent', { count: absent.length })}</span>}
          <span className="text-hextech-text-dim"> · {t('organisation.noAnswer', { count: noAnswer })}</span>
        </span>
        {absent.length > 0 && <ChevronDown className={cn('h-3.5 w-3.5 text-hextech-text-dim transition-transform', open && 'rotate-180')} aria-hidden />}
      </button>
      {open && absent.length > 0 && (
        <div className="space-y-1.5 border-t border-hextech-border-dim px-3 py-2 text-xs">
          {absent.map((id) => (
            <p key={id}><span className="font-semibold text-hextech-text-bright">{nameOf(id)}</span>{answers.get(id)?.note && <span className="text-hextech-text-dim"> — {answers.get(id)?.note}</span>}</p>
          ))}
          <button type="button" onClick={() => setShowSubs((v) => !v)} aria-expanded={showSubs} className="inline-flex items-center gap-1 font-medium text-hextech-gold hover:underline">
            <UserSearch className="h-3.5 w-3.5" />{t('organisation.findSub')}
          </button>
          {showSubs && (subs.length === 0
            ? <p className="text-hextech-text-dim">{t('organisation.noSub')}</p>
            : <p className="text-hextech-text">{t('organisation.subs', { names: subs.map((id) => nameOf(id)).join(', ') })}</p>)}
        </div>
      )}
    </li>
  )
}

function GroupTasks({ groupId, nameOf, onNew }: { groupId: string; nameOf: NameOf; onNew: () => void }) {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<Task[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<'all' | 'overdue' | 'unassigned'>('all')
  const load = useCallback(async () => {
    setFailed(false)
    try { setItems((await window.api.tasksList(groupId)).filter((x) => x.status === 'open')) } catch { setFailed(true) }
  }, [groupId])
  useEffect(() => { void load() }, [load])
  const today = localDateKey(new Date())
  const list = (items ?? [])
    .filter((x) => filter === 'all' || (filter === 'overdue' ? !!x.dueDate && x.dueDate < today : !x.assigneeId))
    .sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'))
  return (
    <Panel title={t('organisation.tasks')} icon={<ListTodo className="h-4 w-4 text-hextech-gold" />}
      right={<Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onNew}><Plus className="h-3 w-3" />{t('organisation.newTask')}</Button>}>
      <div role="radiogroup" aria-label={t('organisation.tasks')} className="inline-flex overflow-hidden rounded-md border border-hextech-border-dim text-xs">
        {(['all', 'overdue', 'unassigned'] as const).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}
            className={cn('px-2 py-0.5', filter === f ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text-dim hover:text-hextech-text')}>{t(`organisation.taskFilter.${f}`)}</button>
        ))}
      </div>
      {failed ? <ErrorState title={t('mySpace.loadFailed')} cause={t('teamSessions.loadFailedCause')} onRetry={() => { void load() }} />
        : !items ? <div className="h-20 animate-pulse rounded-md bg-hextech-elevated/60" />
        : list.length === 0 ? <p className="text-sm text-hextech-text-dim">{t('organisation.noTask')}</p>
        : (
          <ul className="space-y-1.5">
            {list.map((x) => (
              <li key={x.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-hextech-text-bright">{x.title}</span>
                <span className="shrink-0 text-xs text-hextech-text-dim">{x.assigneeId ? nameOf(x.assigneeId) : t('organisation.unassigned')}</span>
                {x.dueDate && <span className={cn('shrink-0 font-mono text-[11px]', x.dueDate < today ? 'text-hextech-red' : 'text-hextech-text-dim')}>{new Date(`${x.dueDate}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}</span>}
              </li>
            ))}
          </ul>
        )}
    </Panel>
  )
}

/**
 * « Présence à surveiller » (§ 18.1): the answers still missing under 48 h, per event, with « Relancer » — an in-app
 * notification and a Discord DM when linked (calendarRemindResponses). Once per person and event every 6 h: the ones
 * reminded too recently come back in `skipped`, with when they can be reminded again.
 */
function ToWatch({ events, group, nameOf }: { events: CalendarEvent[]; group: Group; nameOf: NameOf }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [reminders, setReminders] = useState<EventReminder[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const ids = events.map((e) => e.id).join(',')
  const load = useCallback(async () => {
    if (!ids) return
    setReminders(await window.api.calendarListReminders(ids.split(',')).catch(() => []))
  }, [ids])
  useEffect(() => { void load() }, [load])

  const rows = events.map((e) => {
    const concerned = resolveAttendeeScope(e.attendeeScope, group.members, e.attendeeUserIds)
    const answered = new Set((e.responses ?? []).map((r) => r.userId))
    return { e, missing: concerned.filter((id) => !answered.has(id)) }
  }).filter((r) => r.missing.length > 0)
  if (rows.length === 0) return <p className="text-sm text-hextech-text-dim">{t('organisation.allAnswered')}</p>

  const time = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const ago = (iso: string) => {
    const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
    return new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(mins < 60 ? -mins : -Math.round(mins / 60), mins < 60 ? 'minute' : 'hour')
  }
  const remind = async (e: CalendarEvent, missing: string[]) => {
    setBusy(e.id)
    try {
      const r = await window.api.calendarRemindResponses(e.id, missing)
      const next = r.skipped.map((s) => s.nextAt).sort()[0]
      toast({
        title: r.reminded.length ? t('organisation.reminded', { count: r.reminded.length }) : t('organisation.nobodyReminded'),
        description: r.skipped.length ? t('organisation.remindSkipped', { count: r.skipped.length, time: time(next) }) : undefined,
        variant: r.reminded.length ? 'gold' : undefined,
      })
      await load()
    } catch (err) {
      const msg = (err as Error)?.message ?? ''
      toast({
        title: t(/NOT_AVAILABLE/.test(msg) || isServerNotReadyError(err) ? 'organisation.remindNotDeployed' : /EVENT_PAST/.test(msg) ? 'organisation.remindPast' : /FORBIDDEN/.test(msg) ? 'organisation.remindForbidden' : 'sessionPrep.errors.generic'),
        variant: 'destructive',
      })
    } finally { setBusy(null) }
  }

  return (
    <ul className="space-y-2.5 text-sm">
      {rows.map(({ e, missing }) => (
        <li key={e.id} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-hextech-text-bright">{e.title}</span>
            <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" disabled={busy === e.id} onClick={() => { void remind(e, missing) }}>
              <BellRing className="h-3 w-3" />{t('organisation.remind')}
            </Button>
          </div>
          <ul className="space-y-0.5">
            {missing.map((id) => {
              const last = reminders.filter((r) => r.eventId === e.id && r.userId === id).sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0]
              return (
                <li key={id} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-hextech-text-dim" aria-hidden />
                  <span className="text-hextech-text">{nameOf(id)}</span>
                  {last && <span className="text-hextech-text-dim">· {t('organisation.remindedAgo', { when: ago(last.sentAt) })}</span>}
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ul>
  )
}
