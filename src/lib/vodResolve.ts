/**
 * Which local recording belongs to a game of the player sheet (pure part; the lookups are in PlayerTimelineBlocks).
 *
 * Recordings are keyed by the LOCAL game row (`Recording.gameId` = `Game.id`, prisma/schema.prisma), while a team
 * session's events carry the team game id (`HistoryGame.gameId`) whose Riot match id (`HistoryGame.matchId`) is the
 * same string as `Game.matchId`. So: team game → match id → local Game.id → recording. A solo game's id already is
 * the local `Game.id`. The recording's own offset is applied by the Review player (`?at=` = game time).
 */

/** `Game.matchId → Game.id` of the local history. */
export function localGamesByMatch(games: ReadonlyArray<{ id: string; matchId?: string | null }>): Map<string, string> {
  const out = new Map<string, string>()
  for (const g of games) if (g.matchId && g.id) out.set(g.matchId, g.id)
  return out
}

/** True when the id of some game needs the match → local game lookup (a team game). */
export function needsMatchLookup(gameIds: readonly string[], matchIdOf: Readonly<Record<string, string>> | undefined): boolean {
  return !!matchIdOf && gameIds.some((id) => !!matchIdOf[id])
}

/** Local `Game.id` of a sheet game, null when the match is not in this PC's history (nothing to review here). */
export function localGameIdOf(gameId: string, matchIdOf: Readonly<Record<string, string>> | undefined, byMatch: ReadonlyMap<string, string> | null): string | null {
  const matchId = matchIdOf?.[gameId]
  if (!matchId) return gameId
  return byMatch?.get(matchId) ?? null
}
