/**
 * Pure part of the start-up catch-up (gameCatchUp.ts): which recent Riot matches become local games.
 *
 * 20/11/2026, "every game": a game played while the app was closed, before an update, or on a server the app did
 * not query (transfer, second server) is imported once the app starts.
 */

export const CATCH_UP_DAYS = 3
/** A remake or an early leave: never imported (the History hides them too). */
export const MIN_DURATION_SEC = 300
/** A provisional game (`live_…`) ending this close to a match is that match: left to the stranded-game recovery. */
export const PROVISIONAL_OVERLAP_MS = 10 * 60_000
/**
 * The queues recorded ("every game", 20/11/2026), the same as the live detection: ranked (420, 440), normals and
 * Swiftplay (400, 430, 480, 490), ARAM (450), Arena (1700, 1710) and custom games (0). Only ranked count in the
 * session KPIs. A practice tool game never reaches match-v5.
 */
export const TRACKABLE_QUEUES = new Set([420, 440, 400, 430, 480, 490, 450, 1700, 1710, 0])

export interface CatchUpMatch {
  matchId: string
  /** match-v5 body. */
  data: { info?: { participants?: Array<{ puuid?: string }>; gameEndTimestamp?: number; gameDuration?: number; queueId?: number } } | null
}

export interface CatchUpPick {
  matchId: string
  puuid: string
  platform: string
  endMs: number
}

/** The platform written in a match id ('EUW1_8051837730' → 'EUW1'). */
export function platformOfMatchId(matchId: string): string {
  return matchId.split('_')[0] ?? ''
}

/**
 * The matches to import: one of the player's accounts played it, it ended after `sinceMs`, it is a queue the app
 * tracks (ranked, normal, Arena), not a remake, not already local, and no provisional game covers it.
 */
export function pickCatchUpMatches(input: {
  matches: CatchUpMatch[]
  puuids: string[]
  localMatchIds: Set<string>
  provisionalEndsMs: number[]
  sinceMs: number
}): CatchUpPick[] {
  const seen = new Set<string>()
  const out: CatchUpPick[] = []
  for (const m of input.matches) {
    if (seen.has(m.matchId) || input.localMatchIds.has(m.matchId)) continue
    seen.add(m.matchId)
    const info = m.data?.info
    if (!info) continue
    const endMs = info.gameEndTimestamp ?? 0
    if (!endMs || endMs < input.sinceMs) continue
    if ((info.gameDuration ?? 0) < MIN_DURATION_SEC) continue
    if (info.queueId == null || !TRACKABLE_QUEUES.has(info.queueId)) continue
    if (input.provisionalEndsMs.some((p) => Math.abs(p - endMs) <= PROVISIONAL_OVERLAP_MS)) continue
    const puuid = input.puuids.find((id) => info.participants?.some((p) => p.puuid === id))
    if (!puuid) continue
    out.push({ matchId: m.matchId, puuid, platform: platformOfMatchId(m.matchId), endMs })
  }
  return out.sort((a, b) => b.endMs - a.endMs)
}

/** For each account, the platform of its latest game: where it plays now. */
export function latestPlatformByAccount(picks: Array<{ puuid: string; platform: string; endMs: number }>): Map<string, string> {
  const best = new Map<string, { platform: string; endMs: number }>()
  for (const p of picks) {
    const cur = best.get(p.puuid)
    if (!cur || p.endMs > cur.endMs) best.set(p.puuid, { platform: p.platform, endMs: p.endMs })
  }
  return new Map([...best].map(([k, v]) => [k, v.platform]))
}
