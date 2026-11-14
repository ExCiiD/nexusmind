import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Loader2, Plus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { cn } from '@/lib/utils'
import { collabErrorKey } from '@/lib/collab'
import type { DevPlan, NewAxisInput } from '@/lib/devPlan'

interface Props {
  groupId: string
  /** Plan owner. In staff mode this is the player being coached; in player mode it is always the signed-in user. */
  playerId: string
  mode: 'staff' | 'player'
}

/** E3 (docs/PLAN_GESTION_EQUIPE.md): one quarterly dev plan per (group, player), shared desktop/web. */
export function DevPlanCard({ groupId, playerId, mode }: Props) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const fundamentals = useLocalizedFundamentals()
  const allFundamentals = useMemo(() => fundamentals.flatMap((c) => c.fundamentals.map((f) => ({ id: f.id, label: f.label }))), [fundamentals])
  const labelOf = (id: string) => allFundamentals.find((f) => f.id === id)?.label ?? id

  const [plan, setPlan] = useState<DevPlan | null | undefined>(undefined)

  const load = useCallback(async () => {
    setPlan(undefined)
    try {
      const p = mode === 'staff' ? await window.api.devPlanGetForPlayer(groupId, playerId) : await window.api.devPlanGetMine(groupId)
      setPlan(p)
    } catch (err) {
      setPlan(null)
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [groupId, playerId, mode, t, toast])

  useEffect(() => { load() }, [load])

  if (plan === undefined) return <Loader2 className="h-5 w-5 animate-spin text-hextech-text-dim" />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-5 w-5 text-hextech-gold" />{t('devPlan.title', { defaultValue: 'Development plan' })}
        </CardTitle>
        <CardDescription>{t('devPlan.desc', { defaultValue: '2-3 focus axes for the quarter, with progress and 1:1 notes.' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {plan === null ? (
          mode === 'staff'
            ? <CreatePlanForm groupId={groupId} playerId={playerId} allFundamentals={allFundamentals} onCreated={load} />
            : <p className="text-sm text-hextech-text-dim">{t('devPlan.none', { defaultValue: 'No development plan yet.' })}</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-medium text-hextech-text-bright">{plan.title}</h3>
              {(plan.periodStart || plan.periodEnd) && (
                <span className="text-xs text-hextech-text-dim">
                  {plan.periodStart ?? '…'} → {plan.periodEnd ?? '…'}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {plan.axes.map((axis) => (
                <AxisRow key={axis.id} axis={axis} mode={mode} label={labelOf(axis.fundamentalId)} onChanged={load} />
              ))}
            </div>
            <CheckinSection planId={plan.id} checkins={plan.checkins} locale={i18n.language} mode={mode} onAdded={load} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function AxisRow({ axis, mode, label, onChanged }: { axis: DevPlan['axes'][number]; mode: 'staff' | 'player'; label: string; onChanged: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [note, setNote] = useState(axis.progress?.playerNote ?? '')
  const [saving, setSaving] = useState(false)

  const setStatus = async (status: 'active' | 'done' | 'dropped') => {
    try {
      await window.api.devPlanSetAxisStatus(axis.id, status)
      onChanged()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }

  const toggleDone = async () => {
    try {
      await window.api.devPlanSetProgress(axis.id, { playerMarkedDone: !axis.progress?.playerMarkedDone })
      onChanged()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }

  const saveNote = async () => {
    setSaving(true)
    try {
      await window.api.devPlanSetProgress(axis.id, { playerNote: note.trim() || null })
      onChanged()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-hextech-gold">{label}</span>
          <p className="text-sm text-hextech-text">{axis.targetText}</p>
        </div>
        {mode === 'staff' ? (
          <Select value={axis.status} onValueChange={(v) => setStatus(v as 'active' | 'done' | 'dropped')}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t('devPlan.status.active', { defaultValue: 'Active' })}</SelectItem>
              <SelectItem value="done">{t('devPlan.status.done', { defaultValue: 'Done' })}</SelectItem>
              <SelectItem value="dropped">{t('devPlan.status.dropped', { defaultValue: 'Dropped' })}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', axis.status === 'done' ? 'bg-hextech-green/10 text-hextech-green' : axis.status === 'dropped' ? 'bg-hextech-text-dim/10 text-hextech-text-dim' : 'bg-hextech-gold/10 text-hextech-gold')}>
            {t(`devPlan.status.${axis.status}`)}
          </span>
        )}
      </div>
      {mode === 'player' && (
        <div className="space-y-2 pt-1">
          <label className="flex items-center gap-2 text-sm text-hextech-text">
            <input type="checkbox" checked={axis.progress?.playerMarkedDone ?? false} onChange={toggleDone} className="h-4 w-4 accent-hextech-gold" />
            {t('devPlan.markedDone', { defaultValue: 'I consider this done' })}
          </label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
            placeholder={t('devPlan.notePlaceholder', { defaultValue: 'How is it going? (visible to your coach)' })} />
          <Button size="sm" variant="outline" onClick={saveNote} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('devPlan.saveNote', { defaultValue: 'Save note' })}
          </Button>
        </div>
      )}
      {mode === 'staff' && axis.progress?.playerNote && (
        <p className="rounded bg-hextech-elevated/30 p-2 text-xs italic text-hextech-text-dim">{axis.progress.playerNote}</p>
      )}
    </div>
  )
}

function CheckinSection({ planId, checkins, locale, mode, onAdded }: { planId: string; checkins: DevPlan['checkins']; locale: string; mode: 'staff' | 'player'; onAdded: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)

  const add = async () => {
    if (!note.trim()) return
    setAdding(true)
    try {
      await window.api.devPlanAddCheckin(planId, note.trim())
      setNote('')
      onAdded()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-hextech-border-dim pt-3">
      <h4 className="text-sm font-medium text-hextech-text-bright">{t('devPlan.checkins', { defaultValue: '1:1 check-ins' })}</h4>
      {checkins.length > 0 && (
        <ul className="space-y-1 text-xs text-hextech-text-dim">
          {checkins.map((c) => (
            <li key={c.id}><span className="text-hextech-text">{new Date(c.createdAt).toLocaleDateString(locale)}</span> — {c.note}</li>
          ))}
        </ul>
      )}
      {mode === 'staff' && (
        <div className="flex gap-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={1} maxLength={4000} className="flex-1" placeholder={t('devPlan.checkinPlaceholder', { defaultValue: 'Note from the 1:1…' })} />
          <Button size="sm" onClick={add} disabled={adding || !note.trim()}>
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}
    </div>
  )
}

function CreatePlanForm({ groupId, playerId, allFundamentals, onCreated }: {
  groupId: string; playerId: string; allFundamentals: { id: string; label: string }[]; onCreated: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [axes, setAxes] = useState<NewAxisInput[]>([{ fundamentalId: '', targetText: '', position: 1 }])
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [creating, setCreating] = useState(false)

  const setAxis = (i: number, patch: Partial<NewAxisInput>) =>
    setAxes((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))

  const addAxis = () => setAxes((prev) => (prev.length >= 3 ? prev : [...prev, { fundamentalId: '', targetText: '', position: (prev.length + 1) as 1 | 2 | 3 }]))

  const canCreate = title.trim().length > 0 && axes.every((a) => a.fundamentalId && a.targetText.trim())

  const create = async () => {
    setCreating(true)
    try {
      await window.api.devPlanCreate(groupId, playerId, title.trim(), axes.map((a) => ({ ...a, targetText: a.targetText.trim() })),
        { periodStart: periodStart || null, periodEnd: periodEnd || null })
      toast({ title: t('devPlan.created', { defaultValue: 'Plan created' }), variant: 'gold' })
      onCreated()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="flex-1 min-w-[12rem]" placeholder={t('devPlan.titlePlaceholder', { defaultValue: 'e.g. Q1 2027 focus' })} />
        <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" aria-label={t('devPlan.periodStart', { defaultValue: 'Period start' })} />
        <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-40" aria-label={t('devPlan.periodEnd', { defaultValue: 'Period end' })} />
      </div>
      {axes.map((axis, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <Select value={axis.fundamentalId} onValueChange={(v) => setAxis(i, { fundamentalId: v })}>
            <SelectTrigger className="w-56"><SelectValue placeholder={t('devPlan.pickFundamental', { defaultValue: 'Pick a fundamental' })} /></SelectTrigger>
            <SelectContent>
              {allFundamentals.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input value={axis.targetText} onChange={(e) => setAxis(i, { targetText: e.target.value })} maxLength={500} className="flex-1 min-w-[12rem]"
            placeholder={t('devPlan.targetPlaceholder', { defaultValue: 'Target for this axis…' })} />
        </div>
      ))}
      {axes.length < 3 && (
        <Button size="sm" variant="outline" onClick={addAxis}><Plus className="mr-1 h-3.5 w-3.5" />{t('devPlan.addAxis', { defaultValue: 'Add axis' })}</Button>
      )}
      <Button size="sm" onClick={create} disabled={!canCreate || creating}>
        {creating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('devPlan.create', { defaultValue: 'Create plan' })}
      </Button>
    </div>
  )
}
