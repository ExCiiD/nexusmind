/**
 * Automatic post-game verification of session objectives
 * (docs/PLAN_MICRO_REVIEW.md §D). Each fundamental a session can target maps
 * to one rule built from what the game left behind: the mistake tags of the
 * review (auto-detected + micro-review, `justified` answers excluded since
 * they create no tag) and the timeline facts of the anomaly detector.
 *
 * Example — vision objective validated when there is 0 `no-ward-pre-obj` tag
 * AND the player placed ≥ 1 ward near the pit before every contested
 * objective whose vision was theirs to provide (`accountable`: every
 * objective for a support or a jungler, the ones the team lost for a laner,
 * never one the player was dead for — the same rule as the auto-detected
 * tag, so the two halves of the check cannot contradict each other).
 */

import type { ContestedObjective } from './anomalyDetector'

export type VerificationStatus = 'passed' | 'failed' | 'unknown'
export type RuleId = 'ward-before-objectives' | 'no-isolated-death' | 'gold-spent' | 'no-overstay' | 'cs-at-10' | 'positioning' | 'trades' | 'mechanics'

export interface VerificationInput {
  /** Slugs of every Mistake recorded for the game. */
  tags: string[]
  /** Epic objectives of the game, null when the timeline is unavailable. */
  contested: ContestedObjective[] | null
  /** CS difference at 10:00 vs the direct opponent, when known. */
  csDiff10?: number | null
  /** The game has been reviewed (micro-review done or review saved). Without it, a clean tag list proves nothing. */
  reviewed: boolean
}

export interface VerificationResult {
  fundamentalId: string
  ruleId: RuleId
  status: VerificationStatus
  /** Tags of the rule found in the game. */
  failedTags: string[]
  objectivesWarded?: number
  objectivesTotal?: number
  csDiff10?: number | null
}

interface Rule { id: RuleId; fundamentals: string[]; tags: string[] }

export const RULES: Rule[] = [
  { id: 'ward-before-objectives', fundamentals: ['vision_control', 'vision_setup', 'wave_management_objectives'], tags: ['no-ward-pre-obj', 'no-vision-objective'] },
  { id: 'no-isolated-death', fundamentals: ['map_awareness', 'jungle_tracking', 'fog_usage'], tags: ['caught-out', 'solo-baron-died'] },
  { id: 'gold-spent', fundamentals: ['recall_timing', 'itemization', 'resource_management'], tags: ['unused-gold', 'late-back'] },
  { id: 'no-overstay', fundamentals: ['tempo', 'decision_making'], tags: ['overstay', 'death-before-objective', 'dove-tower'] },
  { id: 'cs-at-10', fundamentals: ['csing_pathing', 'wave_management'], tags: ['cs-deficit', 'xp-deficit'] },
  { id: 'positioning', fundamentals: ['positioning', 'prefight_positioning', 'rotation_positioning', 'spacing', 'threat_assessment'], tags: ['bad-positioning', 'bad-threat-assessment', 'bad-engage-angle'] },
  { id: 'trades', fundamentals: ['trades', 'aggression_calibration', 'limits_knowledge'], tags: ['bad-trade'] },
  { id: 'mechanics', fundamentals: ['mastery', 'summoner_spells'], tags: ['whiff-skillshot', 'bad-kiting', 'wasted-summoner'] },
]

export const CS_DIFF_LIMIT = -15

export function ruleFor(fundamentalId: string): Rule | null {
  return RULES.find((r) => r.fundamentals.includes(fundamentalId)) ?? null
}

export function verifyObjective(fundamentalId: string, input: VerificationInput): VerificationResult | null {
  const rule = ruleFor(fundamentalId)
  if (!rule) return null
  const failedTags = [...new Set(input.tags.filter((t) => rule.tags.includes(t)))]
  const base = { fundamentalId, ruleId: rule.id, failedTags }

  if (rule.id === 'ward-before-objectives') {
    // Analyses stored before `accountable` existed count every objective, as they did.
    const counted = input.contested?.filter((c) => c.accountable !== false) ?? []
    const total = counted.length
    const warded = counted.filter((c) => c.playerWarded).length
    const extra = { objectivesWarded: warded, objectivesTotal: total }
    if (failedTags.length || (total > 0 && warded < total)) return { ...base, ...extra, status: 'failed' }
    if (input.contested == null && !input.reviewed) return { ...base, ...extra, status: 'unknown' }
    // Wards checked from the timeline; tags need a review to be meaningful.
    if (total === 0 && !input.reviewed) return { ...base, ...extra, status: 'unknown' }
    return { ...base, ...extra, status: 'passed' }
  }

  if (rule.id === 'cs-at-10') {
    const cs = input.csDiff10 ?? null
    if (failedTags.length || (cs != null && cs < CS_DIFF_LIMIT)) return { ...base, csDiff10: cs, status: 'failed' }
    if (cs == null && !input.reviewed) return { ...base, csDiff10: cs, status: 'unknown' }
    return { ...base, csDiff10: cs, status: 'passed' }
  }

  if (failedTags.length) return { ...base, status: 'failed' }
  return { ...base, status: input.reviewed ? 'passed' : 'unknown' }
}

/** Every session objective that has a rule; `overall` is null when nothing could be judged. */
export function verifySessionObjectives(objectiveIds: string[], input: VerificationInput): { results: VerificationResult[]; overall: boolean | null } {
  const results = objectiveIds.map((id) => verifyObjective(id, input)).filter((r): r is VerificationResult => r != null)
  const judged = results.filter((r) => r.status !== 'unknown')
  return { results, overall: judged.length ? judged.every((r) => r.status === 'passed') : null }
}
