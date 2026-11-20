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
import { CLOCK_TIMES, clockText } from './gameClock'

export type QcmOutcome = 'mistake' | 'justified'
/** Every QCM context (tests iterate this list, so a new context is never left unchecked). */
export const QCM_CONTEXTS = [
  'objective', 'gold', 'isolated', 'duel', 'teamfight',
  'absent', 'early-cs', 'early-xp',
  'hesitation', 'jungle-cycle', 'jungle-passive', 'rotation', 'baron-siege',
  'tempo-recall', 'tempo-front', 'gank-timer', 'carry-first', 'jungle-window', 'bad-rotation', 'duel-early', 'outnumbered',
  'chokepoint', 'mid-roam', 'eco-tempo', 'side-overextend', 'early-3v3',
  // V5 — laning phase.
  'tower-dive', 'level-spike', 'back-timer', 'range-melee', 'cheater-recall',
  // V6 — roles.
  'support-ward', 'support-level2', 'team-reset', 'trade-recall', 'adc-reopen', 'baron-recall', 'inhib-dive',
  // V7–V10 — jungle, mid, engage support.
  'jgl-first-recall', 'jgl-gank-camps-up', 'jgl-weakside', 'jgl-invade-death', 'jgl-dragon-tank', 'jgl-compensation', 'jgl-boots',
  'jgl-t1', 'jgl-herald', 'jgl-fled', 'jgl-outsmited', 'mid-ahead-wave', 'mid-reset-trap', 'mid-wave-loss',
  'sup-post6', 'sup-scuttle', 'sup-weakside',
] as const
export type QcmContext = typeof QCM_CONTEXTS[number]

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
// V5 (laning phase). Fiches merged into an existing one keep that one's id (see CODEX_ALIASES in codex.ts).
export const CODEX_DIVE = 'dive-any-early'
export const CODEX_BACK_TIMER = 'overstay-any-early'
export const CODEX_LEVEL_SPIKE = 'codex_mechanics_levelup_timers_7th_14th_minion_premove'
export const CODEX_RANGE_MELEE = 'codex_mechanics_range_vs_melee_100to0_vs_volatility'
export const CODEX_VOLATILITY = 'codex_tempo_lane_volatility_control_short_vs_long'
/** HP (percent) at the last snapshot under which a gank death also reads as a lane left too volatile. */
export const VOLATILE_HP_PCT = 50
// V6 (roles). The ADC laning fiche (codex_adc_wave_support_synergy_14gold_trap_1300g_buy_mid_rotation) has no
// detector: wave position, item charges and last-hits are not in the timeline. It answers its tag ("Autre cause…").
export const CODEX_SUPPORT_EARLY = 'codex_support_3bush_warding_level2_stacks_aftershock_punish'
export const CODEX_TEAM_SYNC = 'codex_tempo_team_sync_wave_crash_and_1caster_hold'
export const CODEX_ADC_MIDGAME = 'codex_adc_7mid_plays_useless_zone_vision_feint_reopen_rule'
export const CODEX_JUNGLE_DISCIPLINE = 'codex_jgl_3camp_longsword_base_no_cleanse_punish_baron_grouping'
// V7–V10. Each detector case points to the fiche whose text teaches it (the brief sometimes filed a case under a
// neighbouring fiche: post-level-6 bot lane and weak-side wards are taught by the support mid-game fiche). The engage
// support micro fiche (Zone C crash, CC chain) and the gank-execution part of the clear fiche have no detector: spell
// casts, minion waves and Scuttle Crabs are not in the timeline. They answer their tags ("Autre cause…").
export const CODEX_JGL_CLEAR = 'codex_jgl_t25s_recall_camps_up_90rule_weakside_first'
export const CODEX_JGL_INVADE_ORDER = 'codex_jgl_red_yellow_green_invade_and_2dragon_scenarios'
export const CODEX_JGL_GANK = 'codex_jgl_clear_ministeps_gank_spell_order_int_check'
export const CODEX_JGL_MINUS = 'codex_jgl_match_trade_minimize_plus_minus_greed_rounds'
export const CODEX_JGL_ECONOMY = 'codex_jgl_triple_tonic_pickaxe_6th_camp_recall_530_double_smite'
export const CODEX_JGL_T1_HERALD = 'codex_jgl_leave_t1_at_1hp_combat_herald_pocket_pink'
export const CODEX_JGL_NEVER_FLEE = 'codex_jgl_crab_level6_sacrifice_never_flee_invade_post_crab_routing'
export const CODEX_JGL_INVADE_STOP = 'codex_jgl_invade_stop_rule_wait_midwave_fake_invade'
export const CODEX_JGL_VISION = 'codex_jgl_yellow_trinket_10min_pink_over_dragon_wall_herald_decoy'
export const CODEX_JGL_SMITE = 'codex_jgl_burst_before_smite_animation_and_j4_chogath_combat_combos'
export const CODEX_MID_MICRO = 'codex_mid_hud_keystone_tracking_ahead_of_wave_punish_2points_q_lvl3'
export const CODEX_MID_WAVES = 'codex_mid_sync_minion_hp_lvl1_offense_as_defense_reset_trap'
export const CODEX_SUP_POST_CRASH = 'codex_support_post_crash_tribush_trap_315_hover_grubs_bush_recall'
export const CODEX_SUP_POST6 = 'codex_support_post6_fog_shadow_mid_push_weakside_camp_defense_vision_square'

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

/**
 * Diagnoses no longer offered. An answer recorded with one keeps reading as it was (its text, its fiche): the card shows
 * it back from this table when no option of the card has its tag and reason. The low-energy protocol, offered on every
 * death of a game played tired until 1.0.0-beta.1, was withdrawn on 18/11/2026.
 */
export const RETIRED_OPTIONS: readonly QcmOption[] = [
  { id: 'caught-out#lowEnergy', outcome: 'mistake', tagSlug: 'caught-out', reason: 'lowEnergy', codexId: 'codex_mental_low_energy_anti_tilt_protocol' },
]

/** The retired diagnosis an answer was given with, when the card no longer offers it. */
export function retiredOption(options: readonly QcmOption[], answer: { tagSlug: string | null; reason: string | null; viaOther: boolean } | null | undefined): QcmOption | null {
  if (!answer || answer.viaOther || answer.reason == null) return null
  if (options.some((o) => o.tagSlug === answer.tagSlug && o.reason === answer.reason)) return null
  return RETIRED_OPTIONS.find((o) => o.tagSlug === answer.tagSlug && o.reason === answer.reason) ?? null
}

/** The matrix: each context's diagnoses, most likely first. */
export function optionsFor(context: QcmContext, facts: Pick<MomentFacts, 'nearObjective' | 'secondsSinceOwnPlay' | 'playerWarded' | 'hpPct' | 'midOnWave'> = {}): QcmOption[] {
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
    // Ganked low on HP: the second reading is the lane left volatile before the gank, not the wave.
    case 'gank-timer': return facts.hpPct != null && facts.hpPct < VOLATILE_HP_PCT
      ? [linked('caught-out', 'gankTimer', CODEX_TRACKING), linked('bad-trade', 'laneVolatility', CODEX_VOLATILITY), mistake('forgot-trinket', 'trinketUnused')]
      : [linked('caught-out', 'gankTimer', CODEX_TRACKING), mistake('forgot-trinket', 'trinketUnused'), mistake('bad-wave-sync', 'waveState')]
    // V5 — laning phase.
    case 'tower-dive': return [linked('dove-tower', 'diveOneForOne', CODEX_DIVE), mistake('overstay', 'overstay'), justified('diveTrade')]
    case 'level-spike': return [linked('bad-threat-assessment', 'levelSpike', CODEX_LEVEL_SPIKE), mistake('bad-lane-opening', 'laneOpening'), mistake('bad-wave-sync', 'waveState')]
    case 'back-timer': return [linked('overstay', 'backTimer', CODEX_BACK_TIMER), mistake('unused-gold', 'unspentGold'), mistake('caught-out', 'noMinimap')]
    case 'range-melee': return [linked('bad-trade', 'rangeMelee', CODEX_RANGE_MELEE), linked('bad-positioning', 'waveSide', CODEX_WAVE_SIDE), linked('bad-threat-assessment', 'archetypeTrough', CODEX_ARCHETYPES)]
    case 'cheater-recall': return [linked('late-back', 'cheaterRecall', CODEX_BACK_TIMER), mistake('bad-wave-sync', 'waveState'), mistake('xp-deficit', 'xpLost')]
    // V6 — roles. Each brief trigger is choice [1]; the second reading is the fiche that already covered the overlapping concept.
    case 'support-ward': return [linked('forgot-trinket', 'supportEarly', CODEX_SUPPORT_EARLY), mistake('bad-lane-opening', 'laneOpening'), justified('trinketSaved')]
    case 'support-level2': return [linked('bad-positioning', 'supportEarly', CODEX_SUPPORT_EARLY), linked('bad-threat-assessment', 'levelSpike', CODEX_LEVEL_SPIKE), mistake('bad-lane-opening', 'laneOpening')]
    case 'team-reset': return [linked('caught-out', 'pressureDesync', CODEX_TEAM_SYNC), mistake('bad-wave-sync', 'waveState'), mistake('forgot-trinket', 'trinketUnused')]
    case 'trade-recall': return [linked('bad-trade', 'tradeRecall', CODEX_TEAM_SYNC), setupFail(), justified('forcedRecall')]
    case 'adc-reopen': return [linked('caught-out', 'adcReopen', CODEX_ADC_MIDGAME), linked('bad-positioning', 'assignment131', CODEX_131), justified('crossMapPressure')]
    case 'baron-recall': return [linked('overstay', 'baronRecall', CODEX_JUNGLE_DISCIPLINE), linked('bad-positioning', 'baronSiege', CODEX_BARON), justified('forcedRecall')]
    case 'inhib-dive': return [linked('overstay', 'inhibDive', CODEX_JUNGLE_DISCIPLINE), linked('bad-positioning', 'singleThreat', CODEX_SINGLE_THREAT), justified('endPush')]
    // V7–V10 — jungle, mid, engage support.
    case 'jgl-first-recall': return [linked('cs-deficit', 'lateFirstRecall', CODEX_JGL_CLEAR), linked('overstay', 'cycleBreak', CODEX_JUNGLE_CYCLE), justified('stayedForPlay')]
    case 'jgl-gank-camps-up': return [linked('cs-deficit', 'campsUpGank', CODEX_JGL_CLEAR), linked('bad-engage-angle', 'gankExecution', CODEX_JGL_GANK), justified('gankTrade')]
    case 'jgl-weakside': return [linked('cs-deficit', 'weakSideFirst', CODEX_JGL_CLEAR), linked('forgot-trinket', 'yellowTrinket', CODEX_JGL_VISION), justified('crossMapPressure')]
    // The mid laner held by their wave reads as the second-camp greed first; otherwise as the invade order.
    case 'jgl-invade-death': return facts.midOnWave
      ? [linked('overstay', 'invadeGreed', CODEX_JGL_INVADE_STOP), linked('caught-out', 'invadeOrder', CODEX_JGL_INVADE_ORDER), justified('invadeWorth')]
      : [linked('caught-out', 'invadeOrder', CODEX_JGL_INVADE_ORDER), linked('overstay', 'invadeGreed', CODEX_JGL_INVADE_STOP), justified('invadeWorth')]
    // Second readings are a different cause, never a rewording of choice [1]: the secure lost at the smite, the setup of the objective.
    case 'jgl-dragon-tank': return [linked('death-before-objective', 'dragonScenarios', CODEX_JGL_INVADE_ORDER), linked('bad-dmg-maximisation', 'burstSmite', CODEX_JGL_SMITE), justified('stealAttempt')]
    case 'jgl-compensation': return [linked('caught-out', 'compensation', CODEX_JGL_MINUS), setupFail(), justified('stealAttempt')]
    case 'jgl-boots': return [linked('unused-gold', 'earlyBoots', CODEX_JGL_ECONOMY), justified('bootsNeeded')]
    case 'jgl-t1': return [linked('overstay', 'leaveT1', CODEX_JGL_T1_HERALD), justified('t1Worth')]
    case 'jgl-herald': return [linked('bad-positioning', 'heraldUnused', CODEX_JGL_T1_HERALD), mistake('caught-out', 'noMinimap'), justified('goodEngage')]
    case 'jgl-fled': return [linked('bad-trade', 'neverFlee', CODEX_JGL_NEVER_FLEE), linked('forgot-trinket', 'yellowTrinket', CODEX_JGL_VISION), justified('fleeNeeded')]
    case 'jgl-outsmited': return [linked('bad-dmg-maximisation', 'burstSmite', CODEX_JGL_SMITE), setupFail(), justified('stealAttempt')]
    case 'mid-ahead-wave': return [linked('bad-trade', 'aheadOfWave', CODEX_MID_MICRO), mistake('caught-out', 'noMinimap'), mistake('bad-threat-assessment', 'powerSpike')]
    case 'mid-reset-trap': return [linked('overstay', 'resetTrap', CODEX_MID_WAVES), mistake('bad-trade', 'lostTrades'), mistake('caught-out', 'noMinimap')]
    case 'mid-wave-loss': return [linked('cs-deficit', 'midWaveLoss', CODEX_MID_WAVES), mistake('bad-trade', 'lostTrades'), linked('bad-threat-assessment', 'archetypeTrough', CODEX_ARCHETYPES)]
    case 'sup-post6': return [linked('bad-positioning', 'post6Fog', CODEX_SUP_POST6), mistake('bad-wave-sync', 'absentNoRotate'), justified('laneNeeded')]
    case 'sup-scuttle': return [linked('bad-positioning', 'hover315', CODEX_SUP_POST_CRASH), mistake('bad-wave-sync', 'absentNoRotate'), justified('notContestable')]
    case 'sup-weakside': return [linked('forgot-trinket', 'weakSideWard', CODEX_SUP_POST6), justified('withJungler')]
    case 'outnumbered': return [linked('bad-positioning', 'badFightChoice', CODEX_FIGHTS), mistake(nearObjective ? 'no-vision-objective' : 'face-checked', 'unwardedFlank'), justified('goodEngage')]
    case 'teamfight': return [mistake('bad-positioning', 'positioning'), mistake(nearObjective ? 'no-vision-objective' : 'face-checked', 'unwardedFlank'), justified('goodEngage')]
    case 'early-cs': return [mistake('cs-deficit', 'csMissed'), mistake('bad-wave-sync', 'waveState'), mistake('bad-trade', 'lostTrades')]
    case 'early-xp': return [mistake('xp-deficit', 'xpLost'), mistake('bad-trade', 'lostTrades'), mistake('bad-lane-opening', 'laneOpening')]
    case 'bad-rotation': return [linked('cs-deficit', 'waveRotation', CODEX_SLOW_FAST), linked('bad-positioning', 'badFightChoice', CODEX_FIGHTS), justified('rotationWorth')]
    case 'mid-roam': return [linked('cs-deficit', 'roamCheck', CODEX_ROAM_CHECK), mistake('bad-wave-sync', 'waveState'), justified('rotationWorth')]
    case 'jungle-cycle': return [linked('overstay', 'cycleBreak', CODEX_JUNGLE_CYCLE), mistake('cs-deficit', 'campsLost'), justified('invadeWorth')]
    case 'jungle-passive': return [linked('cs-deficit', 'passiveClear', CODEX_JUNGLE_INVADE), mistake('bad-threat-assessment', 'misreadPrio'), justified('noInvadeWindow')]
    case 'jungle-window': return [linked('cs-deficit', 'tempoWindowUnused', CODEX_TEMPO_WINDOW), mistake('bad-threat-assessment', 'misreadPrio'), justified('noTempoWindow')]
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
    case 'tower-dive-one-for-one': return ['tower-dive']
    case 'level-up-spike': return ['level-spike']
    case 'back-timer-missed': return ['back-timer']
    case 'range-melee-volatility': return ['range-melee']
    case 'cheater-recall': return ['cheater-recall']
    case 'support-no-early-ward': return ['support-ward']
    case 'support-level2-allin': return ['support-level2']
    case 'gank-during-team-reset': return ['team-reset']
    case 'low-hp-recall-before-objective': return ['trade-recall']
    case 'adc-solo-sidelane-reopen': return ['adc-reopen']
    case 'jungle-baron-recall': return ['baron-recall']
    case 'inhib-forced-dive': return ['inhib-dive']
    case 'jungle-late-first-recall': return ['jgl-first-recall']
    case 'jungle-camps-up-gank': return ['jgl-gank-camps-up']
    case 'jungle-weakside-stolen': return ['jgl-weakside']
    case 'jungle-invade-death': return ['jgl-invade-death']
    case 'jungle-dragon-tank-death': return ['jgl-dragon-tank']
    case 'jungle-compensation-death': return ['jgl-compensation']
    case 'jungle-early-boots': return ['jgl-boots']
    case 'jungle-side-t1-destroyed': return ['jgl-t1']
    case 'jungle-herald-unused-death': return ['jgl-herald']
    case 'jungle-fled-invade': return ['jgl-fled']
    case 'jungle-outsmited': return ['jgl-outsmited']
    case 'mid-ahead-of-wave-death': return ['mid-ahead-wave']
    case 'mid-reset-trap-death': return ['mid-reset-trap']
    case 'mid-passive-wave-loss': return ['mid-wave-loss']
    case 'support-botlane-leech': return ['sup-post6']
    case 'support-absent-scuttle': return ['sup-scuttle']
    case 'support-weakside-unwarded': return ['sup-weakside']
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

/** Game clock "m:ss" of a second count. */
const clockOf = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/** Factual one-liner: only what the timeline establishes (never a guess about intent or ward location). */
function summaryOf(m: CriticalMoment): QcmSummary {
  const f = m.facts
  const extras: SummaryPart[] = []
  let head: SummaryPart
  const times = CLOCK_TIMES
  const span = (w: readonly [number, number]) => ({ from: clockText(w[0]), to: clockText(w[1]) })
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
      head = f.gankWindow === 1 ? { key: 'gankTimer1', params: span(times.gank1) } : { key: 'gankTimer2', params: span(times.gank2) }
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
    case 'tower-dive-one-for-one':
      head = { key: 'diveOneForOne', params: { sec: f.killGapSec ?? 0 } }
      break
    case 'level-up-spike':
      head = { key: 'levelSpike', params: { level: f.spikeLevel ?? 2 } }
      break
    case 'back-timer-missed':
      head = { key: 'backTimer' }
      if (f.hpPct != null) extras.push({ key: 'hpBefore', params: { pct: f.hpPct, sec: f.hpSnapshotAgeSec ?? 0 } })
      if (f.goldInPocket) extras.push({ key: 'gold', params: { gold: f.goldInPocket } })
      break
    case 'range-melee-volatility':
      head = { key: f.attackType === 'melee' ? 'meleeChunked' : 'rangedChunked', params: { pct: f.laneHpPct ?? 0 } }
      if (f.attackType === 'melee' && f.opponentHpPct != null) extras.push({ key: 'opponentHp', params: { pct: f.opponentHpPct } })
      break
    case 'cheater-recall':
      head = { key: 'cheaterRecall', params: { pct: f.recallHpPct ?? 0, ...span(times.cheaterBack) } }
      if (f.levelsBehind) extras.push({ key: 'levelsBehind', params: { count: f.levelsBehind } })
      break
    case 'support-no-early-ward':
      head = { key: 'supportNoWard', params: { clock: clockText(times.supportWardBy) } }
      break
    case 'support-level2-allin':
      head = { key: f.junglerInvolved ? 'supportLevel2Gank' : 'supportLevel2', params: { mine: f.myLevel ?? 1, theirs: f.enemyLevel ?? 2 } }
      break
    case 'gank-during-team-reset':
      head = { key: 'teamResetGank' }
      if (f.alliesHome) extras.push({ key: 'alliesHome', params: { n: f.alliesHome } })
      break
    case 'low-hp-recall-before-objective':
      head = { key: 'tradeRecall', params: { pct: f.recallHpPct ?? 0, sec: f.spawnInSec ?? 0, objective: f.objective ?? 'dragon' } }
      if (f.opponentHpPct != null) extras.push({ key: 'opponentHp', params: { pct: f.opponentHpPct } })
      if (f.alliesDown) extras.push({ key: 'alliesDown', params: { count: f.alliesDown } })
      break
    case 'adc-solo-sidelane-reopen':
      head = { key: 'adcReopen', params: { sec: f.sinceBaseSec ?? 0 } }
      if (f.midInBase) extras.push({ key: 'midInBase' })
      break
    case 'jungle-baron-recall':
      head = { key: 'baronRecall' }
      if (f.alliesDown) extras.push({ key: 'alliesDown', params: { count: f.alliesDown } })
      if (f.goldInPocket) extras.push({ key: 'gold', params: { gold: f.goldInPocket } })
      break
    case 'inhib-forced-dive':
      head = { key: 'inhibDive', params: { sec: f.inhibGapSec ?? 0 } }
      break
    // V7–V10.
    case 'jungle-late-first-recall':
      head = { key: 'lateFirstRecall', params: { clock: clockText(times.jungleFirstBack) } }
      if (f.firstBackSec != null) extras.push({ key: 'firstBack', params: { clock: clockOf(f.firstBackSec) } })
      break
    case 'jungle-camps-up-gank':
      head = { key: 'campsUpGank' }
      if (f.jungleCsLost) extras.push({ key: 'jungleCsLost', params: { cs: f.jungleCsLost } })
      break
    case 'jungle-weakside-stolen':
      head = { key: 'weakSideStolen' }
      if (f.campsStolenCs) extras.push({ key: 'campsStolen', params: { cs: f.campsStolenCs } })
      break
    case 'jungle-invade-death':
      head = { key: 'invadeDeath' }
      if (f.campsTakenCs) extras.push({ key: 'campsTaken', params: { cs: f.campsTakenCs } })
      if (f.midOnWave) extras.push({ key: 'midOnWave' })
      break
    case 'jungle-dragon-tank-death':
      head = { key: 'dragonTank', params: { pct: f.dragonDamagePct ?? 0 } }
      break
    case 'jungle-compensation-death':
      head = { key: 'compensation', params: { sec: f.deathGapSec ?? 0, objective: f.objective ?? 'dragon' } }
      if (f.enemiesInvolved) extras.push({ key: 'outnumbered', params: { n: f.enemiesInvolved } })
      break
    case 'jungle-early-boots':
      head = { key: 'earlyBoots', params: { clock: clockOf(f.bootsSec ?? 0) } }
      break
    case 'jungle-side-t1-destroyed':
      head = { key: 'sideT1', params: { lane: f.turretLane === 'TOP' ? 'top' : 'bot' } }
      break
    case 'jungle-herald-unused-death':
      head = { key: 'heraldUnused', params: { sec: f.heraldAgoSec ?? 0 } }
      break
    case 'jungle-fled-invade':
      head = { key: 'fledInvade', params: { pct: f.hpPct ?? 0, theirs: f.opponentHpPct ?? 0 } }
      break
    case 'jungle-outsmited':
      head = { key: 'outsmited', params: { objective: f.objective ?? 'dragon' } }
      if (f.playerDistance != null) extras.push({ key: 'distance', params: { distance: Math.round(f.playerDistance / 100) * 100 } })
      break
    case 'mid-ahead-of-wave-death':
      head = { key: 'aheadOfWave', params: { sec: f.sinceBaseSec ?? 0 } }
      break
    case 'mid-reset-trap-death':
      head = { key: f.resetResource === 'mana' ? 'resetTrapMana' : 'resetTrapHp', params: { pct: f.resetLowPct ?? 0, sec: f.enemyBackSec ?? 0 } }
      break
    case 'mid-passive-wave-loss':
      head = { key: 'midWaveLoss', params: { cs: f.csDiff6 ?? 0 } }
      extras.push({ key: 'skillsSpread' })
      break
    case 'support-botlane-leech':
      head = { key: 'botLeech', params: { n: f.laneSnapshots ?? 0 } }
      if (f.kpPct != null) extras.push({ key: 'killParticipation', params: { pct: f.kpPct } })
      break
    case 'support-absent-scuttle':
      head = { key: 'absentScuttle' }
      if (f.playerDistance != null) extras.push({ key: 'distance', params: { distance: Math.round(f.playerDistance / 100) * 100 } })
      break
    case 'support-weakside-unwarded':
      head = { key: 'weakSideUnwarded', params: { cs: f.campsStolenCs ?? 0 } }
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
 */
export function buildQcm(m: CriticalMoment, stats?: ChoiceStats): QcmCard {
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
  return { momentKey: m.key, contexts, summary: summaryOf(m), options }
}

/** A `justified` answer records the moment as reviewed but never creates a Mistake. */
export const countsAgainstPlayer = (outcome: QcmOutcome | 'custom'): boolean => outcome !== 'justified'
