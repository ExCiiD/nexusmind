/**
 * MX3 — learned severity threshold. If the player deletes an auto-detected
 * mistake of the same tag `DELETIONS_TO_LEARN` times, every future
 * auto-detection of that tag for them starts one severity level lower.
 * Simplification over the catalogue's exact wording: the count is lifetime
 * (never reset by re-creating the tag), kept simple and provable rather than
 * tracking "was it re-created after each deletion" — documented in
 * docs/AUDIT_REGLES_METIER.md.
 */

export const DELETIONS_TO_LEARN = 3
export const LEARNED_SEVERITY_DELTA = -1

/** The next (deletedCount, severityDelta) after one more deletion of that tag. */
export function nextTuning(deletedCount: number): { deletedCount: number; severityDelta: number } {
  const next = deletedCount + 1
  return { deletedCount: next, severityDelta: next >= DELETIONS_TO_LEARN ? LEARNED_SEVERITY_DELTA : 0 }
}

/** Base severity (1-3) adjusted by the learned delta, clamped back into 1-3. */
export function applySeverityDelta(baseSeverity: number, delta: number): number {
  return Math.min(3, Math.max(1, baseSeverity + delta))
}
