/**
 * Built-in Mistake Library tags — the single source for the desktop seed
 * (electron/main/seeds/mistakeTags.ts, idempotent upsert on `slug`) and for
 * the web app, which has no local database to read them from.
 *
 * Categories drive the grouping in the tag picker:
 *   macro   — map awareness, rotations, objectives
 *   micro   — mechanical / trading mistakes
 *   vision  — wards, control, info gathering
 *   economy — gold flow, recall timing, items
 *   draft   — pre-game choices (runes, summoners)
 *
 * `slug` is referenced by mistakeDetector.ts, the micro-review QCM and the
 * AscendCodex — keep these stable across releases.
 */

export interface BuiltInMistakeTag {
  slug: string
  label: string
  category: 'macro' | 'micro' | 'vision' | 'economy' | 'draft'
  icon?: string
  color?: string
}

export const BUILT_IN_MISTAKE_TAGS: BuiltInMistakeTag[] = [
  // Macro
  { slug: 'overstay',           label: 'Overstay',                category: 'macro',   color: '#E24C3A' },
  { slug: 'dove-tower',         label: 'Dove tower',              category: 'macro',   color: '#E24C3A' },
  { slug: 'face-checked',       label: 'Face-checked bush',       category: 'macro',   color: '#E24C3A' },
  { slug: 'no-vision-objective',label: 'Objective with no vision',category: 'macro',   color: '#FFB454' },
  { slug: 'solo-baron-died',    label: 'Solo Baron / died',       category: 'macro',   color: '#E24C3A' },
  { slug: 'bad-lane-opening',   label: 'Bad lane opening',        category: 'macro',   color: '#FFB454' },
  { slug: 'bad-wave-sync',      label: 'Bad wave synchronisation',category: 'macro',   color: '#FFB454' },
  // Micro
  { slug: 'bad-trade',          label: 'Bad trade',               category: 'micro',   color: '#FFB454' },
  { slug: 'wasted-summoner',    label: 'Wasted summoner',         category: 'micro',   color: '#FFB454' },
  { slug: 'whiff-skillshot',    label: 'Whiffed key skillshot',   category: 'micro',   color: '#FFB454' },
  { slug: 'bad-positioning',    label: 'Bad positioning',         category: 'micro',   color: '#FFB454' },
  { slug: 'bad-kiting',         label: 'Bad kiting',              category: 'micro',   color: '#FFB454' },
  { slug: 'bad-threat-assessment', label: 'Bad threat assessment', category: 'micro', color: '#FFB454' },
  { slug: 'bad-engage-angle',   label: 'Bad engage angle',        category: 'micro',   color: '#FFB454' },
  { slug: 'bad-dmg-maximisation', label: 'Bad dmg maximisation',  category: 'micro',   color: '#FFB454' },
  // Vision
  { slug: 'forgot-trinket',     label: 'Forgot trinket up',       category: 'vision',  color: '#3E8E7E' },
  { slug: 'no-ward-pre-obj',    label: 'No ward pre-objective',   category: 'vision',  color: '#3E8E7E' },
  { slug: 'walked-into-ward',   label: 'Walked into enemy ward',  category: 'vision',  color: '#3E8E7E' },
  // Macro — detected automatically (docs/AUDIT_REGLES_METIER.md M5, M9)
  { slug: 'death-before-objective', label: 'Died before a lost objective', category: 'macro', color: '#E24C3A' },
  { slug: 'caught-out',         label: 'Caught out alone',        category: 'macro',   color: '#E24C3A' },
  // Economy
  { slug: 'late-back',          label: 'Late back',               category: 'economy', color: '#D4A24C' },
  { slug: 'unused-gold',        label: 'Died with unspent gold',  category: 'economy', color: '#D4A24C' },
  { slug: 'cs-deficit',         label: 'CS deficit at 10 min',    category: 'economy', color: '#D4A24C' },
  { slug: 'xp-deficit',         label: 'XP deficit vs opponent',  category: 'economy', color: '#D4A24C' },
  { slug: 'behind-on-levels-death', label: 'Died behind on levels', category: 'economy', color: '#D4A24C' },
  // Draft
  { slug: 'bad-rune-choice',    label: 'Bad rune choice',         category: 'draft',   color: '#A78BFA' },
]

/** The catalog in the shape `listMistakeTags` returns (the slug doubles as the id where there is no database). */
export function builtInTagsAsRows(): Array<{ id: string; slug: string; label: string; category: string; icon: string | null; color: string | null; isBuiltIn: true; archivedAt: null; createdAt: string }> {
  return BUILT_IN_MISTAKE_TAGS.map((t) => ({
    id: t.slug, slug: t.slug, label: t.label, category: t.category, icon: t.icon ?? null, color: t.color ?? null, isBuiltIn: true, archivedAt: null, createdAt: '',
  }))
}
