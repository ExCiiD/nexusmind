/**
 * Detailed stats of a match for a player, kept across restarts (AUDIT_PERF_2 gain 1, 20/11/2026).
 *
 * The RAM memo (detailedStatsMemo.ts) was lost at every restart: the radar, the averages and autoSnapshot read
 * and parsed 40 to 100 matches and timelines again (0.1 s with a warm disk, 4.3 s cold). They are now also stored
 * in the local DetailedStatsMemo table, a few KB per match, read in one query before MatchCache.
 *
 * DETAILED_STATS_VERSION is the formula's version (extractDetailedStats): bump it when the formula changes, and
 * every stored row is computed again on its next read. Only complete results are stored (with the timeline).
 */
import { getPrisma } from './database'
import type { DetailedStats } from './detailedStatsMemo'

type Prisma = ReturnType<typeof getPrisma>

export const DETAILED_STATS_VERSION = 1

const key = (matchId: string, puuid: string) => `${matchId}:${puuid}`

/** The stored stats of these matches for these puuids (current version), keyed `matchId:puuid`. */
export async function readStoredDetailedStats(prisma: Prisma, matchIds: string[], puuids: string[]): Promise<Map<string, DetailedStats>> {
  const out = new Map<string, DetailedStats>()
  if (matchIds.length === 0 || puuids.length === 0) return out
  const rows = await prisma.detailedStatsMemo.findMany({
    where: { matchId: { in: matchIds }, puuid: { in: puuids }, version: DETAILED_STATS_VERSION },
  }).catch(() => [])
  for (const r of rows) {
    try { out.set(key(r.matchId, r.puuid), JSON.parse(r.statsJson) as DetailedStats) } catch { /* computed again */ }
  }
  return out
}

/** The first of `puuids` stored for this match, from a map read by readStoredDetailedStats. */
export function pickStored(stored: Map<string, DetailedStats>, matchId: string, puuids: string[]): { puuid: string; stats: DetailedStats } | null {
  for (const puuid of puuids) {
    const stats = stored.get(key(matchId, puuid))
    if (stats) return { puuid, stats }
  }
  return null
}

export async function storeDetailedStats(prisma: Prisma, matchId: string, puuid: string, stats: DetailedStats): Promise<void> {
  const statsJson = JSON.stringify(stats)
  await prisma.detailedStatsMemo.upsert({
    where: { matchId_puuid: { matchId, puuid } },
    create: { matchId, puuid, version: DETAILED_STATS_VERSION, statsJson },
    update: { version: DETAILED_STATS_VERSION, statsJson },
  }).catch(() => { /* only a shortcut */ })
}
