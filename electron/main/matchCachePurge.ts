import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { getPrisma } from './database'
import { GZ_PREFIX } from './matchStoreCore'
import { shouldVacuum } from './dbMaintenanceCore'

/**
 * Decision M (audit E06, 19/11/2026): MatchCache grew without limit. Each timeline weighs 0.5 to 2 MB, and every
 * local migration copies the whole database (VACUUM INTO) before it runs. Timelines are only read for the user's
 * own games (micro-review, mistakes, lane phase, detailed stats); scouting and team stats read the match body.
 *
 * So, once a day: the timeline of a cached match older than PURGE_AFTER_DAYS that no Game refers to is dropped.
 * The match body stays, and a timeline needed again is downloaded again on demand (stats.ipc.ts already does).
 *
 * Health check of 28/11/2026 (database 494 MB, MatchCache 329 MB of it): two more steps, neither drops any data.
 * - **Plain timelines are compressed.** Since gain 6 (20/11) timelines are written gzip-compressed, but the ones
 *   written before were only compressed when read again: 209 still weighed 144 MB (700 KB each, ~85 KB once
 *   compressed). They are now compressed in the background, a few at a time, off the main thread.
 * - **Free pages are given back.** SQLite reuses freed pages but never shrinks the file (139 MB were free). A
 *   VACUUM runs when the free space is worth it (dbMaintenanceCore.ts) and no game is being recorded.
 * Measured on a copy of the real database: 494 MB → 215 MB, compression 2.9 s, VACUUM 2.6 s.
 */
export const PURGE_AFTER_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
const COMPRESS_BATCH = 8

const gzipAsync = promisify(gzip)

/** Drops the old unlinked timelines; returns how many. */
export async function purgeOldTimelines(now: Date = new Date(), days: number = PURGE_AFTER_DAYS): Promise<number> {
  const before = new Date(now.getTime() - days * DAY_MS)
  return getPrisma().$executeRawUnsafe(
    `UPDATE "MatchCache" SET "timelineJson" = NULL
       WHERE "timelineJson" IS NOT NULL
         AND "createdAt" < ?
         AND "matchId" NOT IN (SELECT "matchId" FROM "Game" WHERE "matchId" IS NOT NULL)`,
    before,
  )
}

/**
 * Rewrites every timeline still stored as plain JSON in its compressed form (the form matchStore.ts writes and
 * reads). Same content, ~8 times smaller. A row is only rewritten if it is still the plain value read, so a
 * concurrent write always wins. Returns how many were compressed.
 */
export async function compressPlainTimelines(batch: number = COMPRESS_BATCH): Promise<number> {
  const prisma = getPrisma()
  let done = 0
  const skipped = new Set<string>()
  for (;;) {
    const rows = await prisma.$queryRawUnsafe<{ matchId: string; timelineJson: string }[]>(
      `SELECT "matchId", "timelineJson" FROM "MatchCache"
         WHERE "timelineJson" IS NOT NULL AND "timelineJson" <> '' AND substr("timelineJson", 1, ${GZ_PREFIX.length}) <> ?
         ORDER BY "matchId" LIMIT ?`,
      GZ_PREFIX, batch + skipped.size,
    )
    const todo = rows.filter((r) => !skipped.has(r.matchId))
    if (todo.length === 0) return done
    for (const row of todo) {
      const packed = GZ_PREFIX + (await gzipAsync(Buffer.from(row.timelineJson, 'utf-8'), { level: 6 })).toString('base64')
      const n = await prisma.$executeRawUnsafe(
        `UPDATE "MatchCache" SET "timelineJson" = ? WHERE "matchId" = ? AND "timelineJson" = ?`,
        packed, row.matchId, row.timelineJson,
      )
      if (n > 0) done++
      else skipped.add(row.matchId) // changed meanwhile: left to its writer
    }
  }
}

/** The database's page counts, and a VACUUM when enough of the file is free pages. Returns the bytes given back. */
export async function reclaimFreePages(): Promise<number> {
  const prisma = getPrisma()
  const pragma = async (name: string): Promise<number> => {
    const rows = await prisma.$queryRawUnsafe<Record<string, number | bigint>[]>(`PRAGMA ${name}`)
    return Number(Object.values(rows[0] ?? {})[0] ?? 0)
  }
  const [pageSize, pageCount, freePages] = await Promise.all([pragma('page_size'), pragma('page_count'), pragma('freelist_count')])
  if (!shouldVacuum({ pageSize, pageCount, freePages })) return 0
  await prisma.$executeRawUnsafe('VACUUM')
  const after = await pragma('page_count')
  return Math.max(0, (pageCount - after) * pageSize)
}

/**
 * Two minutes after launch (out of the startup path), then once a day: purge, compress, give the space back.
 * `isBusy` (a game being recorded) postpones the VACUUM, which holds the database for a few seconds.
 */
export function startMatchCachePurge(isBusy: () => boolean = () => false): void {
  const run = async () => {
    try {
      const n = await purgeOldTimelines()
      if (n > 0) console.log(`[match-cache] dropped ${n} old timeline(s) not tied to a game`)
      const c = await compressPlainTimelines()
      if (c > 0) console.log(`[match-cache] compressed ${c} timeline(s) stored as plain JSON`)
      if (!isBusy()) {
        const freed = await reclaimFreePages()
        if (freed > 0) console.log(`[db] VACUUM gave back ${Math.round(freed / 1048576)} MB`)
      }
    } catch (err) {
      console.warn('[match-cache] maintenance failed:', (err as Error)?.message)
    }
  }
  setTimeout(() => { void run() }, 2 * 60_000)
  setInterval(() => { void run() }, DAY_MS)
}
