import { getPrisma } from './database'

/**
 * Decision M (audit E06, 19/11/2026): MatchCache grew without limit. Each timeline weighs 0.5 to 2 MB, and every
 * local migration copies the whole database (VACUUM INTO) before it runs. Timelines are only read for the user's
 * own games (micro-review, mistakes, lane phase, detailed stats); scouting and team stats read the match body.
 *
 * So, once a day: the timeline of a cached match older than PURGE_AFTER_DAYS that no Game refers to is dropped.
 * The match body stays, and a timeline needed again is downloaded again on demand (stats.ipc.ts already does).
 * Freed pages are reused by SQLite; the file itself shrinks at the next migration's VACUUM INTO.
 */
export const PURGE_AFTER_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

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

/** Two minutes after launch (out of the startup path), then once a day. */
export function startMatchCachePurge(): void {
  const run = () => {
    purgeOldTimelines()
      .then((n) => { if (n > 0) console.log(`[match-cache] dropped ${n} old timeline(s) not tied to a game`) })
      .catch((err) => console.warn('[match-cache] purge failed:', (err as Error)?.message))
  }
  setTimeout(run, 2 * 60_000)
  setInterval(run, DAY_MS)
}
