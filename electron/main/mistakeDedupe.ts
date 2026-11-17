/**
 * "Is this the same mistake?" — one rule shared by the auto-detector (which
 * must not re-create a row the player already has) and the micro-review
 * (which must not duplicate an auto-detected row when the player picks the
 * same tag for that moment).
 *
 * Two rows of the same tag are the same mistake when they are at most 3 s
 * apart. Objective moments need more room: the micro-review anchors them
 * 15–30 s before the objective falls, while the auto-detected
 * `no-ward-pre-obj` is stamped 90 s before it — 60 to 75 s earlier.
 */

import { getPrisma } from './database'

/** Seconds around a Mistake inside which an auto-detected candidate of the same tag is the same mistake. */
export const AUTO_DEDUPE_SEC = 3
/** Seconds around a micro-review moment inside which a Mistake of the same tag is the same mistake. */
export const MOMENT_WINDOW = { before: 20, after: 20 } as const
/** Same, for the moments of the `absent-objective` trigger (see header). */
export const OBJECTIVE_MOMENT_WINDOW = { before: 90, after: 30 } as const

export const momentWindow = (trigger: string) => (trigger === 'absent-objective' ? OBJECTIVE_MOMENT_WINDOW : MOMENT_WINDOW)

export interface MistakeDuplicateIndex {
  /** An auto-detected candidate of this tag at this time would repeat a Mistake the game already has. */
  has(tagId: string, gameTimeSec: number): boolean
  /** Records a Mistake just created, so the next candidates see it. */
  add(tagId: string, gameTimeSec: number): void
}

/**
 * Index of the Mistakes a game already has, whoever made them (auto-detected,
 * confirmed by a micro-review answer, tagged by hand).
 */
export async function mistakeDuplicateIndex(gameId: string): Promise<MistakeDuplicateIndex> {
  const prisma = getPrisma()
  const [existing, objectiveAnswers] = await Promise.all([
    prisma.mistake.findMany({ where: { gameId }, select: { id: true, tagId: true, gameTimeSec: true } }),
    prisma.microReviewAnswer.findMany({ where: { gameId, trigger: 'absent-objective', mistakeId: { not: null } }, select: { mistakeId: true } }),
  ])
  const objectiveRows = new Set(objectiveAnswers.map((a) => a.mistakeId))
  const byTag = new Map<string, Array<{ t: number; objective: boolean }>>()
  for (const m of existing) {
    const list = byTag.get(m.tagId) ?? []
    list.push({ t: m.gameTimeSec, objective: objectiveRows.has(m.id) })
    byTag.set(m.tagId, list)
  }
  return {
    has: (tagId, gameTimeSec) => (byTag.get(tagId) ?? []).some((m) =>
      Math.abs(m.t - gameTimeSec) <= AUTO_DEDUPE_SEC ||
      // The row belongs to an objective moment: a candidate up to 90 s before it (30 s after) is that same objective.
      (m.objective && gameTimeSec >= m.t - OBJECTIVE_MOMENT_WINDOW.before && gameTimeSec <= m.t + OBJECTIVE_MOMENT_WINDOW.after)),
    add: (tagId, gameTimeSec) => {
      const list = byTag.get(tagId) ?? []
      list.push({ t: gameTimeSec, objective: false })
      byTag.set(tagId, list)
    },
  }
}
