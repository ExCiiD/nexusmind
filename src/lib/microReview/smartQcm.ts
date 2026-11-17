/**
 * SmartQCMGenerator — turns a CriticalMoment into a one-line factual summary
 * and 3 prioritised diagnosis buttons (docs/PLAN_MICRO_REVIEW.md §B), plus
 * the mandatory 4th "Autre cause…" handled by the UI.
 *
 * Every diagnosis is an existing Mistake Library tag (no parallel taxonomy)
 * or a `justified` outcome, which records the answer but creates no Mistake,
 * so it never counts against the player's stats. A card shows its two
 * likeliest diagnoses and, whenever one of its contexts has one, a
 * `justified` way out; three diagnoses when none has.
 *
 * A diagnosis may point at an AscendCodex fiche (`codexId`): that is how each
 * fiche's "qcmTrigger" is wired — the detector recognises the situation, the
 * option carries the fiche, and the fiche is shown once the player picks it.
 *
 * Local learning: answers are stored per (role, champion); mistake options
 * are ordered by how often the player picked them, and a tag picked often
 * through "Autre cause…" is promoted into the top 3.
 */

import type { CriticalMoment, MomentFacts } from './anomalyDetector'
import type { Zone } from './geometry'

export type QcmOutcome = 'mistake' | 'justified'
export type QcmContext =
  | 'objective' | 'gold' | 'isolated' | 'duel' | 'teamfight'
  | 'absent' | 'early-cs' | 'early-xp'
  | 'hesitation' | 'jungle-cycle' | 'jungle-passive' | 'rotation' | 'baron-siege'
  | 'tempo-recall' | 'tempo-front' | 'gank-timer' | 'carry-first' | 'jungle-window' | 'bad-rotation' | 'duel-early' | 'outnumbered'
  | 'chokepoint' | 'mid-roam' | 'eco-tempo' | 'side-overextend' | 'early-3v3' | 'low-energy'

export interface QcmOption {
  /** Unique within the card: the tag slug, `justified:<reason>`, or `<tag>#<reason>` for a second reading of a tag already on the card. */
  id: string
  outcome: QcmOutcome
  tagSlug: string | null
  /** i18n key under `microReview.reason.*`. */
  reason: string
  promoted?: boolean
  /** AscendCodex fiche this diagnosis points to. */
  codexId?: string
}

export interface SummaryPart { key: string; params?: Record<string, string | number> }
export interface QcmSummary {
  gameTimeSec: number
  zone: Zone | null
  head: SummaryPart
  extras: SummaryPart[]
}

export interface QcmCard {
  momentKey: string
  contexts: QcmContext[]
  summary: QcmSummary
  options: QcmOption[]
}

/** What the micro-review knows about the game beyond the timeline. */
export interface QcmEnv {
  /** The game was played in low-energy conditions (loss streak, night, weak daypart) — see lowEnergy.ts. */
  lowEnergy?: boolean
}

const mistake = (tagSlug: string, reason: string): QcmOption => ({ id: tagSlug, outcome: 'mistake', tagSlug, reason })
const justified = (reason: string): QcmOption => ({ id: `justified:${reason}`, outcome: 'justified', tagSlug: null, reason })
const linked = (tagSlug: string, reason: string, codexId: string): QcmOption => ({ ...mistake(tagSlug, reason), codexId })

// AscendCodex fiches reachable from a diagnosis (ids in codex.json).
export const CODEX_TEMPO = 'codex_macro_obj_tempo_vs_tower_greed'
export const CODEX_JUNGLE_INVADE = 'codex_jgl_3camps_mid_cross_bot_invade'
export const CODEX_JUNGLE_CYCLE = 'codex_jgl_pathing_integrity_reset_cycle'
export const CODEX_OBJ_SETUP = 'codex_macro_early_obj_setup_asymmetry'
export const CODEX_131 = 'codex_macro_131_jungle_hover_assignment'
export const CODEX_BARON = 'codex_macro_baron_balance_system'
export const CODEX_TEMPO_LINES = 'codex_macro_tempo_lines_sync'
export const CODEX_WAVE_SIDE = 'codex_mechanics_lane_quadrants_minion_wall'
export const CODEX_SINGLE_THREAT = 'codex_deaths_teamfight_single_threat_tracking'
export const CODEX_TEMPO_WINDOW = 'codex_tempo_single_action_window_wave_cheating'
export const CODEX_SLOW_FAST = 'codex_mechanics_wave_slow_fast_rotation_timer'
export const CODEX_TRACKING = 'codex_vision_jungle_tracking_math_timers'
export const CODEX_TRADING = 'codex_mechanics_trading_4laws_cooldown_punish'
export const CODEX_FIGHTS = 'codex_macro_choosing_good_fights_camera_check'
export const CODEX_3_TEMPOS = 'codex_tempo_territorial_vs_order_vs_economic'
export const CODEX_ASYMMETRY = 'codex_macro_pressure_asymmetry_next_midwave'
export const CODEX_CHOKEPOINT = 'codex_vision_baron_chokepoint_support_zoning'
export const CODEX_ARCHETYPES = 'codex_mechanics_mid_6archetypes_3v3_synergy'
export const CODEX_ROAM_CHECK = 'codex_tempo_roam_check_systematic_fog'
export const CODEX_LOW_ENERGY = 'codex_mental_low_energy_anti_tilt_protocol'

const tempoGreed = () => linked('overstay', 'tempoGreed', CODEX_TEMPO)
const setupFail = () => linked('no-ward-pre-obj', 'setupFail', CODEX_OBJ_SETUP)

/** Gold in pocket at death that reads as "should have recalled". */
export const GOLD_IN_POCKET = 1400
/** HP (percent) at the last snapshot under which the fight was taken on an empty tank. */
export const LOW_HP_PCT = 35
const LANING_UNTIL = 14 * 60
const MID_GAME_FROM = 14 * 60
const MID_GAME_TO = 25 * 60
/** "Passé 15 minutes": side-lane depth is dictated by mid priority. */
const SIDE_LANE_FROM = 15 * 60
/** Tag recorded by the low-energy diagnosis — always the same one, so the session objective can be checked against it. */
export const LOW_ENERGY_TAG = 'caught-out'
/** The low-energy diagnosis: its own id, since another reading of the same tag may sit on the card. */
const lowEnergyOption = (): QcmOption => ({ ...linked(LOW_ENERGY_TAG, 'lowEnergy', CODEX_LOW_ENERGY), id: `${LOW_ENERGY_TAG}#lowEnergy` })

/** The matrix: each context's diagnoses, most likely first. */
export function optionsFor(context: QcmContext, facts: Pick<MomentFacts, 'nearObjective' | 'secondsSinceOwnPlay' | 'playerWarded'> = {}): QcmOption[] {
  const nearObjective = !!facts.nearObjective
  switch (context) {
    // Death near a lost objective: setup (vision / mid opening), tempo (tower greed vs cross-map), or a justified 50/50.
    case 'objective': return [setupFail(), tempoGreed(), justified('stealAttempt')]
    // The player did ward the pit: the second reading is the wave that was not pushed, not the vision.
    case 'hesitation': return [tempoGreed(), facts.playerWarded ? mistake('bad-wave-sync', 'absentNoRotate') : mistake('no-ward-pre-obj', 'absentNoWard'), justified('notContestable')]
    case 'absent': return [setupFail(), mistake('bad-wave-sync', 'absentNoRotate'), justified('notContestable')]
    case 'chokepoint': return [linked('bad-positioning', 'chokePoint', CODEX_CHOKEPOINT), mistake('no-vision-objective', 'unwardedFlank'), justified('pitRole')]
    case 'baron-siege': return [linked('bad-positioning', 'baronSiege', CODEX_BARON), mistake('caught-out', 'noMinimap'), justified('baronTrade')]
    // Tempo line, from its two ends: in base while the team fights (recalled late) / dead alone ahead of the team.
    case 'tempo-recall': return [linked('overstay', 'tempoLineDesync', CODEX_TEMPO_LINES), mistake('late-back', 'lateReset'), justified('tempoTradeOk')]
    case 'tempo-front': return [linked('overstay', 'tempoLineDesync', CODEX_TEMPO_LINES), mistake('caught-out', 'frontAlone'), justified('crossMapPressure')]
    case 'carry-first': return [linked('bad-positioning', 'singleThreat', CODEX_SINGLE_THREAT), mistake('bad-threat-assessment', 'powerSpike'), justified('goodEngage')]
    case 'eco-tempo': return [linked('bad-positioning', 'ecoTempo', CODEX_3_TEMPOS), mistake('wasted-summoner', 'summonerLate'), justified('forcedFight')]
    // Dying right after cashing a play = using one tempo window twice.
    case 'gold': return [facts.secondsSinceOwnPlay != null ? linked('overstay', 'doubleSpend', CODEX_TEMPO_WINDOW) : mistake('overstay', 'overstay'), mistake('unused-gold', 'unspentGold'), mistake('late-back', 'cancelledRecall')]
    case 'side-overextend': return [linked('caught-out', 'asymmetryMidPrio', CODEX_ASYMMETRY), mistake('forgot-trinket', 'trinketUnused'), justified('crossMapPressure')]
    case 'rotation': return [linked('bad-positioning', 'assignment131', CODEX_131), mistake('caught-out', 'noMinimap'), justified('crossMapPressure')]
    case 'isolated': return [mistake('caught-out', 'noMinimap'), mistake('forgot-trinket', 'trinketUnused'), justified('crossMapPressure')]
    case 'duel': return [mistake('bad-trade', 'mechanics'), mistake('bad-threat-assessment', 'powerSpike'), mistake('forgot-trinket', 'trinket')]
    case 'duel-early': return [linked('bad-trade', 'tradingLaws', CODEX_TRADING), linked('bad-positioning', 'waveSide', CODEX_WAVE_SIDE), linked('bad-threat-assessment', 'archetypeTrough', CODEX_ARCHETYPES)]
    case 'early-3v3': return [linked('bad-trade', 'archetype3v3', CODEX_ARCHETYPES), mistake('caught-out', 'noMinimap'), mistake('forgot-trinket', 'trinketUnused')]
    case 'gank-timer': return [linked('caught-out', 'gankTimer', CODEX_TRACKING), mistake('forgot-trinket', 'trinketUnused'), mistake('bad-wave-sync', 'waveState')]
    case 'outnumbered': return [linked('bad-positioning', 'badFightChoice', CODEX_FIGHTS), mistake(nearObjective ? 'no-vision-objective' : 'face-checked', 'unwardedFlank'), justified('goodEngage')]
    case 'teamfight': return [mistake('bad-positioning', 'positioning'), mistake(nearObjective ? 'no-vision-objective' : 'face-checked', 'unwardedFlank'), justified('goodEngage')]
    case 'early-cs': return [mistake('cs-deficit', 'csMissed'), mistake('bad-wave-sync', 'waveState'), mistake('bad-trade', 'lostTrades')]
    case 'early-xp': return [mistake('xp-deficit', 'xpLost'), mistake('bad-trade', 'lostTrades'), mistake('bad-lane-opening', 'laneOpening')]
    case 'bad-rotation': return [linked('cs-deficit', 'waveRotation', CODEX_SLOW_FAST), linked('bad-positioning', 'badFightChoice', CODEX_FIGHTS), justified('rotationWorth')]
    case 'mid-roam': return [linked('cs-deficit', 'roamCheck', CODEX_ROAM_CHECK), mistake('bad-wave-sync', 'waveState'), justified('rotationWorth')]
    case 'jungle-cycle': return [linked('overstay', 'cycleBreak', CODEX_JUNGLE_CYCLE), mistake('cs-deficit', 'campsLost'), justified('invadeWorth')]
    case 'jungle-passive': return [linked('cs-deficit', 'passiveClear', CODEX_JUNGLE_INVADE), mistake('bad-threat-assessment', 'misreadPrio'), justified('noInvadeWindow')]
    case 'jungle-window': return [linked('cs-deficit', 'tempoWindowUnused', CODEX_TEMPO_WINDOW), mistake('bad-threat-assessment', 'misreadPrio'), justified('noTempoWindow')]
    case 'low-energy': return [lowEnergyOption()]
  }
}

/** Fought with a real-economy deficit: low HP at the last snapshot, 2+ levels behind, or 1 level behind in a 1v1. */
export function ecoDeficit(f: MomentFacts): boolean {
  const levels = f.levelDeficit ?? 0
  return (f.hpPct != null && f.hpPct < LOW_HP_PCT) || levels >= 2 || (levels >= 1 && (f.enemiesInvolved ?? 1) <= 1)
}

/** Contexts that apply to a moment, highest priority first. */
export function contextsOf(m: CriticalMoment): QcmContext[] {
  const f = m.facts
  switch (f.pattern) {
    case 'tempo-hesitation': return ['hesitation']
    case 'jungle-overchase':
    case 'jungle-counter-tempo': return ['jungle-cycle']
    case 'jungle-passive-clear': return ['jungle-passive']
    case 'jungle-window-unpunished': return ['jungle-window']
    case 'tempo-late-recall': return ['tempo-recall']
    case 'tempo-front-isolated': return ['tempo-front']
    case 'gank-timer': return ['gank-timer']
    case 'fed-carry-first': return ['carry-first']
    case 'bad-rotation': return ['bad-rotation']
    case 'mid-roam-plates': return ['mid-roam']
    case 'pit-chokepoint': return ['chokepoint']
    default: break
  }
  if (m.trigger === 'absent-objective') return ['absent']
  if (m.trigger === 'early-deficit') {
    const out: QcmContext[] = []
    if ((f.csDiff10 ?? 0) < -15) out.push('early-cs')
    if ((f.xpDiff10 ?? 0) < -400) out.push('early-xp')
    return out.length ? out : ['early-cs']
  }

  // A critical death without a pattern: read it from its geometry and context.
  const out: QcmContext[] = []
  const allies = f.alliesNearby ?? 0
  const enemies = f.enemiesInvolved ?? 1
  const early = m.gameTimeSec < LANING_UNTIL
  const epicLost = !!f.objectiveLost && f.objectiveLost !== 'tower' && f.objectiveLost !== 'inhibitor'
  if (f.nearObjective && epicLost) out.push('objective')
  if (f.alliedBaron) out.push('baron-siege')
  if (ecoDeficit(f)) out.push('eco-tempo')
  if ((f.goldInPocket ?? 0) >= GOLD_IN_POCKET || f.secondsSinceOwnPlay != null) out.push('gold')
  if (!f.alliedBaron && !f.nearObjective) {
    const sideLane = m.zone === 'top-lane' || m.zone === 'bot-lane'
    const inJungle = m.zone === 'own-jungle' || m.zone === 'enemy-jungle' || m.zone === 'top-river' || m.zone === 'bot-river'
    // Past the river in a side lane, alone: depth is dictated by mid priority.
    if (sideLane && m.territory === 'enemy' && allies === 0 && m.gameTimeSec >= SIDE_LANE_FROM) out.push('side-overextend')
    // Mid game, caught on a rotation through the jungle / river: 1-3-1 assignment.
    else if (inJungle && m.gameTimeSec >= MID_GAME_FROM && m.gameTimeSec < MID_GAME_TO) out.push('rotation')
  }
  if (allies === 0 && enemies >= 2) out.push(early ? 'early-3v3' : 'isolated')
  else if (allies === 0) out.push(early ? 'duel-early' : 'duel')
  else out.push(enemies >= allies + 2 && m.gameTimeSec < MID_GAME_TO ? 'outnumbered' : 'teamfight')
  return out
}

// ── Local learning ──────────────────────────────────────────────────────

export interface PastAnswer {
  role: string
  champion: string
  tagSlug: string | null
  /** Picked through "Autre cause…" rather than one of the 3 buttons. */
  viaOther: boolean
}

export interface ChoiceStats {
  /** Picks of each tag for this (role, champion). */
  champ: Record<string, { count: number; viaOther: number }>
  /** Picks of each tag for this role, any champion. */
  role: Record<string, { count: number; viaOther: number }>
}

export function choiceStats(answers: PastAnswer[], role: string, champion: string): ChoiceStats {
  const champ: ChoiceStats['champ'] = {}
  const byRole: ChoiceStats['role'] = {}
  const bump = (rec: ChoiceStats['champ'], slug: string, other: boolean) => {
    const e = (rec[slug] ??= { count: 0, viaOther: 0 })
    e.count++
    if (other) e.viaOther++
  }
  for (const a of answers) {
    if (!a.tagSlug || a.role !== role) continue
    bump(byRole, a.tagSlug, a.viaOther)
    if (a.champion.toLowerCase() === champion.toLowerCase()) bump(champ, a.tagSlug, a.viaOther)
  }
  return { champ, role: byRole }
}

export const PROMOTE_CHAMP = 2
export const PROMOTE_ROLE = 3

/** Tag picked through "Autre cause…" often enough to deserve a button. */
export function promotedTag(stats: ChoiceStats, exclude: string[]): string | null {
  const score = (slug: string) => {
    const c = stats.champ[slug]?.viaOther ?? 0
    const r = stats.role[slug]?.viaOther ?? 0
    return c >= PROMOTE_CHAMP || r >= PROMOTE_ROLE ? c * 10 + r : 0
  }
  const slugs = [...new Set([...Object.keys(stats.champ), ...Object.keys(stats.role)])]
    .filter((s) => !exclude.includes(s) && score(s) > 0)
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b))
  return slugs[0] ?? null
}

// ── Card ────────────────────────────────────────────────────────────────

/** Factual one-liner: only what the timeline establishes (never a guess about intent or ward location). */
function summaryOf(m: CriticalMoment): QcmSummary {
  const f = m.facts
  const extras: SummaryPart[] = []
  let head: SummaryPart
  switch (f.pattern) {
    case 'tempo-hesitation':
      head = { key: f.towerGreed ? 'towerGreed' : 'hesitation', params: { objective: f.objective ?? 'dragon' } }
      if (f.approachedBy) extras.push({ key: 'lateMove', params: { distance: Math.round(f.approachedBy / 100) * 100 } })
      extras.push({ key: 'noCrossMap' })
      break
    case 'tempo-late-recall':
      head = { key: 'tempoLateRecall' }
      if (f.goldInPocket) extras.push({ key: 'goldBefore', params: { gold: f.goldInPocket } })
      if (f.alliesHigh) extras.push({ key: 'alliesHigh', params: { n: f.alliesHigh } })
      break
    case 'tempo-front-isolated':
      head = { key: 'tempoFront' }
      if (f.alliesHome) extras.push({ key: 'alliesHome', params: { n: f.alliesHome } })
      break
    case 'gank-timer':
      head = { key: f.gankWindow === 1 ? 'gankTimer1' : 'gankTimer2' }
      if (f.deepWard) extras.push({ key: 'deepWardUp' })
      else if (f.wardedRecently === false) extras.push({ key: 'noWardRecent' })
      break
    case 'fed-carry-first':
      head = { key: 'fedCarryFirst' }
      if (f.goldSharePct) extras.push({ key: 'goldShare', params: { pct: f.goldSharePct } })
      if (f.killStreak && f.killStreak >= 2) extras.push({ key: 'streak', params: { n: f.killStreak } })
      break
    case 'jungle-window-unpunished':
      head = { key: 'tempoWindowUnpunished' }
      if (f.playerDistance) extras.push({ key: 'junglerFar', params: { distance: Math.round(f.playerDistance / 100) * 100 } })
      break
    case 'bad-rotation':
      head = { key: 'badRotation' }
      extras.push({ key: 'rotationLoss', params: { cs: f.csLost ?? 0, xp: f.xpLost ?? 0 } })
      break
    case 'mid-roam-plates':
      head = { key: f.roamSide === 'top' ? 'midRoamTop' : 'midRoamBot' }
      extras.push({ key: 'platesLost', params: { count: f.platesLost ?? 1 } })
      extras.push({ key: 'csLost', params: { cs: f.csLost ?? 0 } })
      break
    case 'pit-chokepoint':
      head = { key: 'chokePoint', params: { objective: f.nearestPit === 'dragon' ? 'dragon' : 'baron' } }
      if (f.alliesDown) extras.push({ key: 'alliesDown', params: { count: f.alliesDown } })
      break
    case 'jungle-passive-clear':
      head = { key: 'passiveClear' }
      if (f.botGoldLead != null) extras.push({ key: 'botLead', params: { gold: f.botGoldLead } })
      break
    case 'jungle-overchase':
    case 'jungle-counter-tempo':
      head = { key: f.pattern === 'jungle-overchase' ? 'overchase' : 'counterTempo' }
      if (f.xpDiffJungle != null && f.xpDiffJungle < 0) extras.push({ key: 'xpVsJungler', params: { n: Math.round(f.xpDiffJungle) } })
      break
    default:
      if (m.trigger === 'absent-objective') {
        head = { key: 'absent', params: { objective: f.objective ?? 'dragon' } }
        if (f.playerDistance != null) extras.push({ key: 'distance', params: { distance: Math.round(f.playerDistance / 100) * 100 } })
        extras.push(f.wardsElsewhere ? { key: 'wardsElsewhere', params: { count: f.wardsElsewhere } } : { key: 'noWardAtAll' })
      } else if (m.trigger === 'early-deficit') {
        head = { key: f.opponentChampion ? 'early' : 'earlyNoOpp', params: { opponent: f.opponentChampion ?? '' } }
        if ((f.csDiff10 ?? 0) < 0) extras.push({ key: 'csDiff', params: { n: f.csDiff10 ?? 0 } })
        if ((f.xpDiff10 ?? 0) < 0) extras.push({ key: 'xpDiff', params: { n: f.xpDiff10 ?? 0 } })
      } else {
        head = f.objectiveLost && f.objectiveLostAfterSec != null
          ? { key: 'deathObjective', params: { sec: f.objectiveLostAfterSec, objective: f.objectiveLost } }
          : { key: 'death' }
        if (f.alliedBaron) extras.push({ key: 'underBaron' })
        if (f.hpPct != null && f.hpPct < LOW_HP_PCT) extras.push({ key: 'hpBefore', params: { pct: f.hpPct, sec: f.hpSnapshotAgeSec ?? 0 } })
        if (f.levelDeficit) extras.push({ key: 'levelDeficit', params: { count: f.levelDeficit } })
        if ((f.goldInPocket ?? 0) >= 1000) extras.push({ key: 'gold', params: { gold: f.goldInPocket ?? 0 } })
        if (f.secondsSinceOwnPlay != null) extras.push({ key: 'afterPlay', params: { sec: f.secondsSinceOwnPlay } })
        if ((f.alliesNearby ?? 0) === 0 && (f.enemiesInvolved ?? 0) >= 2) extras.push({ key: 'outnumbered', params: { n: f.enemiesInvolved ?? 2 } })
        if (f.nearObjective && !f.wardedLast60s) extras.push({ key: 'noWard' })
      }
  }
  return { gameTimeSec: m.gameTimeSec, zone: m.zone, head, extras: extras.slice(0, 2) }
}

/**
 * Card for one moment.
 * `stats`: the player's past answers for this role/champion — orders mistake
 * options by habit and promotes a frequent "Autre cause…" pick into the top 3.
 * `env.lowEnergy`: on a death, the low-energy protocol becomes choice [2].
 */
export function buildQcm(m: CriticalMoment, stats?: ChoiceStats, env?: QcmEnv): QcmCard {
  const contexts = contextsOf(m)
  const lists = contexts.map((c) => optionsFor(c, m.facts))
  // Round-robin across contexts: every context's best guess, then their
  // second ones, … so a death "near Baron with 1650 g" offers both readings.
  const pool: QcmOption[] = []
  for (let i = 0; i < 3; i++) {
    for (const list of lists) {
      const o = list[i]
      if (o && !pool.some((p) => p.id === o.id)) pool.push(o)
    }
  }
  // The two likeliest diagnoses plus, whenever a context has one, its
  // `justified` way out — a second context must never crowd it out.
  const exit = pool.find((o) => o.outcome === 'justified')
  const diagnoses = pool.filter((o) => o.outcome === 'mistake')
  let options = exit ? [...diagnoses.slice(0, 2), exit] : diagnoses.slice(0, 3)

  if (stats) {
    const habit = (o: QcmOption) => (o.tagSlug ? stats.champ[o.tagSlug]?.count ?? 0 : -1)
    const mistakes = options.filter((o) => o.outcome === 'mistake')
      .map((o, i) => ({ o, i }))
      // A Codex-linked diagnosis of the primary context stays choice [1].
      .sort((a, b) => Number(!!b.o.codexId && b.i === 0) - Number(!!a.o.codexId && a.i === 0) || habit(b.o) - habit(a.o) || a.i - b.i)
      .map((x) => x.o)
    const others = options.filter((o) => o.outcome !== 'mistake')
    options = [...mistakes, ...others]
    const promo = promotedTag(stats, options.map((o) => o.tagSlug).filter((s): s is string => !!s))
    if (promo) {
      // Replace the least likely plain mistake option; keep fiches and the `justified` way out.
      const idx = options.map((o) => (o.outcome === 'mistake' && !o.codexId ? 'swap' : 'keep')).lastIndexOf('swap')
      if (idx >= 0) options = options.map((o, i) => (i === idx ? { ...mistake(promo, 'habit'), promoted: true } : o))
    }
  }

  // Low-energy game: the protocol is offered on every death, as choice [2].
  // It takes the place of the second diagnosis: choice [1] and the `justified` way out stay.
  if (env?.lowEnergy && m.trigger === 'critical-death') {
    const next = [options[0], lowEnergyOption(), ...options.slice(1)]
    if (next.length > 3) {
      const after = next.map((o, i) => ({ o, i })).filter((x) => x.i > 1 && x.o.outcome === 'mistake')
      const drop = after.filter((x) => !x.o.codexId).pop() ?? after.pop()
      next.splice(drop ? drop.i : next.length - 1, 1)
    }
    options = next
    contexts.splice(1, 0, 'low-energy')
  }
  return { momentKey: m.key, contexts, summary: summaryOf(m), options }
}

/** A `justified` answer records the moment as reviewed but never creates a Mistake. */
export const countsAgainstPlayer = (outcome: QcmOutcome | 'custom'): boolean => outcome !== 'justified'
