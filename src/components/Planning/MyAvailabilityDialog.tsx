import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey } from '@/lib/collab'
import { localDateKey } from '@/lib/planningView'
import type { AvailabilityException, AvailabilityRule } from '@/lib/calendar'
import { cn } from '@/lib/utils'
import { TimeSelect, hmToMin, minToHm } from './TimeSelect'
import { invalidateGroupCalendar } from '@/lib/groupQueries'

type DayMode = 'usual' | 'available' | 'unavailable'
interface DayState { mode: DayMode; start: number; end: number; note: string }

const MODES: DayMode[] = ['usual', 'available', 'unavailable']
const MODE_STYLE: Record<DayMode, string> = {
  usual: 'bg-hextech-elevated text-hextech-text-bright',
  available: 'bg-hextech-green/[0.18] text-hextech-green',
  unavailable: 'bg-hextech-red/[0.18] text-hextech-red',
}

interface EditorProps {
  groupId: string
  days: Date[]
  myRules: AvailabilityRule[]
  myExceptions: AvailabilityException[]
  onSaved: () => void
}

/**
 * "My availability" (#36, DESIGN_STATE § 8): the keyboard path to what the
 * grid's availability rail does with the mouse. One row per day of the shown
 * week: Usual (no exception) / Available (one slot — the database keeps one
 * exception per player, group and date) / Unavailable (+ note).
 * Saving upserts one exception per changed day and deletes the exceptions of
 * days set back to "Usual". In a dialog on the Planning; in the page in
 * « Mon espace » (§ 16), where saving is enabled once a row changes.
 */
export function MyAvailabilityDialog({ open, onOpenChange, ...editor }: EditorProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="max-h-[90vh] max-w-[760px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('planning.myAvailability.title')}</DialogTitle>
          <DialogDescription>{t('planning.myAvailability.desc')}</DialogDescription>
        </DialogHeader>
        {open && (
          <MyAvailabilityEditor
            {...editor}
            onSaved={() => { editor.onSaved(); onOpenChange(false) }}
            onCancel={() => onOpenChange(false)}
            onSavingChange={setSaving}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The rows and the save button, without a dialog (« Mon espace »). */
export function MyAvailabilityEditor({ groupId, days, myRules, myExceptions, onSaved, onCancel, onSavingChange }: EditorProps & {
  /** In a dialog: the Cancel button. In a page there is none. */
  onCancel?: () => void
  onSavingChange?: (saving: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const initial = useMemo(() => {
    const next: Record<string, DayState> = {}
    for (const d of days) {
      const key = localDateKey(d)
      const ex = myExceptions.find((e) => e.date === key)
      const rule = myRules.find((r) => r.weekday === d.getDay())
      const base = { start: rule ? hmToMin(rule.startTime) : 19 * 60, end: rule ? hmToMin(rule.endTime) || 1440 : 23 * 60 }
      next[key] = !ex
        ? { mode: 'usual', ...base, note: '' }
        : ex.available
          ? { mode: 'available', start: ex.startTime ? hmToMin(ex.startTime) : base.start, end: ex.endTime ? hmToMin(ex.endTime) || 1440 : base.end, note: '' }
          : { mode: 'unavailable', ...base, note: ex.note ?? '' }
    }
    return next
  }, [days, myExceptions, myRules])
  const [state, setState] = useState<Record<string, DayState>>(initial)
  const [saving, setSaving] = useState(false)

  // (Re)load from the current exceptions when they change (a save, another week).
  useEffect(() => { setState(initial) }, [initial])
  useEffect(() => { onSavingChange?.(saving) }, [saving, onSavingChange])

  const update = (key: string, patch: Partial<DayState>) => setState((s) => ({ ...s, [key]: { ...s[key], ...patch } }))
  const invalidKeys = Object.entries(state).filter(([, v]) => v.mode === 'available' && v.end <= v.start).map(([k]) => k)
  const dirty = JSON.stringify(state) !== JSON.stringify(initial)

  const save = async () => {
    if (invalidKeys.length > 0) return
    setSaving(true)
    try {
      for (const d of days) {
        const key = localDateKey(d)
        const v = state[key]
        if (!v) continue
        const existing = myExceptions.find((e) => e.date === key)
        if (v.mode === 'usual') {
          if (existing) await window.api.availabilityDeleteException(existing.id)
        } else if (v.mode === 'available') {
          await window.api.availabilitySetException(groupId, { date: key, available: true, startTime: minToHm(v.start), endTime: minToHm(v.end), note: null })
        } else {
          await window.api.availabilitySetException(groupId, { date: key, available: false, startTime: null, endTime: null, note: v.note.trim() || null })
        }
      }
      toast({ title: t('planning.myAvailability.saved'), variant: 'gold' })
      invalidateGroupCalendar(groupId) // perf gain 3: every cached copy of the availabilities refetches
      onSaved()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const dayLabel = (d: Date) => d.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' })
  const usualText = (d: Date) => {
    const r = myRules.filter((x) => x.weekday === d.getDay())
    return r.length
      ? t('planning.myAvailability.usualRule', { slots: r.map((x) => `${x.startTime}–${x.endTime}`).join(', ') })
      : t('planning.myAvailability.noUsual')
  }

  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save() }}>
      {days.map((d) => {
        const key = localDateKey(d)
        const v = state[key]
        if (!v) return null
        const legendId = `avail-${key}`
        const invalid = invalidKeys.includes(key)
        return (
          <fieldset key={key} className="flex flex-wrap items-center gap-3 rounded-lg border border-hextech-border-dim px-3 py-2">
            <legend id={legendId} className="sr-only">{d.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</legend>
            <span aria-hidden className="w-[72px] shrink-0 font-mono text-xs font-bold uppercase text-hextech-text-bright">{dayLabel(d)}</span>
            <ModeGroup labelledBy={legendId} value={v.mode} onChange={(mode) => update(key, { mode })} />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {v.mode === 'usual' && <span className="text-xs text-hextech-text-dim">{usualText(d)}</span>}
              {v.mode === 'available' && (
                <>
                  <TimeSelect id={`${key}-start`} value={v.start} to={1425} onChange={(m) => update(key, { start: m })}
                    labelledBy={`${legendId} ${key}-start-label`} />
                  <span id={`${key}-start-label`} className="sr-only">{t('planning.popup.start')}</span>
                  <span aria-hidden className="text-hextech-text-dim">→</span>
                  <TimeSelect id={`${key}-end`} value={v.end} from={15} to={1440} onChange={(m) => update(key, { end: m })}
                    invalid={invalid} describedBy={invalid ? `${key}-err` : undefined} labelledBy={`${legendId} ${key}-end-label`} />
                  <span id={`${key}-end-label`} className="sr-only">{t('planning.popup.end')}</span>
                  {invalid && <span id={`${key}-err`} className="w-full text-xs text-hextech-red">{t('planning.popup.endBeforeStart', { time: minToHm(v.start) })}</span>}
                </>
              )}
              {v.mode === 'unavailable' && (
                <Input value={v.note} maxLength={200} onChange={(e) => update(key, { note: e.target.value })}
                  placeholder={t('planning.myAvailability.notePlaceholder')} aria-label={t('planning.myAvailability.noteLabel')} className="h-8 max-w-xs text-xs" />
              )}
            </div>
          </fieldset>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hextech-border-dim pt-3">
        <p className="text-xs text-hextech-text-dim">{t('planning.myAvailability.keysHint')}</p>
        <div className="flex gap-2">
          {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>{t('common.cancel')}</Button>}
          <Button type="submit" disabled={saving || invalidKeys.length > 0 || (!onCancel && !dirty)} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t('planning.myAvailability.save')}
          </Button>
        </div>
      </div>
    </form>
  )
}

/** Usual / Available / Unavailable as a radio group: Tab enters it, ← / → change the choice. */
function ModeGroup({ value, onChange, labelledBy }: { value: DayMode; onChange: (m: DayMode) => void; labelledBy: string }) {
  const { t } = useTranslation()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = (i + delta + MODES.length) % MODES.length
    onChange(MODES[next])
    refs.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex shrink-0 overflow-hidden rounded-md border border-hextech-border-dim">
      {MODES.map((m, i) => {
        const checked = value === m
        return (
          <button
            key={m}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(m)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hextech-gold',
              checked ? MODE_STYLE[m] : 'text-hextech-text-dim hover:text-hextech-text',
            )}
          >
            {t(`planning.myAvailability.mode.${m}`)}
          </button>
        )
      })}
    </div>
  )
}
