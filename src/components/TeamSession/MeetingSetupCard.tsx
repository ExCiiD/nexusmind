import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Play, Users, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import type { CalendarEvent } from '@/lib/calendar'
import type { TeamSession } from '@/lib/teamSessions'
import { cn } from '@/lib/utils'
import { playsInGroup } from '@/lib/permissions'

/** The people a meeting is for: its attendee list, else its quick-select
 *  scope resolved against the group (same rule as the Planning panel). */
export function meetingPeople(event: CalendarEvent, members: Group['members']): string[] {
  if (event.attendeeUserIds.length > 0) return event.attendeeUserIds
  return members.filter((m) => event.attendeeScope === 'whole_team'
    || (event.attendeeScope === 'all_players' && playsInGroup(m))
    || (event.attendeeScope === 'all_staff' && m.role !== 'player')).map((m) => m.userId)
}

/**
 * A meeting-kind team session (19/11/2026): no queue, no objectives —
 * before it starts, the reason (the event's title) and the people
 * concerned (its attendees); once it runs, who is actually there.
 * Attendance lives in team_session_attendance.
 */
export function MeetingSetupCard({ event, session, group, canManage, myUserId, onChanged }: {
  event: CalendarEvent
  session: TeamSession
  group: Group
  canManage: boolean
  myUserId: string
  onChanged: () => Promise<void> | void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [reason, setReason] = useState(event.title)
  const [people, setPeople] = useState<string[]>(() => meetingPeople(event, group.members))
  const [attendance, setAttendance] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [marking, setMarking] = useState<string | null>(null)
  const nameOf = useMemo(() => {
    const by = new Map(group.members.map((m) => [m.userId, m.displayName || m.riotId || '—']))
    return (id: string | null | undefined) => (id && by.get(id)) || t('common.formerMember')
  }, [group.members, t])

  const scheduled = session.status === 'scheduled'
  useEffect(() => {
    if (scheduled) return
    window.api.teamSessionGetAttendance?.(session.id).then(setAttendance).catch(() => setAttendance({}))
  }, [session.id, scheduled])

  const fail = (err: unknown) => toast({ title: t(collabErrorKey(err)), description: (err as Error)?.message, variant: 'destructive' })

  const start = async () => {
    if (!reason.trim() || people.length === 0) return
    setBusy(true)
    try {
      await window.api.calendarUpdateEvent(event.id, {
        kind: event.kind, title: reason.trim(), startsAt: event.startsAt, endsAt: event.endsAt, notes: event.notes,
        linkedScrimId: event.linkedScrimId, attendeeScope: 'custom', attendeeUserIds: people,
      })
      await window.api.teamSessionStart(session.id, [myUserId], null)
      await onChanged()
      toast({ title: t('teamSession.meeting.started'), variant: 'gold' })
    } catch (err) { fail(err) } finally { setBusy(false) }
  }

  const mark = async (userId: string, present: boolean) => {
    const next = attendance[userId] === present ? null : present
    setMarking(userId)
    try {
      await window.api.teamSessionSetAttendance(session.id, userId, next)
      setAttendance((prev) => {
        const copy = { ...prev }
        if (next === null) delete copy[userId]
        else copy[userId] = next
        return copy
      })
    } catch (err) { fail(err) } finally { setMarking(null) }
  }

  if (scheduled) {
    if (!canManage) return null
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">{t('teamSession.meeting.prepare')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="meeting-reason" className="text-xs font-medium text-hextech-text-dim">{t('teamSession.meeting.reason')}</label>
            <Input id="meeting-reason" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} placeholder={t('teamSession.meeting.reasonPlaceholder')} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-hextech-text-dim">{t('teamSession.meeting.people')}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.members.map((m) => {
                const on = people.includes(m.userId)
                return (
                  <button key={m.userId} type="button" aria-pressed={on}
                    onClick={() => setPeople((prev) => (on ? prev.filter((x) => x !== m.userId) : [...prev, m.userId]))}
                    className={cn('rounded px-2 py-1 text-xs', on ? 'bg-hextech-gold/30 text-hextech-gold-bright' : 'bg-hextech-elevated text-hextech-text-dim')}>
                    {m.displayName || m.riotId || '—'}
                    <span className="ml-1 font-mono text-[10px] uppercase opacity-70">{t(`coaching.roles.${m.role}`)}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <Button onClick={start} disabled={busy || !reason.trim() || people.length === 0} className="w-full">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {t('teamSession.meeting.start')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const ids = meetingPeople(event, group.members)
  const editable = canManage && session.status === 'live'
  const presentCount = ids.filter((id) => attendance[id] === true).length
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-hextech-gold" />{t('teamSession.meeting.presence')}
          <span className="font-mono text-xs font-normal text-hextech-text-dim">{presentCount}/{ids.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ids.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">{t('teamSession.meeting.noPeople')}</p>
        ) : (
          <ul className="space-y-1.5">
            {ids.map((id) => {
              const state = attendance[id]
              return (
                <li key={id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-hextech-text-bright">{nameOf(id)}</span>
                  {editable ? (
                    <span className="flex shrink-0 gap-1">
                      <Button size="sm" variant="outline" disabled={marking === id} aria-pressed={state === true}
                        className={cn('h-7 gap-1 px-2 text-xs', state === true && 'border-hextech-green/60 bg-hextech-green/15 text-hextech-green')}
                        onClick={() => mark(id, true)}>
                        <Check className="h-3 w-3" />{t('teamSession.meeting.present')}
                      </Button>
                      <Button size="sm" variant="outline" disabled={marking === id} aria-pressed={state === false}
                        className={cn('h-7 gap-1 px-2 text-xs', state === false && 'border-hextech-red/60 bg-hextech-red/15 text-hextech-red')}
                        onClick={() => mark(id, false)}>
                        <X className="h-3 w-3" />{t('teamSession.meeting.absent')}
                      </Button>
                    </span>
                  ) : (
                    <span className={cn('shrink-0 font-mono text-[10px] font-bold uppercase',
                      state === true ? 'text-hextech-green' : state === false ? 'text-hextech-red' : 'text-hextech-text-dim')}>
                      {state === true ? t('teamSession.meeting.present') : state === false ? t('teamSession.meeting.absent') : t('teamSession.meeting.unmarked')}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
