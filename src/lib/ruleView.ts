import type { CrossmapSplit, DuoSplit, PrioTally, RuleCounts } from '@/lib/objectiveRuleFigures'
import { RULE_KINDS } from '@/lib/objectiveRuleFigures'
import type { DuoFault, RuleKind } from '@/lib/microReview/objectiveRules'
import type { ObjectiveEvent, PrioPill } from '@/lib/playerSessionStatsCore'

/**
 * What the « Prio, crossmap & duo » card (player sheet) and section (collective block) show, from the Back-end `RuleCounts`
 * (docs/design/STATS_COLLECTIVES_EQUIPE.md, addendum A.1-A.5). Pure re-grouping: nothing is recomputed, a missing value is null (« — »).
 */

export { RULE_KINDS }
export const FAULT_ORDER: readonly DuoFault[] = ['support', 'adc', 'shared', 'none']
/** The side each neutral objective sits on (the label « Drakes · bot »). */
export const KIND_SIDE: Record<RuleKind, 'bot' | 'top'> = { dragon: 'bot', elder: 'bot', grubs: 'top', herald: 'top', baron: 'top' }
/** The Riot roles of the sheets, and the ones the contract names (BOTTOM / UTILITY / MIDDLE). */
export type RuleRole = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'
export function ruleRoleOf(role: string | undefined): RuleRole | null {
  const r = (role ?? '').toUpperCase()
  if (r === 'TOP' || r === 'JUNGLE') return r
  if (r === 'MID' || r === 'MIDDLE') return 'MID'
  if (r === 'ADC' || r === 'BOTTOM' || r === 'BOT') return 'ADC'
  if (r === 'SUPPORT' || r === 'UTILITY') return 'SUPPORT'
  return null
}

/** Segments of a prio bar, in the fixed order sure · estimated · even · theirs · unknown (A.1). */
export interface PrioSegments { sure: number; estimated: number; even: number; theirs: number; unknown: number; total: number; ours: number }
export function prioSegments(t: PrioTally): PrioSegments {
  const sure = t.oursProven, estimated = t.ours - t.oursProven
  return { sure, estimated, even: t.even, theirs: t.theirs, unknown: t.unknown, total: t.ours + t.even + t.theirs + t.unknown, ours: t.ours }
}
export const sumTallies = (list: PrioTally[]): PrioTally => list.reduce((a, t) => ({ ours: a.ours + t.ours, oursProven: a.oursProven + t.oursProven, even: a.even + t.even, theirs: a.theirs + t.theirs, unknown: a.unknown + t.unknown }), { ours: 0, oursProven: 0, even: 0, theirs: 0, unknown: 0 })
export const pctOf = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null)

/** The prio of the side lane and of the mid over every objective read. */
export function sidePrio(r: RuleCounts): { side: PrioTally; mid: PrioTally; n: number } {
  return { side: sumTallies(RULE_KINDS.map((k) => r.prio.byKind[k].side)), mid: sumTallies(RULE_KINDS.map((k) => r.prio.byKind[k].mid)), n: r.prio.objectives }
}

export interface Hero {
  /** i18n key suffix of the title and of the caption. */
  id: 'adc' | 'top' | 'mid' | 'jungle' | 'support' | 'team'
  num: number
  den: number
  tally: PrioTally | null
}
/** The figure put forward for the role (A.2). */
export function heroOf(r: RuleCounts, role: RuleRole | null): Hero {
  const own = r.prio.own
  switch (role) {
    case 'ADC': return { id: 'adc', num: own.tally.ours, den: own.n, tally: own.tally }
    case 'TOP': return { id: 'top', num: own.tally.ours, den: own.n, tally: own.tally }
    case 'MID': return { id: 'mid', num: own.tally.ours, den: own.n, tally: own.tally }
    case 'JUNGLE': return { id: 'jungle', num: r.prio.jungle.sidePrio + r.prio.jungle.midPrioOnly, den: r.prio.jungle.engaged, tally: null }
    case 'SUPPORT': return { id: 'support', num: r.prio.support.helped, den: r.prio.support.total, tally: null }
    default: { const s = sidePrio(r); return { id: 'team', num: s.side.ours, den: s.n, tally: s.side } }
  }
}

export const splitTotals = (r: RuleCounts) => {
  const a = r.crossmap.before14, b = r.crossmap.after14
  return { uncontested: a.uncontested + b.uncontested, traded: a.traded + b.traded, noTrade: a.noTrade + b.noTrade, justified: a.justified + b.justified }
}
export const crossmapOf = (s: CrossmapSplit) => ({ ...s, withCrossmap: s.traded })

export const duoTotal = (d: DuoSplit, who: 'adcDeaths' | 'supDeaths') => FAULT_ORDER.reduce((n, f) => n + d[who][f], 0)
export function duoDeaths(r: RuleCounts, who: 'adcDeaths' | 'supDeaths'): number {
  return duoTotal(r.duo.before14, who) + duoTotal(r.duo.after14, who)
}

export const RESOURCE_KEYS = ['objective', 'plates', 'towers', 'kills', 'invade', 'numbers'] as const

/** Nothing to read: no objective on the side before 20:00 and none given up (A.4). */
export const nothingToRead = (r: RuleCounts) => r.prio.objectives === 0 && r.crossmap.objectivesTheirs === 0

/** Summary of the closed section: prio of the side lane · crossmap traded / uncontested · duo ADC deaths. */
export function ruleSummary(r: RuleCounts) {
  const s = sidePrio(r)
  const c = splitTotals(r)
  return { prioPct: pctOf(s.side.ours, s.n), traded: c.traded, uncontested: c.uncontested, adcDeaths: duoDeaths(r, 'adcDeaths') }
}

/**
 * Pills of one objective of the list (design A.2 / L): the lane that counts for the role (the mid for the mid, the objective's side lane
 * for the others) and the crossmap verdict of an uncontested objective taken by them. Null prio = « — » (after 20:00, tower, no block).
 */
export function eventPills(e: Pick<ObjectiveEvent, 'prio' | 'prioMid' | 'crossmap'>, role: string | undefined): { prio: PrioPill | null; crossmap: 'traded' | 'no-trade' | 'justified' | null } {
  return { prio: (ruleRoleOf(role) === 'MID' ? e.prioMid : e.prio) ?? null, crossmap: e.crossmap ?? null }
}

export interface OwnSplitRow { key: 'team' | 'soloQ'; num: number; n: number; pct: number | null }
/**
 * The own-lane figure (top / ADC) split team / soloQ, team first. Null unless the session mixes both contexts, and for the other roles.
 * The headline (`prio.own`) is the sum of the two (Back-end contract), so the rows always add up to it.
 */
export function ownSplitOf(r: RuleCounts, role: RuleRole | null): OwnSplitRow[] | null {
  if (role !== 'TOP' && role !== 'ADC') return null
  const ctxs = (['team', 'soloQ'] as const).map((key) => ({ key, f: r.byContext?.[key] }))
  if (!ctxs.every((c) => (c.f?.games ?? 0) > 0)) return null
  return ctxs.map((c) => ({ key: c.key, num: c.f!.own.tally.ours, n: c.f!.own.n, pct: pctOf(c.f!.own.tally.ours, c.f!.own.n) }))
}
