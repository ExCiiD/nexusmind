/**
 * Start-up catch-up (20/11/2026, "every game"): the recent games of every account missing locally are imported,
 * then the orphan recordings are linked to them.
 *
 * Sources, newest first:
 * - the League game logs of the last days (gameLog.ts): their match ids carry the real platform, so a game on a
 *   server the app did not query (a transfer, a second server) is found even before the server detection works;
 * - each account's recent match list, on the server the account plays on (riotRegionCore.ts).
 *
 * Imported games go to the off-session container (offSessionGames.ts): they were not played in a session, so they
 * never count in its KPIs. The latest game of each account also tells its server (`regionResolver.observe`), which
 * an "Auto" account then saves (accountRegions.ts).
 */
import { getPrisma } from './database'
import { saveMatch } from './matchStore'
import { extractPlayerStats, getAnyQueueMatchIds, getMatch, regionResolver, RiotNotFoundError } from './riotClient'
import { withRiotPriority } from './riotPriority'
import { ignoredAmong, rememberNotFound } from './ignoredMatches'
import { readRecentGameLogRefs } from './gameLog'
import { CATCH_UP_DAYS, latestPlatformByAccount, pickCatchUpMatches, platformOfMatchId, type CatchUpMatch } from './gameCatchUpCore'
import { getOrCreateOffSessionSession } from './offSessionGames'

const PER_ACCOUNT = 20

async function loadMatch(matchId: string, region: string): Promise<CatchUpMatch['data'] & Record<string, unknown> | null> {
  const prisma = getPrisma()
  const cached = await prisma.matchCache.findUnique({ where: { matchId }, select: { matchJson: true } }).catch(() => null)
  if (cached?.matchJson) {
    try { return JSON.parse(cached.matchJson) } catch { /* refetch */ }
  }
  const data = await getMatch(matchId, region).catch(async (err) => {
    // Riot has no such match (practice tool): not asked again for a day.
    if (err instanceof RiotNotFoundError) await rememberNotFound(matchId)
    return null
  })
  if (data) {
    await saveMatch(prisma, matchId, data, { overwrite: false }).catch(() => {})
  }
  return data
}

let running = false

/**
 * Every Riot call of the catch-up is a background one (`x-nxm-priority: background`): it must never use the
 * proxy's reserve for interactive calls, whoever starts it.
 */
export function catchUpRecentGames(linkOrphans: () => Promise<unknown>, now = Date.now()): Promise<{ imported: number; linked: boolean }> {
  return withRiotPriority('background', () => runCatchUp(linkOrphans, now))
}

async function runCatchUp(linkOrphans: () => Promise<unknown>, now: number): Promise<{ imported: number; linked: boolean }> {
  if (running) return { imported: 0, linked: false }
  running = true
  try {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return { imported: 0, linked: false }
    const linked = await prisma.account.findMany({ where: { userId: user.id } })
    const accounts = [{ puuid: user.puuid, region: user.region }, ...linked.map((a) => ({ puuid: a.puuid, region: a.region }))].filter((a) => a.puuid)
    const sinceMs = now - CATCH_UP_DAYS * 86_400_000

    const ids = new Map<string, string>() // matchId -> region to read it from
    for (const ref of readRecentGameLogRefs(sinceMs)) ids.set(ref.matchId, ref.platform)
    for (const acc of accounts) {
      const list = await getAnyQueueMatchIds(acc.puuid, acc.region, PER_ACCOUNT).catch(() => [] as string[])
      for (const id of list) if (!ids.has(id)) ids.set(id, platformOfMatchId(id) || acc.region)
    }
    if (ids.size === 0) return { imported: 0, linked: false }

    const local = new Set((await prisma.game.findMany({ where: { matchId: { in: [...ids.keys()] } }, select: { matchId: true } })).map((g) => g.matchId))
    // Deleted by the player, or unknown to Riot lately: treated as already there (never fetched, never imported).
    for (const id of await ignoredAmong([...ids.keys()], now)) local.add(id)
    const provisional = await prisma.game.findMany({ where: { matchId: { startsWith: 'live_' } }, select: { gameEndAt: true } })

    const matches: CatchUpMatch[] = []
    for (const [matchId, region] of ids) {
      if (local.has(matchId)) continue
      const data = await loadMatch(matchId, region)
      if (data) matches.push({ matchId, data })
    }
    const puuids = accounts.map((a) => a.puuid)
    const picks = pickCatchUpMatches({ matches, puuids, localMatchIds: local, provisionalEndsMs: provisional.map((g) => g.gameEndAt.getTime()), sinceMs })

    // Where each account plays now: the platform of its latest game seen here.
    const seen = matches.flatMap((m) => {
      const puuid = puuids.find((id) => m.data?.info?.participants?.some((p) => p.puuid === id))
      return puuid ? [{ puuid, platform: platformOfMatchId(m.matchId), endMs: m.data?.info?.gameEndTimestamp ?? 0 }] : []
    })
    for (const [puuid, platform] of latestPlatformByAccount(seen)) {
      regionResolver.observe(puuid, platform)
      const acc = accounts.find((a) => a.puuid === puuid)
      if (acc) await regionResolver.resolve(puuid, acc.region).catch(() => null) // an "Auto" account saves it
    }

    let imported = 0
    if (picks.length) {
      const sessionId = await getOrCreateOffSessionSession(user.id)
      for (const pick of picks) {
        const data = matches.find((m) => m.matchId === pick.matchId)?.data
        const stats = data ? extractPlayerStats(data, pick.puuid) : null
        if (!stats) continue
        try {
          await prisma.game.create({
            data: {
              sessionId,
              matchId: pick.matchId,
              champion: stats.champion,
              role: stats.role,
              kills: stats.kills,
              deaths: stats.deaths,
              assists: stats.assists,
              cs: stats.cs,
              visionScore: stats.visionScore,
              duration: stats.duration,
              win: stats.win,
              gameEndAt: stats.gameEndAt,
              queueType: stats.queueType ?? 'unknown',
              isSessionEligible: false,
              opponentChampion: stats.opponentChampion ?? null,
            },
          })
          imported++
          console.log(`[catch-up] imported ${pick.matchId} (${stats.champion}, ${stats.win ? 'WIN' : 'LOSS'})`)
        } catch (err) {
          // Created meanwhile by the post-game chain: nothing to do.
          console.warn(`[catch-up] ${pick.matchId} not imported:`, (err as Error)?.message)
        }
      }
    }

    // The orphan recordings of these games (and any other) are linked by their time.
    const orphans = await prisma.recording.count({ where: { gameId: null, filePath: { not: null } } })
    if (orphans > 0) await linkOrphans().catch((err) => console.warn('[catch-up] orphan linking failed:', (err as Error)?.message))
    return { imported, linked: orphans > 0 }
  } finally {
    running = false
  }
}
