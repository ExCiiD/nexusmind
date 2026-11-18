/**
 * Slug of a personal (custom) mistake tag, derived from its label.
 *
 * One algorithm for every place that names such a tag: the Mistake Library
 * ("create tag"), the Team Codex form, and the micro-review's "Autre cause"
 * (`resolveTag` in electron/main/ipc/microReview.ipc.ts applies the same
 * steps). A team rule written for a custom mistake is matched by slug, so
 * the same label typed by the coach and by a player must give the same slug.
 *
 * Accents are folded ("Priorité" gives "priorite"); they are never turned
 * into separators. The result always satisfies `^[a-z0-9-]{1,64}$`, the
 * shape the cloud tables accept.
 */
export function mistakeSlug(label: string): string {
  return label.trim().slice(0, 60)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'custom'
}

/**
 * A slug shown to someone who does not have the tag in their own library
 * (another staff member reading a team rule): "mauvais-reset-avant-drake"
 * reads "Mauvais reset avant drake". Accents cannot be recovered.
 */
export function slugAsLabel(slug: string): string {
  const words = slug.replace(/-+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug
}

/** Accent- and case-insensitive key, to compare what was typed with a label. */
export function foldLabel(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
