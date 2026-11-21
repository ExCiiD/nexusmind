/**
 * Team context of a game (20/11/2026, docs/engine-reports/2026-11-20-cross-map-soloq-phase-de-lane.md).
 *
 * Coordinated cross-map plays (swap, overloading a side) only exist when the team plans them. In soloQ, a top, mid
 * or ADC is never blamed for not cross-mapping an enemy objective before 14:00. The detector is told which one it is.
 *
 * Team context = the game is in a team session (cloud table `team_session_games`), or is a custom or tournament
 * game. Anything else is soloQ.
 */

/**
 * Flex played outside a team session counts as soloQ: the Engine's proposal, pending the user's answer. One switch
 * to flip if the user says otherwise (then flex games count as team games even outside a session).
 */
export const FLEX_OUTSIDE_TEAM_SESSION_IS_SOLOQ = true

export const FLEX_QUEUE_ID = 440
/** Custom games (practice tool excluded: never in match-v5). */
export const CUSTOM_QUEUE_ID = 0

export interface TeamContextInput {
  queueId: number | null | undefined
  /** match-v5 `info.tournamentCode`: non-empty for a tournament game. */
  tournamentCode?: string | null
  /** The game is in one of the player's team sessions (null: unknown, e.g. signed out). */
  inTeamSession: boolean | null
}

export function teamContextOf(input: TeamContextInput): boolean {
  if (input.inTeamSession) return true
  if (input.tournamentCode) return true
  if (input.queueId === CUSTOM_QUEUE_ID) return true
  if (input.queueId === FLEX_QUEUE_ID && !FLEX_OUTSIDE_TEAM_SESSION_IS_SOLOQ) return true
  return false
}

/** Same, read from a match-v5 body. */
export function teamContextOfMatch(match: any, inTeamSession: boolean | null): boolean {
  return teamContextOf({ queueId: match?.info?.queueId, tournamentCode: match?.info?.tournamentCode ?? null, inTeamSession })
}
