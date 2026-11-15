import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey } from '@/lib/collab'

/**
 * "Request an event" (Phase 1) — for players/analysts who can't edit the
 * calendar directly. Purely informational: never writes a real
 * CalendarEvent, just lands in the staff-visible EventRequestsQueue for a
 * calendar editor to act on by hand.
 */
export function RequestEventDialog({ groupId, onSent }: { groupId: string; onSent: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [eventName, setEventName] = useState('')
  const [peopleConcerned, setPeopleConcerned] = useState('')
  const [preferredStart, setPreferredStart] = useState('')
  const [preferredEnd, setPreferredEnd] = useState('')
  const [sending, setSending] = useState(false)

  const reset = () => { setEventName(''); setPeopleConcerned(''); setPreferredStart(''); setPreferredEnd('') }

  const send = async () => {
    if (!eventName.trim()) return
    setSending(true)
    try {
      await window.api.calendarCreateRequest(groupId, {
        eventName: eventName.trim(),
        peopleConcerned: peopleConcerned.split(',').map((s) => s.trim()).filter(Boolean),
        preferredStart: preferredStart ? new Date(preferredStart).toISOString() : null,
        preferredEnd: preferredEnd ? new Date(preferredEnd).toISOString() : null,
      })
      toast({ title: t('planning.requestSent', { defaultValue: 'Request sent to staff' }), variant: 'gold' })
      reset()
      setOpen(false)
      onSent()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Send className="mr-1 h-3.5 w-3.5" />{t('planning.requestEvent', { defaultValue: 'Request an event' })}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('planning.requestEvent', { defaultValue: 'Request an event' })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={eventName} onChange={(e) => setEventName(e.target.value)} maxLength={120} placeholder={t('planning.requestNamePlaceholder', { defaultValue: 'Event name…' })} />
          <Input value={peopleConcerned} onChange={(e) => setPeopleConcerned(e.target.value)} maxLength={400} placeholder={t('planning.requestPeoplePlaceholder', { defaultValue: 'People concerned (comma-separated)…' })} />
          <div className="flex gap-2">
            <Input type="datetime-local" value={preferredStart} onChange={(e) => setPreferredStart(e.target.value)} className="flex-1" aria-label={t('planning.requestPreferredStart', { defaultValue: 'Preferred start' })} />
            <Input type="datetime-local" value={preferredEnd} onChange={(e) => setPreferredEnd(e.target.value)} className="flex-1" aria-label={t('planning.requestPreferredEnd', { defaultValue: 'Preferred end' })} />
          </div>
          <p className="text-[11px] text-hextech-text-dim">{t('planning.requestHint', { defaultValue: 'Informational only — staff will arrange the actual event.' })}</p>
        </div>
        <DialogFooter>
          <Button onClick={send} disabled={!eventName.trim() || sending}>{t('planning.requestSend', { defaultValue: 'Send request' })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
