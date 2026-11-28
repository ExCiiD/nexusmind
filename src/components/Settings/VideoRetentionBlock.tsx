import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { AGE_BOUNDS, SIZE_BOUNDS, clampInt } from '@/lib/videoRetentionView'
import type { VideoPurgePlan, VideoRetentionSettings, VideoRetentionStatus } from '@/lib/ipc'

/**
 * « Conservation des vidéos » — last block of Settings › Recording (docs/design/RETENTION_VIDEO.md).
 * Desktop only (no `videoRetentionGet` on the web). Per-PC setting; the first purge needs the player's yes (a dialog), after that rule
 * changes apply without asking. The preview (`videoRetentionPreview`) is refreshed 300 ms after each change; bounds are clamped on blur.
 */

const PREVIEW_DELAY_MS = 300
const BYTES_PER_GB = 1e9

type Plan = VideoPurgePlan
type Loaded = { settings: VideoRetentionSettings; plan: Plan; status: VideoRetentionStatus }
type Api = {
  videoRetentionGet?: () => Promise<Loaded>
  videoRetentionPreview?: (s: { maxAgeDays?: number | null; maxTotalGb?: number | null }) => Promise<Plan>
  videoRetentionSet?: (s: { enabled?: boolean; maxAgeDays?: number | null; maxTotalGb?: number | null }, confirm?: boolean) =>
    Promise<{ settings: VideoRetentionSettings; removed: number; freedBytes: number; status: VideoRetentionStatus }>
  getRecordingsDir?: () => Promise<string>
}
const api = () => window.api as unknown as Api

const KEEP_REASONS = ['clip', 'bookmark', 'mistake', 'review', 'recent', 'recording'] as const

export function VideoRetentionBlock() {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const supported = typeof api().videoRetentionGet === 'function'
  const [data, setData] = useState<Loaded | null>(null)
  const [dir, setDir] = useState('')
  const [ageOn, setAgeOn] = useState(false)
  const [age, setAge] = useState(String(AGE_BOUNDS.def))
  const [sizeOn, setSizeOn] = useState(false)
  const [size, setSize] = useState(String(SIZE_BOUNDS.def))
  /** The switch was turned on but nothing is saved yet (before the first purge's confirmation). */
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const nf = (n: number, d = 1) => n.toLocaleString(i18n.language, { maximumFractionDigits: d })
  const gb = (bytes: number) => nf(bytes / BYTES_PER_GB)

  const apply = useCallback((l: Loaded) => {
    setData(l)
    setAgeOn(l.settings.maxAgeDays != null); if (l.settings.maxAgeDays != null) setAge(String(l.settings.maxAgeDays))
    setSizeOn(l.settings.maxTotalGb != null); if (l.settings.maxTotalGb != null) setSize(String(l.settings.maxTotalGb))
  }, [])
  const reload = useCallback(async () => { const l = await api().videoRetentionGet?.(); if (l) apply(l) }, [apply])
  useEffect(() => {
    if (!supported) return
    void reload().catch(() => { /* the block stays hidden */ })
    api().getRecordingsDir?.().then(setDir).catch(() => {})
  }, [supported, reload])

  const active = data?.settings.enabled === true
  const confirmed = !!data?.settings.confirmedAt
  const rulesOf = (a = ageOn, z = sizeOn) => ({ maxAgeDays: a ? clampInt(age, AGE_BOUNDS.min, AGE_BOUNDS.max, AGE_BOUNDS.def) : null, maxTotalGb: z ? clampInt(size, SIZE_BOUNDS.min, SIZE_BOUNDS.max, SIZE_BOUNDS.def) : null })
  const rules = rulesOf()
  const hasRule = ageOn || sizeOn
  const showPreview = (pending || active) && hasRule

  // Preview 300 ms after each change (rules ticked / numbers typed).
  const [plan, setPlan] = useState<Plan | null>(null)
  useEffect(() => { if (data) setPlan(data.plan) }, [data])
  const key = `${rules.maxAgeDays}|${rules.maxTotalGb}`
  useEffect(() => {
    if (!showPreview) return
    const id = setTimeout(() => { api().videoRetentionPreview?.(rules).then(setPlan).catch(() => {}) }, PREVIEW_DELAY_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, showPreview])

  /** Saves the setting (`confirm` = the player's yes to the first purge, which then runs at once). */
  const save = async (enabled: boolean, confirm = false, r = rules) => {
    const set = api().videoRetentionSet
    if (!set) return null
    setBusy(true)
    try {
      const res = await set({ enabled, ...r }, confirm)
      await reload()
      return res
    } catch (err) {
      toast({ title: t('settings.retention.saveFailed'), description: (err as Error)?.message, variant: 'destructive' })
      return null
    } finally { setBusy(false) }
  }

  if (!supported || !data) return null

  const onSwitch = async (v: boolean) => {
    if (v) {
      const first = !ageOn && !sizeOn // nothing ticked yet: start with the age rule so the preview has something to show
      if (first) setAgeOn(true)
      if (confirmed) await save(true, false, rulesOf(first ? true : ageOn, sizeOn))
      else setPending(true)
    } else if (active) await save(false)
    else setPending(false)
  }
  /** Active: a rule change is saved at once (the confirmation only counts once); pending: only the preview moves. */
  const change = (a: boolean, z: boolean) => { setAgeOn(a); setSizeOn(z); if (active) void save(true, false, rulesOf(a, z)) }
  const blurred = () => { if (active) void save(true) }

  const lastRule = (own: boolean, other: boolean) => active && own && !other
  const doConfirm = async () => {
    const r = await save(true, true)
    setConfirming(false)
    if (r) { setPending(false); toast({ title: t('settings.retention.done', { count: r.removed, size: gb(r.freedBytes) }) }) }
  }

  const switchOn = active || pending
  const removable = plan?.remove.length ?? 0
  const kept = plan?.kept ?? []
  const keptBy = (reason: (typeof KEEP_REASONS)[number]) => kept.filter((k) => k.reason === reason).length
  const protectedBytes = kept.reduce((n, k) => n + k.sizeBytes, 0)
  const total = plan?.totalBytes ?? 0
  const keptRules = protectedBytes != null ? Math.max(0, total - (plan?.removeBytes ?? 0) - protectedBytes) : Math.max(0, total - (plan?.removeBytes ?? 0))
  const pctW = (n: number) => `${total > 0 ? (n / total) * 100 : 0}%`
  const last = data.status
  const lastDate = last.lastRunAt ? new Date(last.lastRunAt).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' }) : null

  return (
    <div className="space-y-3 border-t border-hextech-border-dim/40 pt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <label htmlFor="video-retention" className="text-sm font-medium text-hextech-text-bright">{t('settings.retention.title')}</label>
            <span className="rounded border border-hextech-border-dim px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('settings.retention.thisPc')}</span>
          </div>
          <p id="video-retention-desc" className="mt-0.5 text-xs text-hextech-text-dim">{t('settings.retention.desc')}</p>
        </div>
        <Switch id="video-retention" checked={switchOn} disabled={busy} onCheckedChange={(v) => { void onSwitch(v) }} aria-describedby="video-retention-desc" className="mt-0.5" />
      </div>

      <p className="font-mono text-xs text-hextech-text-dim">
        {plan && <><b className="text-hextech-text-bright">{t('settings.retention.recordings', { count: plan.totalCount })}</b> · </>}
        <b className="text-hextech-text-bright">{gb(total)} {t('settings.retention.gb')}</b> {t('settings.retention.onThisPc')}{dir && <> · {dir}</>}
      </p>

      <div className={cn('space-y-2', !switchOn && 'opacity-50')}>
        <RuleRow id="retention-age" checked={ageOn} disabled={!switchOn || lastRule(ageOn, sizeOn)} title={lastRule(ageOn, sizeOn) ? t('settings.retention.oneRule') : undefined}
          onChecked={(v) => change(v, sizeOn)} before={t('settings.retention.ageBefore')} after={t('settings.retention.ageAfter')}
          value={age} onChange={setAge} inputDisabled={!switchOn || !ageOn} label={t('settings.retention.ageLabel')}
          onBlur={() => { const n = clampInt(age, AGE_BOUNDS.min, AGE_BOUNDS.max, AGE_BOUNDS.def); setAge(String(n)); blurred() }} />
        <RuleRow id="retention-size" checked={sizeOn} disabled={!switchOn || lastRule(sizeOn, ageOn)} title={lastRule(sizeOn, ageOn) ? t('settings.retention.oneRule') : undefined}
          onChecked={(v) => change(ageOn, v)} before={t('settings.retention.sizeBefore')} after={t('settings.retention.sizeAfter')}
          value={size} onChange={setSize} inputDisabled={!switchOn || !sizeOn} label={t('settings.retention.sizeLabel')}
          onBlur={() => { const n = clampInt(size, SIZE_BOUNDS.min, SIZE_BOUNDS.max, SIZE_BOUNDS.def); setSize(String(n)); blurred() }} />
        <p className="text-[11px] text-hextech-text-dim">{t('settings.retention.bounds')}</p>
      </div>

      {pending && !hasRule && <p className="text-[11px] text-amber-400/90">{t('settings.retention.tickOne')}</p>}

      {showPreview && plan && (
        <div className="space-y-3 rounded-lg border border-hextech-border-dim bg-hextech-black/40 p-4" role="group" aria-label={t(pending ? 'settings.retention.previewPending' : 'settings.retention.previewActive')}>
          <p className="font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t(pending ? 'settings.retention.previewPending' : 'settings.retention.previewActive')}</p>
          {removable === 0 && active ? (
            <p className="text-sm font-semibold text-hextech-text-bright">{t('settings.retention.nothing')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
                <Figure value={String(kept.length)} label={t('settings.retention.protected', { count: kept.length })} />
                <Figure value={String(removable)} label={t('settings.retention.deletable', { count: removable })} tone="text-hextech-red" />
                <Figure value={`${gb(plan.removeBytes)} ${t('settings.retention.gb')}`} label={t(pending ? 'settings.retention.freed' : 'settings.retention.toFree')} />
              </div>
              <div role="img" aria-label={t('settings.retention.barLabel', { protected: protectedBytes != null ? gb(protectedBytes) : '–', kept: gb(keptRules), removed: gb(plan.removeBytes) })} className="flex h-2 gap-0.5">
                {protectedBytes != null && protectedBytes > 0 && <span className="rounded-sm bg-hextech-gold" style={{ width: pctW(protectedBytes) }} />}
                {keptRules > 0 && <span className="rounded-sm bg-hextech-text-dim/40" style={{ width: pctW(keptRules) }} />}
                {plan.removeBytes > 0 && <span className="rounded-sm border border-hextech-red/80" style={{ width: pctW(plan.removeBytes) }} />}
              </div>
              <p className="flex flex-wrap gap-x-4 font-mono text-[11px] text-hextech-text-dim">
                {protectedBytes != null && <span><i aria-hidden className="mr-1 inline-block h-1.5 w-1.5 bg-hextech-gold" />{t('settings.retention.legendProtected')} {gb(protectedBytes)} {t('settings.retention.gb')}</span>}
                <span><i aria-hidden className="mr-1 inline-block h-1.5 w-1.5 bg-hextech-text-dim/60" />{t('settings.retention.legendKept')} {gb(keptRules)} {t('settings.retention.gb')}</span>
                <span className="text-hextech-red"><i aria-hidden className="mr-1 inline-block h-1.5 w-1.5 border border-hextech-red" />{t('settings.retention.legendRemoved')} {gb(plan.removeBytes)} {t('settings.retention.gb')}</span>
              </p>
            </>
          )}
          {plan.capUnreachable && <p className="flex items-start gap-1.5 text-[11px] text-amber-400/90"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{t('settings.retention.capUnreachable')}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-hextech-text-dim">{t('settings.retention.never')}</span>
            {KEEP_REASONS.map((r) => (
              <span key={r} className="rounded border border-hextech-border-dim px-2 py-0.5 text-[11px] text-hextech-text">
                {t(`settings.retention.reason.${r}`)} <b className={cn('font-mono', keptBy(r) > 0 ? 'text-hextech-text-bright' : 'text-hextech-text-dim')}>{keptBy(r)}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {pending && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-hextech-text-dim">{t('settings.retention.nothingBefore')}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPending(false)}>{t('common.cancel')}</Button>
            <Button size="sm" variant="outline" className="border-hextech-gold text-hextech-gold-bright" disabled={!hasRule || busy} onClick={() => setConfirming(true)}>{t('settings.retention.activate')}</Button>
          </div>
        </div>
      )}
      {active && showPreview && <p className="text-[11px] text-hextech-text-dim">{lastDate ? `${t('settings.retention.last', { date: lastDate, count: last.lastRemoved, size: gb(last.lastFreedBytes) })} ` : ''}{t('settings.retention.checked')}</p>}

      <ConfirmPurge open={confirming} onOpenChange={setConfirming} plan={plan} dir={dir} rules={rules} gb={gb} busy={busy} onConfirm={() => { void doConfirm() }} />
    </div>
  )
}

function Figure({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div>
      <div className={cn('font-mono text-2xl font-bold tabular-nums', tone ?? 'text-hextech-text-bright')}>{value}</div>
      <div className="text-[11px] text-hextech-text-dim">{label}</div>
    </div>
  )
}

function RuleRow({ id, checked, disabled, title, onChecked, before, after, value, onChange, inputDisabled, onBlur, label }: {
  id: string; checked: boolean; disabled: boolean; title?: string; onChecked: (v: boolean) => void; before: string; after: string
  value: string; onChange: (v: string) => void; inputDisabled: boolean; onBlur: () => void; label: string
}) {
  return (
    <div className="flex items-center gap-3 text-sm text-hextech-text">
      <input id={id} type="checkbox" className="accent-hextech-gold" checked={checked} disabled={disabled} title={title} onChange={(e) => onChecked(e.target.checked)} />
      <label htmlFor={id}>{before}</label>
      <input type="text" inputMode="numeric" aria-label={label} value={value} disabled={inputDisabled} onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))} onBlur={onBlur}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="h-8 w-16 rounded-md border border-hextech-border-dim bg-hextech-elevated px-2 text-center font-mono text-sm text-hextech-text-bright disabled:opacity-60" />
      <span className="text-hextech-text-dim">{after}</span>
    </div>
  )
}

/** Single confirmation before the first purge: what goes, what stays, focus on Cancel. */
function ConfirmPurge({ open, onOpenChange, plan, dir, rules, gb, busy, onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void; plan: Plan | null; dir: string; rules: { maxAgeDays: number | null; maxTotalGb: number | null }
  gb: (b: number) => string; busy: boolean; onConfirm: () => void
}) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)
  if (!plan) return null
  const n = plan.remove.length
  const byAge = plan.remove.filter((r) => r.why === 'age').length
  const bySize = plan.remove.filter((r) => r.why === 'size').length
  const keptList = KEEP_REASONS.map((r) => ({ r, c: plan.kept.filter((k) => k.reason === r).length })).filter((x) => x.c > 0)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onOpenAutoFocus={(e) => { e.preventDefault(); cancelRef.current?.focus() }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-hextech-red/15 text-sm font-bold text-hextech-red">!</span>
            {t('settings.retention.confirmTitle', { count: n })}
          </DialogTitle>
          <DialogDescription>{t('settings.retention.confirmDesc', { size: gb(plan.removeBytes), dir: dir || t('settings.retention.thisPc') })}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-1.5 rounded-lg border border-hextech-border-dim bg-hextech-black/40 p-3 text-xs text-hextech-text">
          <div className="flex justify-between gap-3"><dt>{t('settings.retention.removed')}</dt><dd className="font-mono font-bold text-hextech-red">{n}</dd></div>
          {rules.maxAgeDays != null && <div className="flex justify-between gap-3 pl-3"><dt>{t('settings.retention.byAge', { days: rules.maxAgeDays })}</dt><dd className="font-mono font-bold text-hextech-text-bright">{byAge}</dd></div>}
          {rules.maxTotalGb != null && <div className="flex justify-between gap-3 pl-3"><dt>{t('settings.retention.bySize', { gb: rules.maxTotalGb })}</dt><dd className="font-mono font-bold text-hextech-text-bright">{bySize}</dd></div>}
          <div className="flex justify-between gap-3"><dt>{t('settings.retention.keptWord')}</dt>
            <dd className="font-mono"><b className="text-hextech-gold">{plan.kept.length}</b>{keptList.length > 0 && <span className="text-hextech-text-dim"> · {keptList.map((x) => `${x.c} ${t(`settings.retention.reasonPlural.${x.r}`, { count: x.c })}`).join(', ')}</span>}</dd></div>
        </dl>
        <p className="text-xs text-hextech-text-dim">{t('settings.retention.confirmNote')}</p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button ref={cancelRef} variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="destructive" disabled={busy || n === 0} onClick={onConfirm}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}{t('settings.retention.confirmAction', { count: n })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
