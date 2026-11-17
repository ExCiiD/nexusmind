/**
 * Built-in Mistake Library tags — seeded on every app start (idempotent
 * via `upsert` on the unique `slug`). Editing this list adds new tags
 * without ever overwriting user-created or user-edited ones.
 *
 * The list itself lives in src/lib/mistakeTagCatalog.ts (shared with the web
 * app, which has no local database).
 */
import { getPrisma } from '../database'
import { BUILT_IN_MISTAKE_TAGS as BUILT_IN_TAGS } from '../../../src/lib/mistakeTagCatalog'

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
