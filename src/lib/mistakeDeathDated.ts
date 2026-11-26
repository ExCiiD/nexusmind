/**
 * Which errors are dated from a death (20/11/2026, docs/moteur/engine-reports/2026-11-20-lieux-et-extraits-video-des-cartes.md
 * § 6). The user: "la règle des 45 s devrait se faire pour les morts tout court" — such an error plays from the death
 * − 45 s to + 30 s on every screen (the player, the Lab, the bookmarks, the review notes), so the trade that caused
 * the death is seen, not only the death.
 *
 * The stored time of the error never changes (the ±3 s / ±20 s deduplication depends on it): this is only a reading
 * rule. Front-End's playbackWindowOf (src/lib/microReview/vodTiming.ts) turns it into the window.
 */

/**
 * Auto-detected mistakes the rules date at the player's death: M1 unused-gold, M2 dove-tower, M4 overstay, M5
 * death-before-objective, M8 solo-baron-died, M9 caught-out, M10 bad-trade, M11 bad-positioning,
 * M15 dead-during-objective, M19 behind-on-levels-death.
 *
 * Not in it, dated on something else: no-ward-pre-obj (M6, the objective window), forgot-trinket (M7),
 * bad-lane-opening (M12, 5:00), cs-deficit / xp-deficit (M13, M14, 10:00), late-back (M3, arrival in base).
 */
export const DEATH_DATED_MISTAKE_TAGS = [
  'unused-gold', 'dove-tower', 'overstay', 'death-before-objective', 'solo-baron-died',
  'caught-out', 'bad-trade', 'bad-positioning', 'dead-during-objective', 'behind-on-levels-death',
] as const

export type DeathDatedMistakeTag = (typeof DEATH_DATED_MISTAKE_TAGS)[number]

const TAGS: ReadonlySet<string> = new Set(DEATH_DATED_MISTAKE_TAGS)

/** The micro-review trigger whose moments are a death. */
export const DEATH_TRIGGER = 'critical-death'

/**
 * Whether a mistake is dated from a death.
 * - Auto-detected (`autoDetected`): by its tag.
 * - Recorded from a micro-review answer (`answerTrigger`, the answer's `trigger`): when the moment was a death,
 *   whatever the tag chosen.
 * - Tagged by hand: never, the player chose that second.
 */
export function isDeathDatedMistake(m: { tagSlug?: string | null; autoDetected?: boolean | null; answerTrigger?: string | null }): boolean {
  if (m.answerTrigger) return m.answerTrigger === DEATH_TRIGGER
  return !!m.autoDetected && !!m.tagSlug && TAGS.has(m.tagSlug)
}

/** Whether a micro-review answer (or moment) is dated from a death. */
export function isDeathDatedAnswer(a: { trigger?: string | null }): boolean {
  return a.trigger === DEATH_TRIGGER
}
