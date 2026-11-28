import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  TIERS, TIER_OPACITY, fmtClock, pipsOf, tierSegments,
  type MistakeOccurrence, type MistakeTier, type TierCounts, type TierFilter, type TierKey, type TierReason,
} from '@/lib/mistakeInsights'

/**
 * Tier marks of the Mistake Lab (docs/design/TIERS_ERREURS_LABO.md): the family hue never changes, the tier is the opacity
 * (100 / 60 / 30 %) doubled by pips; trivial = outline only; unknown = grey.
 */

/** Neutral gold used for the legend swatches, so they do not suggest a family. */
export const LEGEND_COLOR = '#D4A24C'
const UNKNOWN_COLOR = '#978769'

const tierLabelKey = (t: MistakeTier) => `mistakeLab.tier.name.${t}` as const

/** One segmented bar: segments in the fixed order fatal → critical → medium → trivial → unknown, 2 px apart. `width` = share of the track (0–1). */
export function TierBar({ counts, color, width = 1, height = 12, label, tooltip = false, className }: {
  counts: TierCounts; color: string; width?: number; height?: number; label: string; tooltip?: boolean; className?: string
}) {
  const segs = tierSegments(counts)
  return (
    <span className={cn('group relative flex min-w-0 items-center', className)} style={{ width: `${Math.max(4, width * 100)}%` }}>
      <span role="img" aria-label={label} className="flex w-full gap-0.5" style={{ height }}>
        {segs.map((sg, i) => {
          const first = i === 0, last = i === segs.length - 1
          const round = cn(first && 'rounded-l-sm', last && 'rounded-r-sm')
          if (sg.tier === 'unknown') return <span key="u" className={round} style={{ flexGrow: sg.n, flexBasis: 0, backgroundColor: UNKNOWN_COLOR, opacity: 0.3 }} />
          if (sg.tier === 'trivial') return <span key="t" className={round} style={{ flexGrow: sg.n, flexBasis: 0, border: `1.5px solid ${color}`, boxSizing: 'border-box' }} />
          return <span key={sg.tier} className={round} style={{ flexGrow: sg.n, flexBasis: 0, backgroundColor: color, opacity: TIER_OPACITY[sg.tier] }} />
        })}
      </span>
      {tooltip && <TierTooltip counts={counts} />}
    </span>
  )
}

/** Hover / keyboard-focus detail of a bar (the same information is in the bar's aria-label). */
function TierTooltip({ counts }: { counts: TierCounts }) {
  const { t } = useTranslation()
  return (
    <span aria-hidden className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden min-w-[9rem] rounded-lg border border-hextech-border bg-hextech-dark px-2.5 py-1.5 font-mono text-[11px] shadow-lg group-hover:block group-focus-within:block">
      {([...TIERS, 'unknown'] as TierKey[]).filter((k) => counts[k] > 0).map((k) => (
        <span key={k} className={cn('flex items-center gap-2', k === 'fatal' ? 'font-bold text-hextech-text-bright' : 'text-hextech-text-dim')}>
          <span className="w-9 text-hextech-gold">{k === 'unknown' ? '?' : pipsOf(k)}</span>{counts[k]} {t(`mistakeLab.tier.plural.${k}`, { count: counts[k] })}
        </span>
      ))}
    </span>
  )
}

/** « 2 fatales · 4 critiques · 6 moyennes » (the tiers that have at least one). */
export function tierLine(counts: TierCounts, t: (k: string, o?: Record<string, unknown>) => string): string {
  return ([...TIERS, 'unknown'] as TierKey[]).filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${t(`mistakeLab.tier.plural.${k}`, { count: counts[k] })}`).join(' · ')
}

/** aria-label of a bar: « 13 fois : 2 fatales, 4 critiques… ». */
export function barLabel(count: number, counts: TierCounts, t: (k: string, o?: Record<string, unknown>) => string): string {
  return `${t('mistakeLab.tier.barCount', { count })} : ${tierLine(counts, t).split(' · ').join(', ')}`
}

/** Pill of one moment: tier + reason. Fatal in the family colour (full), critical at 60 %, medium and trivial grey; unknown « ? ». */
export function TierPill({ o, color }: { o: Pick<MistakeOccurrence, 'tier' | 'tierReason'>; color: string }) {
  const { t, i18n } = useTranslation()
  const tier = o.tier ?? null
  if (!tier) {
    return <span className="inline-flex items-center gap-1.5 rounded border border-hextech-border-dim px-1.5 py-0.5 text-[10px] text-hextech-text-dim"><b aria-hidden>?</b>{t('mistakeLab.tier.unknownReason')}</span>
  }
  const reason = o.tierReason ? reasonText(o.tierReason, t, i18n.language) : null
  const tone = tier === 'fatal' ? { borderColor: color, backgroundColor: `${color}26` } : tier === 'critical' ? { borderColor: `${color}99`, backgroundColor: `${color}14` } : undefined
  return (
    <span aria-label={t(tierLabelKey(tier))} style={tone}
      className={cn('inline-flex max-w-full items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px]', !tone && 'border-hextech-border-dim', tier === 'trivial' && !tone && 'border-dashed')}>
      <span aria-hidden className="shrink-0 font-mono tracking-tight" style={{ color: tier === 'fatal' || tier === 'critical' ? color : undefined, opacity: tier === 'critical' ? 0.8 : 1 }}>{pipsOf(tier)}</span>
      <span className={cn('shrink-0', tier === 'fatal' ? 'font-bold text-hextech-text-bright' : tier === 'critical' ? 'font-semibold text-hextech-text-bright' : 'text-hextech-text-dim')}>{t(tierLabelKey(tier))}</span>
      {reason && <span className="min-w-0 truncate text-hextech-text-dim">· {reason}</span>}
    </span>
  )
}

/** « −1 200 gold d'équipe en 2 min », « après une fatale à 24:10 »… (no distance, rule of 20/11). */
export function reasonText(r: TierReason, t: (k: string, o?: Record<string, unknown>) => string, lang: string): string {
  const nf = (n: number) => `−${Math.abs(Math.round(n)).toLocaleString(lang)}`
  switch (r.kind) {
    case 'team-gap': return t('mistakeLab.tier.reason.teamGap', { gold: nf(r.gold ?? 0), minutes: Math.round(r.minutes ?? 0) })
    case 'lane-gap': return t('mistakeLab.tier.reason.laneGap', { gold: nf(r.gold ?? 0), minutes: Math.round(r.minutes ?? 0) })
    case 'team-snowball':
      return r.fromGold != null && r.toGold != null
        ? t('mistakeLab.tier.reason.snowballFromTo', { minutes: Math.round(r.minutes ?? 0), from: signedGold(r.fromGold, lang), to: signedGold(r.toGold, lang) })
        : t('mistakeLab.tier.reason.snowball', { minutes: Math.round(r.minutes ?? 0) })
    case 'lane-snowball':
      return r.fromGold != null && r.toGold != null
        ? t('mistakeLab.tier.reason.laneSnowballFromTo', { minutes: Math.round(r.minutes ?? 0), from: signedGold(r.fromGold, lang), to: signedGold(r.toGold, lang) })
        : t('mistakeLab.tier.reason.laneSnowball', { minutes: Math.round(r.minutes ?? 0) })
    case 'deficit': return t('mistakeLab.tier.reason.deficit', { gold: Math.abs(Math.round(r.gold)).toLocaleString(lang) })
    case 'after-fatal': return t('mistakeLab.tier.reason.afterFatal', { clock: fmtClock(r.afterSec ?? 0) })
    case 'precedes': return t('mistakeLab.tier.reason.precedes', { tier: t(`mistakeLab.tier.name.${r.chainTier ?? 'fatal'}`).toLowerCase(), clock: fmtClock(r.atSec ?? 0) })
    case 'garbage': return t('mistakeLab.tier.reason.garbage')
  }
}
const signedGold = (n: number, lang: string) => `${n < 0 ? '−' : '+'}${Math.abs(Math.round(n)).toLocaleString(lang)}`

/** Second row of chips under the families: « Tous les tiers · ●●● Fatales 7 · … » (combinable with the family filter). */
export function TierChips({ value, onChange, counts, showTrivial }: { value: TierFilter; onChange: (v: TierFilter) => void; counts: TierCounts; showTrivial: boolean }) {
  const { t } = useTranslation()
  const chip = (active: boolean) => cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
    active ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border')
  const tiers = TIERS.filter((x) => x !== 'trivial' || showTrivial)
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('mistakeLab.tier.filter')}>
      <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('mistakeLab.tier.label')}</span>
      <button type="button" aria-pressed={value === 'all'} onClick={() => onChange('all')} className={chip(value === 'all')}>{t('mistakeLab.tier.all')}</button>
      {tiers.map((x) => (
        <button key={x} type="button" aria-pressed={value === x} onClick={() => onChange(x)} className={chip(value === x)} aria-label={`${t(`mistakeLab.tier.plural.${x}`, { count: 2 })} ${counts[x]}`}>
          <span aria-hidden className="font-mono text-[9px] tracking-tight text-hextech-gold">{pipsOf(x)}</span>
          {t(`mistakeLab.tier.chip.${x}`)} <span className="text-hextech-text-dim">{counts[x]}</span>
        </button>
      ))}
    </div>
  )
}

/** Legend line above the colour explanation: four swatches in neutral gold with pips and names. */
export function TierLegend({ showTrivial }: { showTrivial: boolean }) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-hextech-text">
      {TIERS.filter((x) => x !== 'trivial' || showTrivial).map((x) => (
        <li key={x} className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-5 rounded-sm" style={x === 'trivial' ? { border: `1.5px solid ${LEGEND_COLOR}` } : { backgroundColor: LEGEND_COLOR, opacity: TIER_OPACITY[x] }} />
          <b className="font-semibold text-hextech-text-bright">{t(tierLabelKey(x))}</b> <span className="text-hextech-text-dim">{t(`mistakeLab.tier.rule.${x}`)}</span>
        </li>
      ))}
    </ul>
  )
}
