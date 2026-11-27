/**
 * Session figures of the prio / crossmap / duo rules (docs/moteur/engine-reports/2026-11-27-prio-crossmap-duo.md § 4.1, 4.2).
 * Pure and ADDITIVE: one `RuleCounts` per game (for a player, or for the whole team), summed over a session with
 * `addRuleCounts`. Nothing here asks Riot for anything: the block is read from the summary (`TimelinePlayers.objectiveRules`),
 * null when a game has none (the figure is then unknown, never 0).
 */
import {
  OBJECTIVE_RULES_SPEC, type DuoDeath, type DuoFault, type ObjectiveRuleEntry, type ObjectiveRulesBlock, type RuleKind,
} from './microReview/objectiveRules'

export const RULE_KINDS: readonly RuleKind[] = ['dragon', 'elder', 'grubs', 'herald', 'baron']
const FAULTS: readonly DuoFault[] = ['support', 'adc', 'shared', 'none']

/** How the prio of one lane read over a set of objectives (`oursProven`: of `ours`, those proven or probable, the rest being suggested). */
export interface PrioTally { ours: number; oursProven: number; even: number; theirs: number; unknown: number }
export interface DuoSplit {
  /** Our ADC's deaths (or our support's) while the partner was away, by who is at fault. */
  adcDeaths: Record<DuoFault, number>
  supDeaths: Record<DuoFault, number>
}
export interface CrossmapSplit {
  /** Objectives taken by them that nobody of ours contested. */
  uncontested: number
  traded: number
  noTrade: number
  justified: number
  /** The player's own verdict (jungler, mid, support only): objectives judged / crossed. */
  judged: number
  crossed: number
}

export interface RuleCounts {
  /** Games added into these counts. */
  games: number
  prio: {
    /** Objectives read (a climax window, before 20:00). */
    objectives: number
    byKind: Record<RuleKind, { n: number; side: PrioTally; mid: PrioTally }>
    /** The lane the role holds on the objective's side: top for TOP on top-side objectives, bot for the ADC on dragons, mid for the mid. Null for a team figure and for the jungler / support. */
    own: { lane: 'TOP' | 'MID' | 'BOT' | null; n: number; tally: PrioTally }
    /** The jungler (the player, or the team's) started an objective: with the prio of the side lane, of the mid only, or none. */
    jungle: { engaged: number; sidePrio: number; midPrioOnly: number; noPrio: number; noPrioTaken: number; wrongSide: number; wrongSideLost: number }
    /** The support was on the side lane or the mid in the 90 s before the objective. */
    support: { total: number; helped: number }
  }
  crossmap: {
    objectivesTheirs: number
    contested: number
    resources: { objective: number; plates: number; towers: number; kills: number; invade: number; numbers: number }
    before14: CrossmapSplit
    after14: CrossmapSplit
  }
  duo: {
    before14: DuoSplit
    after14: DuoSplit
    advances: number
    advancesDied: number
  }
}

const tally = (): PrioTally => ({ ours: 0, oursProven: 0, even: 0, theirs: 0, unknown: 0 })
const faults = (): Record<DuoFault, number> => ({ support: 0, adc: 0, shared: 0, none: 0 })
const split = (): CrossmapSplit => ({ uncontested: 0, traded: 0, noTrade: 0, justified: 0, judged: 0, crossed: 0 })
const duoSplit = (): DuoSplit => ({ adcDeaths: faults(), supDeaths: faults() })

export function emptyRuleCounts(): RuleCounts {
  return {
    games: 0,
    prio: {
      objectives: 0,
      byKind: Object.fromEntries(RULE_KINDS.map((k) => [k, { n: 0, side: tally(), mid: tally() }])) as RuleCounts['prio']['byKind'],
      own: { lane: null, n: 0, tally: tally() },
      jungle: { engaged: 0, sidePrio: 0, midPrioOnly: 0, noPrio: 0, noPrioTaken: 0, wrongSide: 0, wrongSideLost: 0 },
      support: { total: 0, helped: 0 },
    },
    crossmap: { objectivesTheirs: 0, contested: 0, resources: { objective: 0, plates: 0, towers: 0, kills: 0, invade: 0, numbers: 0 }, before14: split(), after14: split() },
    duo: { before14: duoSplit(), after14: duoSplit(), advances: 0, advancesDied: 0 },
  }
}

function put(t: PrioTally, l: ObjectiveRuleEntry['mid']): void {
  if (l.state === 'ours') { t.ours++; if (l.proof === 'proven' || l.proof === 'probable') t.oursProven++ } else t[l.state]++
}

const OWN_LANE: Record<string, 'TOP' | 'MID' | 'BOT'> = { TOP: 'TOP', MIDDLE: 'MID', BOTTOM: 'BOT' }

/**
 * The counts of one game. `pid` = the player (their own lane, their crossmap verdict), or null for the whole team.
 * Null when the game has no block (or one of an older version).
 */
export function ruleCountsOf(block: ObjectiveRulesBlock | null | undefined, pid: number | null): RuleCounts | null {
  if (!block || block.v !== OBJECTIVE_RULES_SPEC.version) return null
  const P = OBJECTIVE_RULES_SPEC.prio
  const role = pid == null ? null : block.roles.find((r) => r.pid === pid)?.role ?? null
  if (pid != null && role == null) return null
  const c = emptyRuleCounts()
  c.games = 1
  const ownLane = role ? OWN_LANE[role] ?? null : null
  c.prio.own.lane = ownLane

  for (const o of block.objectives) {
    // ── Prio (read at the climax, until 20:00) ──
    if (o.window && o.refSec <= P.untilSec) {
      c.prio.objectives++
      const k = c.prio.byKind[o.kind]
      k.n++
      put(k.side, o.sideLane); put(k.mid, o.mid)
      if (ownLane === 'MID') { c.prio.own.n++; put(c.prio.own.tally, o.mid) }
      else if (ownLane === 'TOP' && o.side === 'top') { c.prio.own.n++; put(c.prio.own.tally, o.sideLane) }
      else if (ownLane === 'BOT' && o.side === 'bot') { c.prio.own.n++; put(c.prio.own.tally, o.sideLane) }
      if (role == null || role === 'JUNGLE') {
        if (o.engaged) {
          c.prio.jungle.engaged++
          if (o.sideLane.state === 'ours') c.prio.jungle.sidePrio++
          else if (o.mid.state === 'ours') c.prio.jungle.midPrioOnly++
          else { c.prio.jungle.noPrio++; if (o.ours) c.prio.jungle.noPrioTaken++ }
          if (o.edge.favoured && o.edge.favoured !== o.side && o.edge.otherSideAvailable && !o.edge.junglerEdge) {
            c.prio.jungle.wrongSide++
            if (!o.ours) c.prio.jungle.wrongSideLost++
          }
        }
      }
      if (role == null || role === 'UTILITY') {
        c.prio.support.total++
        if (pid == null ? o.helped.length > 0 : o.helped.includes(pid)) c.prio.support.helped++
      }
    }
    // ── Crossmap (objectives taken by them) ──
    if (!o.ours) {
      c.crossmap.objectivesTheirs++
      if (o.contested) c.crossmap.contested++
      else if (o.contested === false && o.crossmap) {
        const s = o.atSec < OBJECTIVE_RULES_SPEC.duo.after14Sec ? c.crossmap.before14 : c.crossmap.after14
        s.uncontested++
        if (o.crossmap.verdict === 'traded') s.traded++
        else if (o.crossmap.verdict === 'no-trade') s.noTrade++
        else s.justified++
        const r = o.crossmap.resources
        if (r.objective) c.crossmap.resources.objective++
        if (r.plates) c.crossmap.resources.plates++
        if (r.towers) c.crossmap.resources.towers++
        if (r.kills) c.crossmap.resources.kills++
        if (r.invade) c.crossmap.resources.invade++
        if (r.numbers) c.crossmap.resources.numbers++
        if (pid != null && OBJECTIVE_RULES_SPEC.crossmap.roles.includes(role ?? '') && o.crossmap.verdict !== 'justified') {
          s.judged++
          if (o.crossmap.crossed.includes(pid)) s.crossed++
        }
      }
    }
  }
  // ── Duo ──
  for (const d of block.duo.deaths as DuoDeath[]) {
    const s = d.after14 ? c.duo.after14 : c.duo.before14
    ;(d.role === 'BOTTOM' ? s.adcDeaths : s.supDeaths)[d.fault]++
  }
  c.duo.advances = block.duo.advances.length
  c.duo.advancesDied = block.duo.advances.filter((a) => a.died).length
  return c
}

const addTally = (a: PrioTally, b: PrioTally): void => { a.ours += b.ours; a.oursProven += b.oursProven; a.even += b.even; a.theirs += b.theirs; a.unknown += b.unknown }
const addSplit = (a: CrossmapSplit, b: CrossmapSplit): void => { for (const k of Object.keys(a) as Array<keyof CrossmapSplit>) a[k] += b[k] }
const addFaults = (a: Record<DuoFault, number>, b: Record<DuoFault, number>): void => { for (const f of FAULTS) a[f] += b[f] }

/** Sum of the games' counts; null when no game has one. */
export function sumRuleCounts(list: Array<RuleCounts | null | undefined>): RuleCounts | null {
  const rows = list.filter((x): x is RuleCounts => !!x)
  if (!rows.length) return null
  const t = emptyRuleCounts()
  t.prio.own.lane = rows.find((r) => r.prio.own.lane)?.prio.own.lane ?? null
  for (const r of rows) {
    t.games += r.games
    t.prio.objectives += r.prio.objectives
    for (const k of RULE_KINDS) { t.prio.byKind[k].n += r.prio.byKind[k].n; addTally(t.prio.byKind[k].side, r.prio.byKind[k].side); addTally(t.prio.byKind[k].mid, r.prio.byKind[k].mid) }
    t.prio.own.n += r.prio.own.n; addTally(t.prio.own.tally, r.prio.own.tally)
    for (const k of Object.keys(t.prio.jungle) as Array<keyof RuleCounts['prio']['jungle']>) t.prio.jungle[k] += r.prio.jungle[k]
    t.prio.support.total += r.prio.support.total; t.prio.support.helped += r.prio.support.helped
    t.crossmap.objectivesTheirs += r.crossmap.objectivesTheirs; t.crossmap.contested += r.crossmap.contested
    for (const k of Object.keys(t.crossmap.resources) as Array<keyof RuleCounts['crossmap']['resources']>) t.crossmap.resources[k] += r.crossmap.resources[k]
    addSplit(t.crossmap.before14, r.crossmap.before14); addSplit(t.crossmap.after14, r.crossmap.after14)
    for (const s of ['before14', 'after14'] as const) { addFaults(t.duo[s].adcDeaths, r.duo[s].adcDeaths); addFaults(t.duo[s].supDeaths, r.duo[s].supDeaths) }
    t.duo.advances += r.duo.advances; t.duo.advancesDied += r.duo.advancesDied
  }
  return t
}
