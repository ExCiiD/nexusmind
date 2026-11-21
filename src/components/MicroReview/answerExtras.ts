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
export interface AnswerExtras { reasons: string; extraTags: ExtraTag[] }

export const EMPTY_EXTRAS: AnswerExtras = { reasons: '', extraTags: [] }

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
