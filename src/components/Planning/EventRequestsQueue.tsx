import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Inbox, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey } from '@/lib/collab'
import type { CalendarEventRequest } from '@/lib/calendar'

/** Staff-visible queue of "request an event" submissions (Phase 1). */
export function EventRequestsQueue({ groupId, nameOf }: { groupId: string; nameOf: (id: string) => string }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [requests, setRequests] = useState<CalendarEventRequest[] | null>(null)

  const load = useCallback(() => {
    window.api.calendarListRequests(groupId).then(setRequests).catch(() => setRequests([]))
  }, [groupId])
  useEffect(() => { setRequests(null); load() }, [load])

  const pending = requests?.filter((r) => r.status === 'pending') ?? []
  if (requests !== null && pending.length === 0) return null

  const setStatus = async (id: string, status: 'accepted' | 'declined') => {
    try { await window.api.calendarSetRequestStatus(id, status); load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }
  const remove = async (id: string) => {
    try { await window.api.calendarDeleteRequest(id); load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  return (
    <div className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
      <h4 className="flex items-center gap-1.5 text-sm font-medium text-hextech-text-bright">
        <Inbox className="h-4 w-4 text-hextech-gold" />{t('planning.requestsQueue', { defaultValue: 'Event requests' })}
      </h4>
      <ul className="space-y-1.5">
        {pending.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded bg-hextech-elevated/30 px-2 py-1.5 text-xs">
            <div>
              <span className="font-medium text-hextech-text-bright">{r.eventName}</span>
              <span className="ml-1.5 text-hextech-text-dim">— {nameOf(r.requestedBy)}</span>
              {r.peopleConcerned.length > 0 && <div className="text-[10px] text-hextech-text-dim">{t('planning.attendees', { defaultValue: 'People concerned' })}: {r.peopleConcerned.join(', ')}</div>}
              {r.preferredStart && (
                <div className="text-[10px] text-hextech-text-dim">
                  {new Date(r.preferredStart).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}
                  {r.preferredEnd ? ` – ${new Date(r.preferredEnd).toLocaleString(i18n.language, { timeStyle: 'short' })}` : ''}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, 'accepted')} title={t('planning.requestAccept', { defaultValue: 'Accept' })}><Check className="h-3.5 w-3.5 text-hextech-green" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, 'declined')} title={t('planning.requestDecline', { defaultValue: 'Decline' })}><X className="h-3.5 w-3.5 text-[#E24C3A]" /></Button>
              <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" /></Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
