import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { RuleCounts } from '@/lib/objectiveRuleFigures'
import { KIND_SIDE, RULE_KINDS, duoDeaths, nothingToRead, ruleSummary, sidePrio, splitTotals } from '@/lib/ruleView'
import { DuoTable, PartlyEstimated, PrioBar, PrioLegend, ResourceChips } from './RuleParts'

/**
 * Section 8 « Prio, crossmap & duo » of the collective block (docs/design/STATS_COLLECTIVES_EQUIPE.md A.3-A.4).
 * `rules` = SessionCollective.rules or GameCollective.rules; null without a timeline.
 */

export function RulesSummary({ rules, timelineNeeded }: { rules: RuleCounts | null; timelineNeeded: boolean }) {
  const { t } = useTranslation()
  if (!rules) return <>{timelineNeeded ? t('prioRules.timelineNeeded') : '—'}</>
  if (nothingToRead(rules)) return <>{t('prioRules.nothingShort')}</>
  const s = ruleSummary(rules)
  const bold = (v: string | number) => <b className="font-bold text-hextech-text-bright">{v}</b>
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
      <span>{t('prioRules.sumPrio')} {s.prioPct == null ? '—' : bold(`${s.prioPct} %`)}</span>
      <span>· {t('prioRules.sumCross')} {s.uncontested > 0 ? bold(`${s.traded} / ${s.uncontested}`) : '—'}</span>
      <span>· {t('prioRules.sumDuo', { count: s.adcDeaths })}</span>
      <PartlyEstimated />
    </span>
  )
}

function Sub({ title, right }: { title: string; right?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
      <h4 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-hextech-gold">{title}</h4>
      {right && <span className="font-mono text-[10px] text-hextech-text-dim">{right}</span>}
    </div>
  )
}

export function RulesSection({ rules, noTimeline, games, duoNames }: { rules: RuleCounts; noTimeline: number[]; games: number; duoNames?: { adc?: string; support?: string } }) {
  const { t } = useTranslation()
  const j = rules.prio.jungle
  const cm = splitTotals(rules)
  const dash = '—'
  const hasPrio = rules.prio.objectives > 0
  const chip = (label: string, val: string, tone?: string) => (
    <li className="rounded border border-hextech-border-dim bg-hextech-black/40 px-2 py-1 text-xs text-hextech-text">{label} <b className={cn('font-mono', tone ?? 'text-hextech-gold')}>{val}</b></li>
  )
  const cols = [{ key: 'before14', label: t('prioRules.before14Col') }, { key: 'after14', label: t('prioRules.after14Col') }] as const
  const crossRows: Array<{ key: string; label: string; val: (s: typeof rules.crossmap.before14) => number; tone: (n: number) => string }> = [
    { key: 'unc', label: t('prioRules.uncontested'), val: (s) => s.uncontested, tone: () => 'text-hextech-text-bright' },
    { key: 'traded', label: `→ ${t('prioRules.withCrossmap')}`, val: (s) => s.traded, tone: () => 'text-hextech-gold' },
    { key: 'none', label: `→ ${t('prioRules.withNothing')}`, val: (s) => s.noTrade, tone: (n) => (n > 0 ? 'text-hextech-red' : 'text-hextech-text-dim') },
    { key: 'just', label: `→ ${t('prioRules.justifiedShort')}`, val: (s) => s.justified, tone: () => 'text-hextech-text-dim' },
  ]
  const sp = sidePrio(rules)
  return (
    <div className="space-y-3">
      {/* 1 · Prio at the climax, by objective */}
      <Sub title={t('prioRules.climaxTitle')} right={t('prioRules.until20')} />
      {hasPrio
        ? (
          <>
            <div role="table" aria-label={t('prioRules.climaxTitle')} className="text-xs">
              <div role="row" className="hidden grid-cols-[8rem_3rem_1fr_1fr] items-center gap-2 border-b border-hextech-border-dim pb-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim sm:grid">
                <span role="columnheader">{t('prioRules.colObjective')}</span><span role="columnheader" className="text-right">{t('prioRules.colRead')}</span>
                <span role="columnheader">{t('prioRules.colSide')}</span><span role="columnheader">Mid</span>
              </div>
              {RULE_KINDS.map((k) => {
                const b = rules.prio.byKind[k]
                return (
                  <div role="row" key={k} className="grid min-h-[34px] grid-cols-[1fr_2.5rem] items-center gap-x-2 gap-y-1 border-b border-hextech-border-dim/50 py-1.5 sm:grid-cols-[8rem_3rem_1fr_1fr] sm:py-0">
                    <span role="rowheader" className={b.n === 0 ? 'text-hextech-text-dim' : 'text-hextech-text'}>{t(`prioRules.kind.${k}`)} · {KIND_SIDE[k]}</span>
                    <span role="cell" className={cn('text-right font-mono tabular-nums', b.n === 0 ? 'text-hextech-text-dim' : 'font-bold text-hextech-text-bright')}>{b.n}</span>
                    {([b.side, b.mid] as const).map((tl, i) => (
                      <span role="cell" key={i} className="col-span-2 flex items-center gap-2 sm:col-span-1">
                        <span className="w-14 shrink-0 text-[10px] uppercase text-hextech-text-dim sm:hidden" aria-hidden>{i === 0 ? t('prioRules.colSide') : 'Mid'}</span>
                        {b.n === 0 ? <span className="text-hextech-text-dim">{dash}</span> : (
                          <>
                            <PrioBar tally={tl} label={`${t(`prioRules.kind.${k}`)} · ${i === 0 ? t('prioRules.colSide') : 'Mid'}`} className="min-w-0 flex-1" />
                            <span className="font-mono tabular-nums text-hextech-text-bright">{tl.ours} / {b.n}</span>
                          </>
                        )}
                      </span>
                    ))}
                  </div>
                )
              })}
            </div>
            <PrioLegend tally={sp.side} />
            <p className="text-[11px] text-hextech-text-dim">{t('prioRules.legendNote')}</p>
          </>
        )
        : <p className="text-xs text-hextech-text-dim">{t('prioRules.nothing.team')}</p>}

      {/* 2 · Jungle */}
      <Sub title={t('prioRules.jungleTitle')} right={j.engaged > 0 ? t('prioRules.engagedCount', { count: j.engaged }) : undefined} />
      {j.engaged > 0
        ? (
          <ul className="flex flex-wrap gap-2">
            {chip(t('prioRules.withSidePrio'), String(j.sidePrio))}
            {chip(t('prioRules.midOnly'), String(j.midPrioOnly))}
            {chip(t('prioRules.noPrio'), String(j.noPrio), 'text-hextech-red')}
            {chip(t('prioRules.losingSide'), String(j.wrongSide), 'text-hextech-red')}
          </ul>
        )
        : <p className="text-xs text-hextech-text-dim">{dash} · {t('prioRules.noEngaged')}</p>}
      {j.engaged > 0 && (j.noPrio > 0 || j.wrongSide > 0) && (
        <p className="text-[11px] text-hextech-text-dim">{t('prioRules.jungleDetail', { taken: j.noPrioTaken, lost: j.wrongSideLost })}</p>
      )}

      {/* 3 · Objectives taken by them */}
      <Sub title={t('prioRules.theirsTitle')} right={rules.crossmap.objectivesTheirs > 0 ? t('prioRules.theirsCount', { taken: rules.crossmap.objectivesTheirs, contested: rules.crossmap.contested, uncontested: cm.uncontested }) : undefined} />
      {rules.crossmap.objectivesTheirs > 0
        ? (
          <>
            <div role="table" aria-label={t('prioRules.theirsTitle')} className="text-xs">
              <div role="row" className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2 border-b border-hextech-border-dim pb-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim sm:grid-cols-[12rem_6rem_6rem]">
                <span /><>{cols.map((c) => <span key={c.key} role="columnheader" className="text-right">{c.label}</span>)}</>
              </div>
              {crossRows.map((r) => (
                <div role="row" key={r.key} className="grid min-h-[30px] grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2 border-b border-hextech-border-dim/50 sm:grid-cols-[12rem_6rem_6rem]">
                  <span role="rowheader" className="text-hextech-text">{r.label}</span>
                  {cols.map((c) => { const n = r.val(rules.crossmap[c.key]); return <span key={c.key} role="cell" className={cn('text-right font-mono font-bold tabular-nums', r.tone(n))}>{n}</span> })}
                </div>
              ))}
            </div>
            <ResourceChips resources={rules.crossmap.resources} />
          </>
        )
        : <p className="text-xs text-hextech-text-dim">{dash} · {t('prioRules.noneGivenUp')}</p>}

      {/* 4 · Bot duo */}
      <Sub title={t('prioRules.duoTitle')} right={duoNames?.adc || duoNames?.support ? [duoNames.adc && `${duoNames.adc} (ADC)`, duoNames.support && `${duoNames.support} (support)`].filter(Boolean).join(' · ') : undefined} />
      <DuoTable caption={t('prioRules.duoTitle')} rows={[
        { label: `${t('prioRules.adcDeaths')} · ${t('prioRules.before14')}`, split: rules.duo.before14.adcDeaths, red: ['support', 'adc'] },
        { label: `${t('prioRules.adcDeaths')} · ${t('prioRules.after14')}`, split: rules.duo.after14.adcDeaths, red: ['support', 'adc'] },
        { label: `${t('prioRules.supDeaths')} · ${t('prioRules.before14')}`, split: rules.duo.before14.supDeaths, red: ['support', 'adc'] },
        { label: `${t('prioRules.supDeaths')} · ${t('prioRules.after14')}`, split: rules.duo.after14.supDeaths, red: ['support', 'adc'] },
      ]} />
      <p className="text-xs text-hextech-text">
        {t('prioRules.advancesTeam')} <b className="font-mono text-hextech-text-bright">{rules.duo.advances}</b>
        {rules.duo.advances > 0 && <> · <span className="text-hextech-red">{t('prioRules.advancesDied', { count: rules.duo.advancesDied })}</span></>}
      </p>

      {noTimeline.length > 0 && (
        <p className="rounded-md border border-hextech-gold/30 bg-hextech-gold/10 px-2.5 py-1.5 font-mono text-[11px] text-hextech-gold">
          {t('prioRules.partial', { ready: games - noTimeline.length, games, list: noTimeline.map((n) => `G${n}`).join(', ') })}
        </p>
      )}
      <p className="text-[11px] text-hextech-text-dim">{t('prioRules.footnoteTeam', { count: rules.games, deaths: duoDeaths(rules, 'adcDeaths') + duoDeaths(rules, 'supDeaths') })}</p>
    </div>
  )
}
