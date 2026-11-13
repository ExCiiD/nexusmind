/**
 * Coaching engine — problem taxonomy (docs/MOTEUR_REGLES.md §2 ②).
 *
 * Rules (assistant/rules.ts) and auto-detected mistakes (Mistake Library)
 * produce *findings*; each finding belongs to one problem. Several findings
 * about the same problem are merged into one diagnosis, so the player gets a
 * single, better-supported message instead of three overlapping ones.
 *
 * Plain data: adding a rule or a mistake tag = adding its id below.
 */

import type { Metric } from './features'

export type RoleBucket = 'jungle' | 'support' | 'laner'

export interface Problem {
  id: string
  /** Fundamental to work on when this problem is the focus (null = no objective). */
  fundamentalId: string | null
  /** Assistant rules that are evidence for this problem. */
  rules: string[]
  /** Mistake Library tags that are evidence for this problem. */
  mistakeTags: string[]
  /** Feature used to look up the player's own win impact (regression.ts DRIVER_FEATURES). */
  driverMetric?: Metric
  /** Prior impact on winning, by role, when the player has too few games for a personal estimate. 0.7–1.3, 1 = average. */
  impactPrior: Record<RoleBucket, number>
  /** Wellbeing / habit problems keep their own rule weight and are never re-scored by impact. */
  unscored?: boolean
}

const EVEN: Record<RoleBucket, number> = { laner: 1, jungle: 1, support: 1 }

export const PROBLEMS: Problem[] = [
  {
    id: 'laning',
    fundamentalId: 'trades',
    rules: ['early_deaths_pattern', 'pg_early_deaths', 'lane_weak_pattern', 'pg_lane_weak', 'pg_lane_strong'],
    mistakeTags: ['bad-trade', 'bad-lane-opening', 'bad-wave-sync', 'xp-deficit'],
    driverMetric: 'deathsBefore10',
    impactPrior: { laner: 1.25, jungle: 0.8, support: 1 },
  },
  {
    id: 'deaths',
    fundamentalId: 'tempo',
    rules: ['high_deaths_trend', 'pg_deaths_spike'],
    mistakeTags: ['dove-tower', 'overstay'],
    driverMetric: 'deaths',
    impactPrior: { laner: 1.15, jungle: 1.15, support: 1.1 },
  },
  {
    id: 'farming',
    fundamentalId: 'csing_pathing',
    rules: ['cs_trend_down', 'cs_trend_up', 'cs10_low', 'pg_cs_low', 'pg_cs_high'],
    mistakeTags: ['cs-deficit'],
    driverMetric: 'csPerMin',
    impactPrior: { laner: 1.15, jungle: 1.05, support: 0.7 },
  },
  {
    id: 'vision',
    fundamentalId: 'vision_control',
    rules: ['vision_drop', 'pg_vision_low', 'pg_vision_high'],
    mistakeTags: ['forgot-trinket', 'walked-into-ward', 'face-checked'],
    driverMetric: 'visionPerMin',
    impactPrior: { laner: 0.85, jungle: 1.1, support: 1.25 },
  },
  {
    id: 'objective-setup',
    fundamentalId: 'wave_management_objectives',
    rules: [],
    mistakeTags: ['death-before-objective', 'no-ward-pre-obj', 'no-vision-objective'],
    impactPrior: { laner: 0.95, jungle: 1.3, support: 1.15 },
  },
  {
    id: 'map-awareness',
    fundamentalId: 'map_awareness',
    rules: ['low_kp'],
    mistakeTags: ['caught-out', 'solo-baron-died'],
    driverMetric: 'kp',
    impactPrior: { laner: 1, jungle: 1.1, support: 1.05 },
  },
  {
    id: 'gold-management',
    fundamentalId: 'recall_timing',
    rules: [],
    mistakeTags: ['unused-gold', 'late-back'],
    impactPrior: { laner: 1, jungle: 0.95, support: 0.8 },
  },
  {
    id: 'teamfight',
    fundamentalId: 'positioning',
    rules: [],
    mistakeTags: ['bad-positioning', 'bad-threat-assessment', 'bad-engage-angle', 'bad-dmg-maximisation'],
    impactPrior: { laner: 1.05, jungle: 0.95, support: 1.05 },
  },
  {
    id: 'mechanics',
    fundamentalId: 'mastery',
    rules: [],
    mistakeTags: ['whiff-skillshot', 'bad-kiting', 'wasted-summoner'],
    impactPrior: EVEN,
  },
  {
    id: 'preparation',
    fundamentalId: 'matchup_knowledge',
    rules: [],
    mistakeTags: ['bad-rune-choice'],
    impactPrior: { laner: 0.8, jungle: 0.8, support: 0.8 },
  },
  {
    id: 'objective-progress',
    fundamentalId: null,
    rules: ['objective_stagnation', 'objective_progress', 'pg_objective_respected'],
    mistakeTags: [],
    driverMetric: 'objectiveRespected',
    impactPrior: EVEN,
  },
  { id: 'self-assessment', fundamentalId: null, rules: ['kpi_bias', 'pg_self_bias', 'pg_harsh_self'], mistakeTags: [], impactPrior: EVEN, unscored: true },
  { id: 'review-habit', fundamentalId: null, rules: ['review_backlog'], mistakeTags: [], impactPrior: EVEN, unscored: true },
  { id: 'tilt-fatigue', fundamentalId: 'resilience', rules: ['tilt_break', 'loss_streak', 'long_session'], mistakeTags: [], impactPrior: EVEN, unscored: true },
  { id: 'momentum', fundamentalId: null, rules: ['win_streak'], mistakeTags: [], impactPrior: EVEN, unscored: true },
  // AS3/AS4/AS5: patterns rather than fundamentals — informational, no measurable experiment.
  { id: 'champion-pool', fundamentalId: null, rules: ['weak_champion_pool'], mistakeTags: [], impactPrior: EVEN, unscored: true },
  { id: 'play-schedule', fundamentalId: null, rules: ['bad_hour_performance'], mistakeTags: [], impactPrior: EVEN, unscored: true },
  { id: 'session-fatigue', fundamentalId: null, rules: ['session_fatigue'], mistakeTags: [], impactPrior: EVEN, unscored: true },
]

/** Catch-all for mistake tags added later and not mapped yet. */
export const OTHER_MISTAKES: Problem = {
  id: 'other-mistakes',
  fundamentalId: null,
  rules: [],
  mistakeTags: [],
  impactPrior: EVEN,
}

const BY_ID = new Map(PROBLEMS.map((p) => [p.id, p]))
const BY_RULE = new Map<string, Problem>()
const BY_TAG = new Map<string, Problem>()
for (const p of PROBLEMS) {
  for (const r of p.rules) BY_RULE.set(r, p)
  for (const t of p.mistakeTags) BY_TAG.set(t, p)
}

export function problemById(id: string): Problem | null {
  return id === OTHER_MISTAKES.id ? OTHER_MISTAKES : BY_ID.get(id) ?? null
}

export function problemForTag(tagSlug: string): Problem {
  return BY_TAG.get(tagSlug) ?? OTHER_MISTAKES
}

/** Problem of a rule; mistake rules are routed by the tag they matched. */
export function problemForRule(ruleId: string, tagSlug?: string | null): Problem {
  if (tagSlug) return problemForTag(tagSlug)
  return BY_RULE.get(ruleId) ?? OTHER_MISTAKES
}
