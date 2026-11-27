import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { RuleCounts } from '@/lib/objectiveRuleFigures'
import { duoDeaths, heroOf, nothingToRead, ownSplitOf, pctOf, ruleRoleOf, splitTotals, type RuleRole } from '@/lib/ruleView'
import { Section, WhyEmpty, useIndivView, useReason, type IndivCtx } from './PlayerIndivBlocks'
import { DuoTable, PartlyEstimated, PrioBar, PrioLegend, ResourceChips, Row } from './RuleParts'

/**
 * « Prio, crossmap & duo » card of the player sheet, under « Objective participation » (docs/design/STATS_COLLECTIVES_EQUIPE.md A.2).
 * Counts only, no tag. The figure put forward depends on the role; a missing value reads « — », never 0.
 */

const PREFIX = 'prioRules'

export function PlayerRulesCard(ctx: IndivCtx) {
  const { t } = useTranslation()
  const { single, g, tot } = useIndivView(ctx)
  const reason = useReason(ctx)
  const role = ruleRoleOf(ctx.role)
  const rules: RuleCounts | null = (single ? g?.objectiveRules : tot?.objectiveRules) ?? null
  const roleLabel = t(`${PREFIX}.role.${role ?? 'none'}`)
  const headerOf = (state: 'noTimeline' | 'partial' | 'nothing' | null) => (
    <span className="flex items-center gap-2">
      <PartlyEstimated />
      <span className="font-mono text-[11px] text-hextech-text-dim">{state ? t(`${PREFIX}.state.${state}`) : `${ctx.indiv?.displayName ?? ''}${role ? ` · ${roleLabel}` : ''}`}</span>
    </span>
  )
  // Games of the sheet that have no timeline (the figures come from the others).
  const without = single ? [] : (ctx.indiv?.games ?? []).filter((x) => x.timelineStatus !== 'ready').map((x) => x.gameIndex)
  const withTl = (ctx.indiv?.games ?? []).length - without.length

  if (!rules) {
    return (
      <Section title={t(`${PREFIX}.title`)} right={headerOf('noTimeline')}>
        {/* A game with a timeline but no block is an older cache: the same words, the figure is unknown. */}
        <div className="rounded-md border border-hextech-border-dim bg-hextech-black/40 px-3 py-2">
          <WhyEmpty text={reason?.text ?? t(`${PREFIX}.noTimeline`)} action={reason?.action} onAction={ctx.onExtract} busy={ctx.extracting} />
        </div>
      </Section>
    )
  }

  const empty = nothingToRead(rules)
  const hero = heroOf(rules, role)
  const own = rules.prio.own
  const jungle = rules.prio.jungle
  const cm = splitTotals(rules)
  const dash = '—'
  const heroFigure = hero.den > 0 ? `${hero.num} / ${hero.den}` : dash
  const heroPct = pctOf(hero.num, hero.den)
  const lane = own.lane ? t(`${PREFIX}.lane.${own.lane}`) : ''
  const split = ownSplitOf(rules, role)
  const showCrossmap = rules.crossmap.objectivesTheirs > 0
  const judgedRole = role === 'MID' || role === 'JUNGLE' || role === 'SUPPORT'
  const duoRole: RuleRole | null = role === 'ADC' || role === 'SUPPORT' ? role : null

  return (
    <Section title={t(`${PREFIX}.title`)} right={headerOf(empty ? 'nothing' : without.length > 0 ? 'partial' : null)}>
      {/* Figure put forward */}
      <div className="rounded-md border border-hextech-border-dim bg-hextech-black/40 px-3 py-2.5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t(`${PREFIX}.hero.${hero.id}`)}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tabular-nums text-hextech-text-bright">{heroFigure}</span>
          {heroPct != null && <span className="font-mono text-[11px] text-hextech-text-dim">{heroPct} %</span>}
        </p>
        {hero.den > 0 && hero.tally && (
          <>
            <PrioBar tally={hero.tally} label={t(`${PREFIX}.hero.${hero.id}`)} className="mt-2" />
            <PrioLegend tally={hero.tally} className="mt-1.5" />
          </>
        )}
        {hero.den > 0 && role === 'JUNGLE' && (
          <p className="mt-1.5 font-mono text-[11px] text-hextech-text-dim">
            {t(`${PREFIX}.jungleSplit`, { side: jungle.sidePrio, mid: jungle.midPrioOnly })} · <span className="text-hextech-red">{t(`${PREFIX}.jungleNone`, { count: jungle.noPrio })}</span>{jungle.noPrio > 0 && ` (${t(`${PREFIX}.jungleTaken`, { count: jungle.noPrioTaken })})`}
          </p>
        )}
        {hero.den > 0 && role === 'SUPPORT' && <p className="mt-1.5 font-mono text-[11px] text-hextech-text-dim">{t(`${PREFIX}.supportNote`)}</p>}
        {hero.den > 0 && hero.tally && lane && (role === 'ADC' || role === 'TOP') && <p className="mt-1 font-mono text-[11px] text-hextech-text-dim">{t(`${PREFIX}.heroLane`, { lane })}</p>}
        {hero.den === 0 && <p className="mt-1 text-xs text-hextech-text-dim">{t(`${PREFIX}.nothing.${hero.id}`)}</p>}
        {/* The top and ADC figure, split team / soloQ when the session mixes both (decision 8 of the engine report), team first. */}
        {split && (
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-hextech-border-dim pt-2 font-mono text-[11px]" aria-label={t(`${PREFIX}.splitLabel`)}>
            {split.map((x) => (
              <li key={x.key} className="text-hextech-text-dim">{t(`${PREFIX}.ctx.${x.key}`)} <b className="ml-1 text-sm text-hextech-text-bright">{x.n > 0 ? `${x.num} / ${x.n}` : dash}</b>{x.pct != null && <span className="ml-1">{x.pct} %</span>}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Jungle: started on the losing side */}
      {!empty && role === 'JUNGLE' && jungle.engaged > 0 && (
        <>
          <Row label={t(`${PREFIX}.wrongSide`)} value={<>{jungle.wrongSide}{jungle.wrongSide > 0 && <> · <span className="text-hextech-red">{t(`${PREFIX}.lost`, { count: jungle.wrongSideLost })}</span></>}</>} />
          <p className="text-[11px] text-hextech-text-dim">{t(`${PREFIX}.wrongSideHint`)}</p>
        </>
      )}

      {/* Duo botlane */}
      {!empty && duoRole === 'ADC' && (
        <>
          <SectionTitle text={t(`${PREFIX}.duoAdc`)} right={t(`${PREFIX}.duoAway`)} />
          <DuoTable caption={t(`${PREFIX}.duoAdc`)} rows={[
            { label: t(`${PREFIX}.before14`), split: rules.duo.before14.adcDeaths, red: 'adc' },
            { label: t(`${PREFIX}.after14`), split: rules.duo.after14.adcDeaths, red: 'adc' },
          ]} />
          <Row label={t(`${PREFIX}.advances`)} value={<>{rules.duo.advances}{rules.duo.advances > 0 && <> · <span className="text-hextech-red">{t(`${PREFIX}.advancesDied`, { count: rules.duo.advancesDied })}</span></>}</>} />
        </>
      )}
      {!empty && duoRole === 'SUPPORT' && (
        <>
          <SectionTitle text={t(`${PREFIX}.duoSup`)} />
          <DuoTable caption={t(`${PREFIX}.duoSup`)} rows={[
            { label: `${t(`${PREFIX}.yourAdc`)} · ${t(`${PREFIX}.before14`)}`, split: rules.duo.before14.adcDeaths, red: 'support' },
            { label: `${t(`${PREFIX}.yourAdc`)} · ${t(`${PREFIX}.after14`)}`, split: rules.duo.after14.adcDeaths, red: 'support' },
            { label: `${t(`${PREFIX}.you`)} · ${t(`${PREFIX}.before14`)}`, split: rules.duo.before14.supDeaths, red: 'support' },
            { label: `${t(`${PREFIX}.you`)} · ${t(`${PREFIX}.after14`)}`, split: rules.duo.after14.supDeaths, red: 'support' },
          ]} />
        </>
      )}

      {/* Crossmap */}
      {!empty && judgedRole && (
        <>
          <SectionTitle text={t(`${PREFIX}.crossTitle`)} right={t(`${PREFIX}.beforeAfter`)} />
          {showCrossmap
            ? (
              <>
                <Row label={t(`${PREFIX}.youCrossed`)} value={<>{rules.crossmap.before14.crossed} / {rules.crossmap.before14.judged}<span className="mx-2 text-hextech-text-dim">·</span>{rules.crossmap.after14.crossed} / {rules.crossmap.after14.judged}</>} />
                {role !== 'MID' && <Row label={t(`${PREFIX}.justified`)} value={cm.justified} />}
                <ResourceChips resources={rules.crossmap.resources} />
                <p className="text-[11px] text-hextech-text-dim">{t(`${PREFIX}.resourcesNote`)}</p>
              </>
            )
            : <Row label={t(`${PREFIX}.youCrossed`)} value={dash} note={t(`${PREFIX}.noGivenUp`)} />}
        </>
      )}
      {!empty && !judgedRole && (
        <>
          <SectionTitle text={t(`${PREFIX}.teamCross`)} right={t(`${PREFIX}.notJudged`, { role: roleLabel })} />
          <Row label={t(`${PREFIX}.uncontestedTraded`)} value={showCrossmap ? `${cm.traded} / ${cm.uncontested}` : dash} />
        </>
      )}

      {/* Nothing to read at all, or a note on the games without timeline */}
      {empty && duoRole && <Row label={t(`${PREFIX}.duoShort`)} value={t(`${PREFIX}.duoNone`, { count: duoDeaths(rules, 'adcDeaths') + (duoRole === 'SUPPORT' ? duoDeaths(rules, 'supDeaths') : 0) })} />}
      {without.length > 0 && (
        <p className="rounded-md border border-hextech-gold/30 bg-hextech-gold/10 px-2.5 py-1.5 font-mono text-[11px] text-hextech-gold">
          {t(`${PREFIX}.partial`, { ready: withTl, games: withTl + without.length, list: without.map((n) => `G${n}`).join(', ') })}
        </p>
      )}
      <p className={cn('text-[11px] text-hextech-text-dim')}>{t(`${PREFIX}.footnote`, { count: rules.games })}</p>
    </Section>
  )
}

function SectionTitle({ text, right }: { text: string; right?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
      <h4 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{text}</h4>
      {right && <span className="font-mono text-[10px] text-hextech-text-dim">{right}</span>}
    </div>
  )
}
