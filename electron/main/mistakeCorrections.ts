/**
 * The player's corrections of auto-detected mistakes (21/11/2026): « Erreurs détectées » in the review, one mistake at
 * a time (never a whole game's at once).
 * - **Remove**: the mistake leaves the Lab, and IgnoredMistake keeps the detection from creating it again.
 * - **Retag**: the mistake keeps its time and takes the player's tag. It becomes the player's (no longer
 *   auto-detected: the detection never overwrites it), and IgnoredMistake keeps the rule's tag from coming back at that
 *   time.
 * - Both write a MistakeCorrection row (layer 1 of "the engine learns from corrections"): the rule's tag, the action,
 *   the optional reason and note, the engine version, the role and the queue. Local only; nothing adapts on it yet.
 * - **Undo** (21/11/2026, « Annuler » while the panel is open): the last correction of a mistake is kept in memory
 *   (this run of the app only) and can be reverted: the mistake comes back as it was, its IgnoredMistake and its
 *   correction row are deleted.
 */
import { randomUUID } from 'node:crypto'
import { getPrisma } from './database'
import { ANALYSIS_VERSION } from './ipc/microReview.ipc'
import { CORRECTION_NOTE_MAX, CORRECTION_REASONS, summarizeCorrections, type CorrectionReason, type RuleCorrectionStats } from './mistakeCorrectionsCore'

export { CORRECTION_REASONS, CORRECTION_NOTE_MAX, summarizeCorrections } from './mistakeCorrectionsCore'
export type { CorrectionReason, RuleCorrectionStats } from './mistakeCorrectionsCore'

export interface CorrectionInput { reason?: CorrectionReason | null; note?: string | null }

/** The context of a correction, read from the game. */
async function contextOf(gameId: string): Promise<{ role: string | null; queueType: string | null }> {
  const g = await getPrisma().game.findUnique({ where: { id: gameId }, select: { role: true, queueType: true } })
  return { role: g?.role ?? null, queueType: g?.queueType ?? null }
}

/** What undoing the last correction of a mistake needs (in memory: « Annuler » lives as long as the review panel). */
type UndoEntry =
  | { kind: 'removed'; snapshot: Record<string, unknown>; ignoredId: string | null; correctionId: string | null; at: number }
  | { kind: 'retagged'; tagId: string; autoDetected: boolean; ignoredId: string | null; correctionId: string | null; at: number }
const UNDO_TTL_MS = 6 * 60 * 60 * 1000
const UNDO_MAX = 500
const undoable = new Map<string, UndoEntry>()

function rememberUndo(mistakeId: string, entry: UndoEntry): void {
  undoable.delete(mistakeId)
  undoable.set(mistakeId, entry)
  const now = Date.now()
  for (const [k, e] of undoable) if (undoable.size > UNDO_MAX || now - e.at > UNDO_TTL_MS) undoable.delete(k)
}

/** The mistake's own columns (no relations), to recreate it as it was. */
function snapshotOf(m: Record<string, unknown>): Record<string, unknown> {
  const { tag: _tag, game: _game, recording: _recording, ...own } = m
  return own
}

const clean = (input?: CorrectionInput | null) => ({
  reason: input?.reason && (CORRECTION_REASONS as readonly string[]).includes(input.reason) ? input.reason : null,
  note: input?.note?.trim().slice(0, CORRECTION_NOTE_MAX) || null,
})

/**
 * Removes one mistake. An auto-detected one is remembered (never recreated) and logged as a correction; a manual one
 * is simply deleted. Returns whether it was auto-detected.
 */
export async function removeMistake(mistakeId: string, input?: CorrectionInput | null): Promise<{ autoDetected: boolean; tagId: string }> {
  const prisma = getPrisma()
  const m = await prisma.mistake.findUnique({ where: { id: mistakeId }, include: { tag: { select: { slug: true } } } })
  if (!m) throw new Error('NOT_FOUND')
  const snapshot = snapshotOf(m as unknown as Record<string, unknown>)
  if (!m.autoDetected) {
    await prisma.mistake.delete({ where: { id: m.id } })
    rememberUndo(m.id, { kind: 'removed', snapshot, ignoredId: null, correctionId: null, at: Date.now() })
    return { autoDetected: false, tagId: m.tagId }
  }
  const ctx = await contextOf(m.gameId)
  const c = clean(input)
  const ignoredId = randomUUID()
  const correctionId = randomUUID()
  await prisma.$transaction([
    prisma.ignoredMistake.create({ data: { id: ignoredId, gameId: m.gameId, tagSlug: m.tag.slug, gameTimeSec: m.gameTimeSec } }),
    prisma.mistakeCorrection.create({
      data: { id: correctionId, mistakeId: m.id, gameId: m.gameId, ruleTag: m.tag.slug, action: 'removed', ...c, analysisVersion: ANALYSIS_VERSION, ...ctx },
    }),
    prisma.mistake.delete({ where: { id: m.id } }),
  ])
  rememberUndo(m.id, { kind: 'removed', snapshot, ignoredId, correctionId, at: Date.now() })
  return { autoDetected: true, tagId: m.tagId }
}

/** Changes the tag of one mistake (by id). Throws NOT_FOUND, UNKNOWN_TAG. */
export async function retagMistake(mistakeId: string, newTagId: string, newTagSlug: string, input?: CorrectionInput | null): Promise<{ success: true }> {
  const prisma = getPrisma()
  const m = await prisma.mistake.findUnique({ where: { id: mistakeId }, include: { tag: { select: { slug: true } } } })
  if (!m) throw new Error('NOT_FOUND')
  if (m.tagId === newTagId) return { success: true }
  const writes: any[] = [prisma.mistake.update({ where: { id: m.id }, data: { tagId: newTagId, autoDetected: false } })]
  let ignoredId: string | null = null
  let correctionId: string | null = null
  if (m.autoDetected) {
    const ctx = await contextOf(m.gameId)
    const c = clean(input)
    ignoredId = randomUUID()
    correctionId = randomUUID()
    writes.push(
      prisma.ignoredMistake.create({ data: { id: ignoredId, gameId: m.gameId, tagSlug: m.tag.slug, gameTimeSec: m.gameTimeSec } }),
      prisma.mistakeCorrection.create({
        data: { id: correctionId, mistakeId: m.id, gameId: m.gameId, ruleTag: m.tag.slug, action: 'retagged', newTag: newTagSlug, ...c, analysisVersion: ANALYSIS_VERSION, ...ctx },
      }),
    )
  }
  await prisma.$transaction(writes)
  // Retagging twice then undoing goes back to the state before the first retag (the original tag).
  const prev = undoable.get(m.id)
  if (prev?.kind === 'retagged') rememberUndo(m.id, { ...prev, ignoredId: prev.ignoredId ?? ignoredId, correctionId: prev.correctionId ?? correctionId, at: Date.now() })
  else rememberUndo(m.id, { kind: 'retagged', tagId: m.tagId, autoDetected: m.autoDetected, ignoredId, correctionId, at: Date.now() })
  return { success: true }
}

/**
 * Reverts the last removal or retag of a mistake (« Annuler »): the mistake is back as it was (tag, time, severity,
 * note, autoDetected), and its IgnoredMistake and correction row are deleted. Throws NOT_UNDOABLE when nothing was
 * corrected in this run of the app (or too long ago).
 */
export async function undoMistakeCorrection(mistakeId: string): Promise<{ success: true }> {
  const e = undoable.get(mistakeId)
  if (!e || Date.now() - e.at > UNDO_TTL_MS) throw new Error('NOT_UNDOABLE')
  const prisma = getPrisma()
  const writes: any[] = []
  if (e.kind === 'removed') {
    const exists = await prisma.mistake.findUnique({ where: { id: mistakeId }, select: { id: true } })
    if (!exists) writes.push(prisma.mistake.create({ data: e.snapshot as any }))
  } else {
    const exists = await prisma.mistake.findUnique({ where: { id: mistakeId }, select: { id: true } })
    if (!exists) throw new Error('NOT_FOUND')
    writes.push(prisma.mistake.update({ where: { id: mistakeId }, data: { tagId: e.tagId, autoDetected: e.autoDetected } }))
  }
  if (e.ignoredId) writes.push(prisma.ignoredMistake.deleteMany({ where: { id: e.ignoredId } }))
  if (e.correctionId) writes.push(prisma.mistakeCorrection.deleteMany({ where: { id: e.correctionId } }))
  await prisma.$transaction(writes)
  undoable.delete(mistakeId)
  return { success: true }
}

/** The summary for this PC's data. */
export async function correctionStatsByRule(): Promise<RuleCorrectionStats[]> {
  const prisma = getPrisma()
  const [corrections, auto] = await Promise.all([
    prisma.mistakeCorrection.findMany({ select: { ruleTag: true, action: true, newTag: true, reason: true } }),
    prisma.mistake.findMany({ where: { autoDetected: true }, select: { tag: { select: { slug: true } } } }),
  ])
  const counts = new Map<string, number>()
  for (const m of auto) counts.set(m.tag.slug, (counts.get(m.tag.slug) ?? 0) + 1)
  return summarizeCorrections(corrections, [...counts].map(([tagSlug, count]) => ({ tagSlug, count })))
}
