/**
 * Individual stats of the signed-in player for a solo session (docs/contracts/player-session-stats.md § B7), and the
 * 30-day baseline of the sheet (§ B5). Local only: the match and timeline already stored in MatchCache, the lane report on
 * the game, the Dashboard's detailed stats in DetailedStatsMemo. Never calls Riot.
 */
import { getPrisma } from './database'
import { timelineFromRow } from './matchStore'
import { DETAILED_STATS_VERSION } from './detailedStatsStore'
import { extractTeamTimeline } from '../../src/lib/teamTimelineCore'
import {
  attachBaseline, baseline30dFromAverages, buildSoloPlayerSessionStats,
  type Baseline30d, type PlayerGameInput, type PlayerSessionStats,
} from '../../src/lib/playerSessionStatsCore'

const DAY_MS = 86_400_000
export const BASELINE_DAYS = 30

const tryParse = (json: string | null | undefined): any => { if (!json) return null; try { return JSON.parse(json) } catch { return null } }

async function activeUser() {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) return null
  const accounts = await prisma.account.findMany({ where: { userId: user.id } })
  const puuids = [user.puuid, ...accounts.map((a) => a.puuid)].filter((p): p is string => typeof p === 'string' && p.length > 0)
  return { user, puuids }
}

/**
 * The player's last 30 days, from the same detailed stats and the same averages as the Dashboard (stats:get-account-averages),
 * for every account of the signed-in user and the user's main role. Local rows only. Null without any game in the window.
 */
export async function localBaseline30d(now = Date.now()): Promise<Baseline30d | null> {
  const who = await activeUser()
  if (!who) return null
  const prisma = getPrisma()
  const rows = await prisma.detailedStatsMemo.findMany({ where: { puuid: { in: who.puuids }, version: DETAILED_STATS_VERSION } }).catch(() => [])
  const from = now - BASELINE_DAYS * DAY_MS
  const mainRole = who.user.mainRole
  const stats = rows
    .map((r) => tryParse(r.statsJson))
    .filter((s) => s?.meta && typeof s.meta.gameEndAt === 'number' && s.meta.gameEndAt >= from && s.meta.gameEndAt <= now)
    .filter((s) => !mainRole || s.meta.role === mainRole)
  if (stats.length === 0) return null
  // Loaded here, not at the top: stats.ipc registers the whole Dashboard side and must not be pulled in by the cloud modules at start-up.
  const { computeAverages } = await import('./ipc/stats.ipc')
  return baseline30dFromAverages(computeAverages(stats), new Date(from).toISOString(), new Date(now).toISOString())
}

/**
 * `soloSessionPlayerStats(sessionId?)`: the same PlayerSessionStats[] as a team session's, one element (the signed-in
 * player, memberId = the local user id), none when there is no session or no usable game. `sessionId` null = the active session.
 */
export async function soloSessionPlayerStats(sessionId?: string | null): Promise<PlayerSessionStats[]> {
  const who = await activeUser()
  if (!who) return []
  const prisma = getPrisma()
  const session = sessionId
    ? await prisma.session.findFirst({ where: { id: sessionId, userId: who.user.id }, select: { id: true } })
    : await prisma.session.findFirst({ where: { userId: who.user.id, status: 'active' }, select: { id: true } })
  if (!session) return []
  const games = await prisma.game.findMany({ where: { sessionId: session.id }, orderBy: { gameEndAt: 'asc' } })
  if (games.length === 0) return []
  const caches = await prisma.matchCache.findMany({ where: { matchId: { in: games.map((g) => g.matchId).filter(Boolean) } } })
  const cacheOf = new Map(caches.map((c) => [c.matchId, c]))

  const inputs: PlayerGameInput[] = games.map((g) => {
    const row = cacheOf.get(g.matchId)
    const matchJson = tryParse(row?.matchJson)
    const timeline = tryParse(timelineFromRow(prisma, g.matchId, row?.timelineJson))
    const mine = (matchJson?.info?.participants ?? []).find((p: any) => who.puuids.includes(p?.puuid))
    const ourTeamId = mine?.teamId === 100 || mine?.teamId === 200 ? (mine.teamId as 100 | 200) : null
    // The summary is built here, in memory, from what is stored: nothing is fetched or written.
    const timelineSummary = matchJson && timeline && ourTeamId
      ? extractTeamTimeline(matchJson, timeline, { gameId: g.id, matchId: g.matchId, source: 'flex', ourTeamId, opponentName: null })
      : null
    return {
      id: g.id, matchId: g.matchId, matchJson, ourTeamId: null, timelineSummary,
      lanePhaseReport: tryParse(g.lanePhaseReport), playedAt: g.gameEndAt.toISOString(),
    }
  })
  const stats = buildSoloPlayerSessionStats(inputs, { userId: who.user.id, displayName: who.user.displayName || who.user.summonerName, puuids: who.puuids })
  return attachBaseline(stats, who.user.id, await localBaseline30d())
}
