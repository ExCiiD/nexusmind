import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Copy, Download, Link2, Loader2, RotateCw, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import { canEditCalendar as canEditCalendarRole } from '@/lib/permissions'
import { eventsToICS, type AvailabilityException, type AvailabilityRule, type CalendarEvent, type CalendarSubscription, type CommonFreeWindow } from '@/lib/calendar'
import { findCommonAvailability } from '@/lib/calendarCore'
import type { ScrimSummary } from '@/lib/scrims'
import { WeekGrid, type HourRange } from '@/components/Planning/WeekGrid'
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
const toDateKey = (d: Date) => d.toISOString().slice(0, 10)
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
        window.api.teamGetShared(groupId).catch(() => ({ roster: [] as { userId: string | null; status: string }[] })),
      ])
      setEvents(ev)
      // Only standalone scrims not yet linked to a calendar event — linked
      // ones already render as their own event block.
      setScrims(sc.filter((s) => !ev.some((e) => e.linkedScrimId === s.id)))
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

  const commonFree: CommonFreeWindow[] = starterIds.length > 0 ? findCommonAvailability(rules, exceptions, starterIds, toDateKey(weekStart)) : []
  const myExceptions = exceptions.filter((e) => e.userId === myUserId)

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
            {!canEdit && groupId && <RequestEventDialog groupId={groupId} onSent={load} />}
            <Button size="sm" variant="outline" onClick={downloadICS}>
              <Download className="mr-1 h-3.5 w-3.5" />{t('planning.exportIcs', { defaultValue: 'Export .ics' })}
            </Button>
            {canEdit && groupId && <LiveSyncButton groupId={groupId} />}
          </div>
        </div>
        <CardDescription>{t('planning.desc', { defaultValue: 'Team calendar, recurring availability, and common free slots.' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {groupId && <AnnouncementsCard groupId={groupId} canEdit={canEdit} nameOf={nameOf} />}

        <div className="flex items-center justify-between">
          <Button size="sm" variant="outline" onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() - 7); return d })}>←</Button>
          <span className="text-sm text-hextech-text-dim">
            {weekStart.toLocaleDateString(i18n.language)} – {days[6].toLocaleDateString(i18n.language)}
          </span>
          <Button size="sm" variant="outline" onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7); return d })}>→</Button>
        </div>

        {canEdit && groupId && <EventRequestsQueue groupId={groupId} nameOf={nameOf} />}

        {events === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-hextech-text-dim" />
        ) : (
          <WeekGrid
            days={days}
            events={events}
            scrims={scrims}
            myAvailabilityExceptions={myExceptions}
            canEditCalendar={canEdit}
            onSelectEventRange={setCreatingRange}
            onSelectAvailabilityRange={selectAvailabilityRange}
            onRemoveAvailabilityException={removeAvailabilityException}
            onEventClick={setEditingEvent}
          />
        )}

        {groupId && (
          <EventPopup
            groupId={groupId}
            members={group?.members ?? []}
            myUserId={myUserId}
            scrims={scrims}
            initialRange={creatingRange}
            editingEvent={editingEvent}
            canDelete={canEdit}
            onClose={() => { setCreatingRange(null); setEditingEvent(null) }}
            onSaved={load}
          />
        )}

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
      </CardContent>
    </Card>
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
