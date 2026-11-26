/**
 * Pure part of the stranded-game recovery (strandedGames.ts).
 *
 * At game end the detector writes a provisional Game (`live_<start ms>`)
 * from the Live Client — champion, KDA, no opponent, no result — then looks
 * the match up on Riot for about 4 minutes. When every lookup fails (Riot
 * slow, network down, or the proxy refusing the player's session, as during
 * the Supabase outage of 18 November 2026), the provisional row stays:
 * holding the recording, without timeline, events or detected mistakes —
 * and the match-history import later adds the real game beside it, so the
 * session lists the game twice.
 */

export const PROVISIONAL_PREFIX = 'live_'

/** Start time (ms) a provisional match id carries, or null for a real id. */
export function provisionalStartMs(matchId: string): number | null {
  if (!matchId.startsWith(PROVISIONAL_PREFIX)) return null
  const ms = Number(matchId.slice(PROVISIONAL_PREFIX.length))
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

export interface ProvisionalGame {
  /** Local clock when the game started (from the provisional id). */
  startedAt: number
  /** When the provisional row was written (local game end). */
  endedAt: number
  champion: string
}

export interface CandidateMatch {
  matchId: string
  gameStartTimestamp: number
  gameEndTimestamp: number
  /** The champion our player had in this match. */
  championName: string
}

/** Riot's start and end differ from the local clocks by the loading
 *  screen and by Riot's own processing: a few minutes at most. */
export const START_TOLERANCE_MS = 8 * 60_000
export const END_TOLERANCE_MS = 10 * 60_000

/**
 * The match a provisional game was: same champion when the provisional row
 * knows it, start or end within tolerance, the closest one when several
 * qualify. Null when none does.
 */
export function pickMatchForProvisional(game: ProvisionalGame, candidates: CandidateMatch[]): CandidateMatch | null {
  const champion = game.champion.trim().toLowerCase()
  let best: { match: CandidateMatch; gap: number } | null = null
  for (const c of candidates) {
    if (champion && c.championName.trim().toLowerCase() !== champion) continue
    const startGap = Math.abs(c.gameStartTimestamp - game.startedAt)
    const endGap = Math.abs(c.gameEndTimestamp - game.endedAt)
    if (startGap > START_TOLERANCE_MS && endGap > END_TOLERANCE_MS) continue
    const gap = Math.min(startGap, endGap)
    if (!best || gap < best.gap) best = { match: c, gap }
  }
  return best?.match ?? null
}

/** A provisional game this old that still has no match is given up on. */
export const GIVE_UP_AFTER_MS = 14 * 86_400_000

/**
 * Audit E10 (26/11/2026): the post-game lookup takes the player's newest match id. 10 s after a game ends, Riot has
 * often not published it yet, so after two games in a row the newest id is the PREVIOUS game. A match belongs to the
 * game that just ended only if it started near the detected start (same tolerance as the stranded-games catch-up).
 * A match with no start time is accepted (nothing to compare), and a start in the future of the detected one too.
 */
export function startsNearDetectedStart(matchStartMs: number | null | undefined, detectedStartMs: number): boolean {
  if (!matchStartMs || matchStartMs <= 0) return true
  return Math.abs(matchStartMs - detectedStartMs) <= START_TOLERANCE_MS
}
