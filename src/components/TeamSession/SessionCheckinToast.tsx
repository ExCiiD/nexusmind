import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HeartPulse, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { localDateKey } from '@/lib/planningView'
import { cn } from '@/lib/utils'
import type { TeamSession } from '@/lib/teamSessions'

const ASKED_KEY = 'ascend:checkin-asked'
const AUTO_CLOSE_MS = 60_000
const SCALES = ['energy', 'mood', 'sleep'] as const

const asked = (): string[] => { try { return JSON.parse(localStorage.getItem(ASKED_KEY) ?? '[]') as string[] } catch { return [] } }
const markAsked = (id: string) => { try { localStorage.setItem(ASKED_KEY, JSON.stringify([...asked(), id].slice(-50))) } catch { /* private mode */ } }

/**
 * « Check-in avant la session ? » (docs/DESIGN_STATE.md § 18.3, L7): when one of my team sessions starts and I gave my
 * wellbeing consent, a wide toast bottom right (not a modal) with the three 1-5 scales and « Envoyer » / « Plus tard ».
 * Once per session; not when today's check-in is done; closes on its own after 60 s. Never mandatory, never blocking.
 */
export function SessionCheckinToast() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [session, setSession] = useState<TeamSession | null>(null)
  const [values, setValues] = useState<Record<(typeof SCALES)[number], number | null>>({ energy: null, mood: null, sleep: null })
  const [sending, setSending] = useState(false)
  const checking = useRef(false)

  useEffect(() => {
    if (!window.api.onTeamSessionLive || !window.api.wellbeingConsentGet) return
    const consider = async (list: TeamSession[] | null | undefined) => {
      const fresh = (list ?? []).find((s) => s.status === 'live' && !asked().includes(s.id))
      if (!fresh || checking.current) return
      checking.current = true
      try {
        markAsked(fresh.id)
        const consent = await window.api.wellbeingConsentGet().catch(() => null)
        if (consent?.status !== 'granted') return
        const [last] = await window.api.wellbeingListMine(1).catch(() => [])
        if (last && localDateKey(new Date(last.createdAt)) === localDateKey(new Date())) return
        setValues({ energy: null, mood: null, sleep: null })
        setSession(fresh)
      } finally { checking.current = false }
    }
    void window.api.teamSessionLiveCached?.().then(consider).catch(() => {})
    return window.api.onTeamSessionLive((list) => { void consider(list) })
  }, [])

  // Closes on its own after 60 s.
  useEffect(() => {
    if (!session) return
    const id = setTimeout(() => setSession(null), AUTO_CLOSE_MS)
    return () => clearTimeout(id)
  }, [session])

  if (!session) return null
  const ready = SCALES.every((k) => values[k] != null)
  const send = async () => {
    setSending(true)
    try {
      await window.api.wellbeingAddCheckin({ energy: values.energy!, mood: values.mood!, sleep: values.sleep!, note: null })
      toast({ title: t('wellbeing.saved', { defaultValue: 'Check-in saved' }), variant: 'gold' })
      setSession(null)
    } catch {
      toast({ title: t('checkinToast.failed'), variant: 'destructive' })
    } finally { setSending(false) }
  }

  return (
    <div role="dialog" aria-modal="false" aria-labelledby="checkin-toast-title"
      className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border border-hextech-gold/50 bg-hextech-dark p-4 shadow-2xl animate-fade-in">
      <div className="flex items-start justify-between gap-2">
        <h2 id="checkin-toast-title" className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright">
          <HeartPulse className="h-4 w-4 text-hextech-gold" />{t('checkinToast.title')}
        </h2>
        <button type="button" onClick={() => setSession(null)} aria-label={t('common.close')} className="text-hextech-text-dim hover:text-hextech-text-bright"><X className="h-4 w-4" /></button>
      </div>
      {SCALES.map((k) => (
        <div key={k} className="flex items-center gap-2">
          <span id={`checkin-${k}`} className="w-16 text-xs text-hextech-text">{t(`wellbeing.${k}`, { defaultValue: k })}</span>
          <div role="radiogroup" aria-labelledby={`checkin-${k}`} className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={values[k] === n} onClick={() => setValues((v) => ({ ...v, [k]: n }))}
                className={cn('h-7 w-7 rounded-full border text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold',
                  values[k] === n ? 'border-hextech-gold bg-hextech-gold text-hextech-black' : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border hover:text-hextech-text')}>
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setSession(null)}>{t('checkinToast.later')}</Button>
        <Button size="sm" disabled={!ready || sending} onClick={() => { void send() }}>{t('checkinToast.send')}</Button>
      </div>
    </div>
  )
}
