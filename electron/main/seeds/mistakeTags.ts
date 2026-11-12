/**
 * Built-in Mistake Library tags — seeded on every app start (idempotent
 * via `upsert` on the unique `slug`). Editing this list adds new tags
 * without ever overwriting user-created or user-edited ones.
 *
 * Categories drive the grouping in the tag picker:
 *   macro   — map awareness, rotations, objectives
 *   micro   — mechanical / trading mistakes
 *   vision  — wards, control, info gathering
 *   economy — gold flow, recall timing, items
 *   draft   — pre-game choices (runes, summoners)
 *
 * `slug` is also referenced by mistakeDetector.ts heuristics — keep these
 * stable across releases.
 */
import { getPrisma } from '../database'

interface BuiltInTag {
  slug: string
  label: string
  category: 'macro' | 'micro' | 'vision' | 'economy' | 'draft'
  icon?: string
  color?: string
}

const BUILT_IN_TAGS: BuiltInTag[] = [
  // Macro
  { slug: 'overstay',           label: 'Overstay',                category: 'macro',   color: '#FF4655' },
  { slug: 'dove-tower',         label: 'Dove tower',              category: 'macro',   color: '#FF4655' },
  { slug: 'face-checked',       label: 'Face-checked bush',       category: 'macro',   color: '#FF4655' },
  { slug: 'no-vision-objective',label: 'Objective with no vision',category: 'macro',   color: '#FFB454' },
  { slug: 'solo-baron-died',    label: 'Solo Baron / died',       category: 'macro',   color: '#FF4655' },
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
  { slug: 'forgot-trinket',     label: 'Forgot trinket up',       category: 'vision',  color: '#0AC8B9' },
  { slug: 'no-ward-pre-obj',    label: 'No ward pre-objective',   category: 'vision',  color: '#0AC8B9' },
  { slug: 'walked-into-ward',   label: 'Walked into enemy ward',  category: 'vision',  color: '#0AC8B9' },
  // Economy
  { slug: 'late-back',          label: 'Late back',               category: 'economy', color: '#C8AA6E' },
  { slug: 'unused-gold',        label: 'Died with unspent gold',  category: 'economy', color: '#C8AA6E' },
  // Draft
  { slug: 'bad-rune-choice',    label: 'Bad rune choice',         category: 'draft',   color: '#A78BFA' },
]

/**
 * Idempotent — runs on every Electron start after the DB is initialised.
 * Inserts new built-ins, never overwrites user changes. Safe to call from
 * a background tick or migration runner.
 */
export async function seedBuiltInMistakeTags(): Promise<{ inserted: number; existing: number }> {
  const prisma = getPrisma()
  let inserted = 0
  let existing = 0
  for (const tag of BUILT_IN_TAGS) {
    const existed = await prisma.mistakeTag.findUnique({ where: { slug: tag.slug } })
    if (existed) {
      existing++
      continue
    }
    await prisma.mistakeTag.create({
      data: {
        slug: tag.slug,
        label: tag.label,
        category: tag.category,
        icon: tag.icon ?? null,
        color: tag.color ?? null,
        isBuiltIn: true,
      },
    })
    inserted++
  }
  if (inserted > 0) console.log(`[seed] Mistake tags: ${inserted} new built-in tag(s) inserted.`)
  return { inserted, existing }
}
