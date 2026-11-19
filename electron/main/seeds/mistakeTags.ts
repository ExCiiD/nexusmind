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
  // Audit E04: one read and one insert, not one lookup per built-in tag on every launch.
  const prisma = getPrisma()
  const known = new Set(
    (await prisma.mistakeTag.findMany({ where: { slug: { in: BUILT_IN_TAGS.map((t) => t.slug) } }, select: { slug: true } }))
      .map((t) => t.slug),
  )
  const missing = BUILT_IN_TAGS.filter((tag) => !known.has(tag.slug))
  if (missing.length > 0) {
    await prisma.mistakeTag.createMany({
      data: missing.map((tag) => ({
        slug: tag.slug,
        label: tag.label,
        category: tag.category,
        icon: tag.icon ?? null,
        color: tag.color ?? null,
        isBuiltIn: true,
      })),
    })
  }
  const inserted = missing.length
  const existing = BUILT_IN_TAGS.length - inserted
  if (inserted > 0) console.log(`[seed] Mistake tags: ${inserted} new built-in tag(s) inserted.`)
  return { inserted, existing }
}
