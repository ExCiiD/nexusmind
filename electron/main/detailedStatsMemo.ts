import type { extractDetailedStats } from './riotClient'

/**
 * Audit E02 / PE-3 (19/11/2026): the dashboard radar read ~40 cached matches on every visit and parsed each
 * one's match body and timeline (0.5 to 2 MB) on the main thread, only to compute the same detailed stats
 * again. They depend only on the match and the player, and a finished match never changes, so they are kept
 * here, least recently used first out, for as long as the app runs.
 *
 * Only complete results are kept (computed with the timeline): stats computed while the timeline was
 * missing are recomputed next time, when it may have arrived.
 */
export type DetailedStats = NonNullable<ReturnType<typeof extractDetailedStats>>

export const DETAILED_STATS_MEMO_SIZE = 300

const memo = new Map<string, DetailedStats>()

const keyOf = (matchId: string, puuid: string) => `${matchId}:${puuid}`

/** The memoised stats of the first of `puuids` found for this match, or null. Marks the entry as recently used. */
export function getMemoDetailedStats(matchId: string, puuids: string[]): DetailedStats | null {
  for (const puuid of puuids) {
    const key = keyOf(matchId, puuid)
    const hit = memo.get(key)
    if (hit) {
      memo.delete(key)
      memo.set(key, hit)
      return hit
    }
  }
  return null
}

export function setMemoDetailedStats(matchId: string, puuid: string, stats: DetailedStats): void {
  const key = keyOf(matchId, puuid)
  memo.delete(key)
  memo.set(key, stats)
  while (memo.size > DETAILED_STATS_MEMO_SIZE) {
    const oldest = memo.keys().next().value as string
    memo.delete(oldest)
  }
}

/** Tests only. */
export function clearDetailedStatsMemo(): void {
  memo.clear()
}

export function detailedStatsMemoSize(): number {
  return memo.size
}
