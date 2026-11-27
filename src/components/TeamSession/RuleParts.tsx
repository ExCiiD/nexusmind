import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { DuoFault } from '@/lib/microReview/objectiveRules'
import type { DuoSplit, PrioTally, RuleCounts } from '@/lib/objectiveRuleFigures'
import { FAULT_ORDER, RESOURCE_KEYS, prioSegments } from '@/lib/ruleView'
import type { PrioPill } from '@/lib/playerSessionStatsCore'

/** Pieces shared by the player-sheet card and the collective section 8 (docs/design/STATS_COLLECTIVES_EQUIPE.md A.1). */

export function PartlyEstimated() {
  const { t } = useTranslation()
  return <span className="rounded bg-hextech-elevated px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('prioRules.partlyEstimated')}</span>
}

/** Bar of one prio tally: sure · estimated · even · theirs · unknown (always this order). */
export function PrioBar({ tally, label, className }: { tally: PrioTally; label: string; className?: string }) {
  const s = prioSegments(tally)
  const seg = (n: number, cls: string, key: string) => (n > 0 ? <span key={key} className={cn('h-2 rounded-[2px]', cls)} style={{ flexGrow: n, flexBasis: 0 }} /> : null)
  return (
    <div role="img" aria-label={label} className={cn('flex h-2 gap-0.5', className)}>
      {s.total === 0 && <span className="h-2 flex-1 rounded-[2px] border border-dashed border-hextech-text-dim/50" />}
      {seg(s.sure, 'bg-hextech-gold', 'sure')}
      {seg(s.estimated, 'bg-hextech-gold/40', 'est')}
      {seg(s.even, 'bg-hextech-text-dim/40', 'even')}
      {seg(s.theirs, 'border border-hextech-red/80', 'theirs')}
      {seg(s.unknown, 'border border-dashed border-hextech-text-dim/60', 'unk')}
    </div>
  )
}

/** « 2 sûres · ≈ 1 estimée · 1 égal · 1 eux · 1 ? inconnue » (a zero stays visible, as in the mock-up). */
export function PrioLegend({ tally, className }: { tally: PrioTally; className?: string }) {
  const { t } = useTranslation()
  const s = prioSegments(tally)
  const items: Array<[string, string, string]> = [
    ['sure', t('prioRules.sure', { count: s.sure }), 'text-hextech-gold'],
    ['est', t('prioRules.estimated', { count: s.estimated }), 'text-hextech-gold/70'],
    ['even', t('prioRules.even', { count: s.even }), 'text-hextech-text-dim'],
    ['theirs', t('prioRules.theirs', { count: s.theirs }), 'text-hextech-red'],
    ['unk', t('prioRules.unknown', { count: s.unknown }), 'text-hextech-text-dim'],
  ]
  return (
    <p className={cn('flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px]', className)}>
      {items.map(([k, text, cls], i) => <span key={k} className={cls}>{i > 0 && <span className="mr-2 text-hextech-text-dim/60" aria-hidden>·</span>}{text}</span>)}
    </p>
  )
}

/** Resource chips: objectives given up where we took something (A.2: a count of objectives, not of plates). */
export function ResourceChips({ resources }: { resources: RuleCounts['crossmap']['resources'] }) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('prioRules.resourcesLabel')}>
      {RESOURCE_KEYS.map((k) => (
        <li key={k} className="rounded border border-hextech-border-dim bg-hextech-black/40 px-2 py-0.5 text-[11px] text-hextech-text">
          {t(`prioRules.res.${k}`)} <b className={cn('font-mono', resources[k] > 0 ? 'text-hextech-text-bright' : 'text-hextech-text-dim')}>{resources[k]}</b>
        </li>
      ))}
    </ul>
  )
}

/** Duo table: rows = who died × before / after 14:00, columns = whose fault. The row's `red` column (the shown player's own fault) is red when > 0. */
export function DuoTable({ rows, caption }: { rows: Array<{ label: string; split: DuoSplit['adcDeaths']; red: DuoFault | DuoFault[] | null }>; caption: string }) {
  const { t } = useTranslation()
  return (
    <div role="table" aria-label={caption} className="text-xs">
      <div role="row" className="grid grid-cols-[minmax(6rem,1fr)_repeat(4,3.4rem)] items-center gap-1 border-b border-hextech-border-dim pb-1 font-mono text-[9px] uppercase leading-tight tracking-wider text-hextech-text-dim sm:grid-cols-[minmax(6rem,1fr)_repeat(4,5.2rem)]">
        <span role="columnheader" className="sr-only">{caption}</span><span aria-hidden />
        {FAULT_ORDER.map((f) => <span key={f} role="columnheader" className="text-right">{t(`prioRules.fault.${f}`)}</span>)}
      </div>
      {rows.map((r) => (
        <div role="row" key={r.label} className="grid min-h-[28px] grid-cols-[minmax(6rem,1fr)_repeat(4,3.4rem)] items-center gap-1 border-b border-hextech-border-dim/50 sm:grid-cols-[minmax(6rem,1fr)_repeat(4,5.2rem)]">
          <span role="rowheader" className="truncate text-hextech-text">{r.label}</span>
          {FAULT_ORDER.map((f) => {
            const n = r.split[f]
            const red = n > 0 && ([] as Array<DuoFault | null>).concat(r.red).includes(f)
            return <span key={f} role="cell" className={cn('text-right font-mono tabular-nums', n === 0 ? 'text-hextech-text-dim' : red ? 'font-bold text-hextech-red' : 'font-bold text-hextech-text-bright')}>{n}</span>
          })}
        </div>
      ))}
    </div>
  )
}

export function Row({ label, value, tone, note }: { label: ReactNode; value: ReactNode; tone?: string; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
      <span className="text-hextech-text">{label}{note && <span className="ml-2 text-[11px] text-hextech-text-dim">{note}</span>}</span>
      <span className={cn('font-mono tabular-nums', tone ?? 'text-hextech-text-bright')}>{value}</span>
    </div>
  )
}

/** « prio nous / ≈ nous / eux / ? » and « crossmap ✓ / ✗ » pills of one objective of the list. Nothing when the event has no reading (after 20:00, or not exposed yet). */
export function RulePills({ prio: p, crossmap: cm }: { prio: PrioPill | null; crossmap: 'traded' | 'no-trade' | 'justified' | null }) {
  const { t } = useTranslation()
  const base = 'rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold'
  const gold = 'border-hextech-gold/40 bg-hextech-gold/10 text-hextech-gold'
  const red = 'border-hextech-red/50 bg-hextech-red/10 text-hextech-red'
  const dim = 'border-hextech-border-dim bg-hextech-elevated text-hextech-text-dim'
  const state = p ? (p.state === 'ours' ? (p.approx ? t('prioRules.pill.est') : '') + t('prioRules.pill.ours') : p.state === 'theirs' ? (p.approx ? t('prioRules.pill.est') : '') + t('prioRules.pill.theirs') : p.state === 'even' ? t('prioRules.pill.even') : t('prioRules.pill.unknown')) : null
  if (!p && !cm) return null
  return (
    <span className="flex gap-1.5">
      {p && <span className={cn(base, p.state === 'ours' ? gold : p.state === 'theirs' ? red : dim)}>{t('prioRules.pill.prio')} {state}</span>}
      {cm && <span className={cn(base, cm === 'traded' ? gold : cm === 'no-trade' ? red : dim)}>{cm === 'traded' ? t('prioRules.pill.crossOk') : cm === 'no-trade' ? t('prioRules.pill.crossKo') : t('prioRules.pill.crossJust')}</span>}
    </span>
  )
}
