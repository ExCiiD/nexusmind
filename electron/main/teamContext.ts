/**
 * Team context of a game for the detectors (20/11/2026, src/lib/microReview/teamContext.ts): a game reported into one
 * of the player's team sessions (cloud table `team_session_games`, read under RLS), a custom or a tournament game.
 *
 * Signed out, offline or slow: unknown, which counts as soloQ, the safe side (fewer blames, never a false cross-map
 * blame). Answers are kept 10 minutes per match.
 */
import { teamContextOfMatch } from '../../src/lib/microReview/teamContext'
import { getSessionUserId, getSupabase, isCloudConfigured } from './cloud/supabase'

const CACHE_MS = 10 * 60_000
const TIMEOUT_MS = 3_000
const cache = new Map<string, { at: number; inSession: boolean | null }>()

/** Whether the match is in one of the player's team sessions; null when it cannot be told. */
export async function isMatchInTeamSession(matchId: string): Promise<boolean | null> {
  const hit = cache.get(matchId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.inSession
  let inSession: boolean | null = null
  try {
    if (isCloudConfigured() && (await getSessionUserId())) {
      const query = getSupabase().from('team_session_games').select('id').eq('match_id', matchId).limit(1)
      const res = await Promise.race([query, new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS))])
      if (res && !res.error) inSession = (res.data ?? []).length > 0
    }
  } catch { /* unknown */ }
  cache.set(matchId, { at: Date.now(), inSession })
  return inSession
}

/** The detectors' `teamContext` for this match body. */
export async function teamContextForMatch(matchId: string, match: unknown): Promise<boolean> {
  return teamContextOfMatch(match, await isMatchInTeamSession(matchId))
}
