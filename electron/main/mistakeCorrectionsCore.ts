/** Pure part of the player's corrections of auto-detected mistakes (mistakeCorrections.ts, 21/11/2026). */
export const CORRECTION_REASONS = ['not_a_mistake', 'wrong_tag', 'wrong_time', 'team_context', 'other'] as const
export type CorrectionReason = (typeof CORRECTION_REASONS)[number]
export const CORRECTION_NOTE_MAX = 300

// ── Per-rule summary, for the future registry (no screen yet) ───────────────

export interface RuleCorrectionStats {
  ruleTag: string
  /** Mistakes this rule produced: the ones still auto-detected plus the ones corrected. */
  detected: number
  removed: number
  retagged: number
  removalRate: number
  retagRate: number
  /** The most frequent "this rule → the player's tag", most frequent first. */
  topRetags: Array<{ to: string; count: number }>
  reasons: Partial<Record<CorrectionReason, number>>
}

/** Pure: the summary from the corrections and the auto-detected mistakes still standing, per tag. */
export function summarizeCorrections(
  corrections: Array<{ ruleTag: string; action: string; newTag: string | null; reason: string | null }>,
  standing: Array<{ tagSlug: string; count: number }>,
  topPairs = 3,
): RuleCorrectionStats[] {
  const rules = new Set([...corrections.map((c) => c.ruleTag), ...standing.map((s) => s.tagSlug)])
  const round = (v: number) => Math.round(v * 1000) / 1000
  return [...rules].map((ruleTag) => {
    const mine = corrections.filter((c) => c.ruleTag === ruleTag)
    const removed = mine.filter((c) => c.action === 'removed').length
    const retags = mine.filter((c) => c.action === 'retagged')
    const detected = (standing.find((s) => s.tagSlug === ruleTag)?.count ?? 0) + mine.length
    const pairs = new Map<string, number>()
    for (const r of retags) if (r.newTag) pairs.set(r.newTag, (pairs.get(r.newTag) ?? 0) + 1)
    const reasons: Partial<Record<CorrectionReason, number>> = {}
    for (const c of mine) if (c.reason && (CORRECTION_REASONS as readonly string[]).includes(c.reason)) reasons[c.reason as CorrectionReason] = (reasons[c.reason as CorrectionReason] ?? 0) + 1
    return {
      ruleTag, detected, removed, retagged: retags.length,
      removalRate: detected ? round(removed / detected) : 0,
      retagRate: detected ? round(retags.length / detected) : 0,
      topRetags: [...pairs].map(([to, count]) => ({ to, count })).sort((a, b) => b.count - a.count || a.to.localeCompare(b.to)).slice(0, topPairs),
      reasons,
    }
  }).sort((a, b) => b.removalRate + b.retagRate - (a.removalRate + a.retagRate) || a.ruleTag.localeCompare(b.ruleTag))
}

