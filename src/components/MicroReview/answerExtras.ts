/**
 * Micro-review box additions (DECISIONS 21/11): « Raisons de l'erreur d'après moi » (free text) and extra error tags,
 * each with an optional description (e.g. 1:17 critical death → archetype misread + why, + bad trade). Sent with the
 * answer: the reasons in `note`, the tags in `extraTags` (Back-end saves each as a manual mistake at the moment's
 * time). Pure, tested.
 */

export const MAX_EXTRA_TAGS = 5
const MAX_REASONS = 1000
const MAX_TAG_NOTE = 280
const MAX_BOOKMARK_LABEL = 80

export interface ExtraTag { key: string; tagSlug: string; note: string }
export interface AnswerExtras {
  reasons: string
  extraTags: ExtraTag[]
  /** « Définir les timestamps précis » (beta.20): the error's and the consequence's game time, each optional. */
  errorAtSec: number | null
  consequenceAtSec: number | null
}

export const EMPTY_EXTRAS: AnswerExtras = { reasons: '', extraTags: [], errorAtSec: null, consequenceAtSec: null }

/** Back refuses a consequence before the error (BAD_TIMESTAMPS): both set, the consequence must not come first. */
export function preciseTimesOk(extras: AnswerExtras): boolean {
  return extras.errorAtSec == null || extras.consequenceAtSec == null || extras.consequenceAtSec >= extras.errorAtSec
}

/** A reopened card: its saved precise timestamps (MicroReviewAnswerView), nothing else. */
export function extrasOfAnswer(a: { errorAtSec?: number | null; consequenceAtSec?: number | null } | null | undefined): AnswerExtras {
  if (a?.errorAtSec == null && a?.consequenceAtSec == null) return EMPTY_EXTRAS
  return { ...EMPTY_EXTRAS, errorAtSec: a?.errorAtSec ?? null, consequenceAtSec: a?.consequenceAtSec ?? null }
}

/** The precise timestamps sent (whole game seconds, 0-36000), only the ones the player set. */
export function preciseTimesPayload(extras: AnswerExtras): { errorAtSec?: number; consequenceAtSec?: number } {
  const ok = (s: number | null | undefined) => (s != null && Number.isFinite(s) ? Math.min(36000, Math.max(0, Math.round(s))) : undefined)
  const out: { errorAtSec?: number; consequenceAtSec?: number } = {}
  const e = ok(extras.errorAtSec), c = ok(extras.consequenceAtSec)
  if (e !== undefined) out.errorAtSec = e
  if (c !== undefined) out.consequenceAtSec = c
  return out
}

/** The answer's `note`: the « autre cause » note and the player's reasons, both kept. */
export function answerNote(otherNote: string | null | undefined, extras: AnswerExtras): string | null {
  const parts = [otherNote?.trim(), extras.reasons.trim()].filter((x): x is string => !!x)
  return parts.length ? parts.join('\n').slice(0, MAX_REASONS) : null
}

/** The extra tags sent: a tag chosen, not the answer's own tag, no duplicate, at most 5. */
export function extraTagsPayload(extras: AnswerExtras, answerTagSlug: string | null | undefined): Array<{ tagSlug: string; note: string | null }> {
  const seen = new Set<string>(answerTagSlug ? [answerTagSlug] : [])
  const out: Array<{ tagSlug: string; note: string | null }> = []
  for (const x of extras.extraTags) {
    if (!x.tagSlug || seen.has(x.tagSlug)) continue
    seen.add(x.tagSlug)
    out.push({ tagSlug: x.tagSlug, note: x.note.trim().slice(0, MAX_TAG_NOTE) || null })
    if (out.length >= MAX_EXTRA_TAGS) break
  }
  return out
}

/** The bookmark's label (« note marquée »): the moment's title, then the tag the player chose. */
export function bookmarkLabelOf(title: string, tagText: string | null | undefined): string {
  const s = tagText ? `${title} — ${tagText}` : title
  return s.length > MAX_BOOKMARK_LABEL ? `${s.slice(0, MAX_BOOKMARK_LABEL - 1)}…` : s
}

/** « 1:17 » or « 77 » → seconds; null when it is not a time. */
export function parseClock(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):([0-5]\d)$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  return /^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : null
}
