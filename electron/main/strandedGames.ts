import { getPrisma } from './database'
import { extractPlayerStats, getMatch, getMatchIdsBetween, isQueueSessionEligible } from './riotClient'
import { GIVE_UP_AFTER_MS, pickMatchForProvisional, provisionalStartMs, type CandidateMatch } from './strandedGamesCore'

/**
 * Recovery of the provisional games the detector couldn't enrich (see
 * strandedGamesCore.ts for how they happen). For each one:
 *   - find its match on Riot (one id lookup per account over the game's
 *     time window, the match itself from the cache when possible);
 *   - if the match-history import already added the real game, merge the
 *     provisional row into it — recording, mistakes and micro-review answers
 *     move over first (deleting a game cascades to its recording);
 *   - otherwise turn the provisional row into the real game, as the detector
 *     would have;
 *   - then the usual post-game work runs (`onRecovered`: timeline, events,
 *     detected mistakes, team sessions).
 * Runs at start and every 20 minutes (index.ts); costs nothing without a
 * stranded game.
 */

export interface RecoveredGame { gameId: string; matchId: string; win: boolean; queueType: string }

/** The detector's own lookups last about 4.5 minutes: leave it that time. */
const SETTLE_MS = 6 * 60_000
const WINDOW_PAD_SEC = 30 * 60
let running = false

async function cachedMatch(matchId: string, region: string): Promise<any | null> {
  const prisma = getPrisma()
  const cached = await prisma.matchCache.findUnique({ where: { matchId } }).catch(() => null)
  if (cached?.matchJson) {
    try { return JSON.parse(cached.matchJson) } catch { /* refetch */ }
  }
  const data = await getMatch(matchId, region).catch(() => null)
  if (data) {
    await prisma.matchCache.upsert({
      where: { matchId },
      create: { matchId, matchJson: JSON.stringify(data) },
      update: { matchJson: JSON.stringify(data) },
    }).catch(() => {})
  }
  return data
}

/** Moves what hangs off `fromId` to `toId`, then deletes `fromId`. */
async function mergeInto(fromId: string, toId: string): Promise<void> {
  const prisma = getPrisma()
  await prisma.$transaction(async (tx) => {
    const [fromRec, toRec] = await Promise.all([
      tx.recording.findUnique({ where: { gameId: fromId } }),
      tx.recording.findUnique({ where: { gameId: toId } }),
    ])
    // The recording must leave the provisional row before it is deleted:
    // Recording.gameId cascades. With a recording on both, the provisional
    // one becomes an orphan (kept on disk and in the Record Hub).
    if (fromRec) await tx.recording.update({ where: { id: fromRec.id }, data: { gameId: toRec ? null : toId } })

    await tx.mistake.updateMany({ where: { gameId: fromId }, data: { gameId: toId } })

    const [fromAnswers, toAnswers] = await Promise.all([
      tx.microReviewAnswer.findMany({ where: { gameId: fromId }, select: { id: true, momentKey: true } }),
      tx.microReviewAnswer.findMany({ where: { gameId: toId }, select: { momentKey: true } }),
    ])
    const taken = new Set(toAnswers.map((a) => a.momentKey))
    const movable = fromAnswers.filter((a) => !taken.has(a.momentKey)).map((a) => a.id)
    if (movable.length) await tx.microReviewAnswer.updateMany({ where: { id: { in: movable } }, data: { gameId: toId } })

    const [fromReview, toReview] = await Promise.all([
      tx.review.findUnique({ where: { gameId: fromId } }),
      tx.review.findUnique({ where: { gameId: toId } }),
    ])
    if (fromReview && !toReview) await tx.review.update({ where: { id: fromReview.id }, data: { gameId: toId } })

    await tx.game.delete({ where: { id: fromId } })
  })
}

export async function recoverStrandedGames(onRecovered: (info: RecoveredGame) => void): Promise<{ stranded: number; recovered: number; merged: number }> {
  const tally = { stranded: 0, recovered: 0, merged: 0 }
  if (running) return tally
  running = true
  try {
    const prisma = getPrisma()
    const now = Date.now()
    const stranded = (await prisma.game.findMany({
      where: { matchId: { startsWith: 'live_' }, gameEndAt: { lt: new Date(now - SETTLE_MS) } },
      select: { id: true, matchId: true, champion: true, gameEndAt: true },
    })).filter((g) => provisionalStartMs(g.matchId) !== null && now - g.gameEndAt.getTime() < GIVE_UP_AFTER_MS)
    tally.stranded = stranded.length
    if (stranded.length === 0) return tally

    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return tally
    const linked = await prisma.account.findMany({ where: { userId: user.id } })
    const accounts = [{ puuid: user.puuid, region: user.region }, ...linked.map((a) => ({ puuid: a.puuid, region: a.region }))]
      .filter((a) => a.puuid)

    for (const game of stranded) {
      const startedAt = provisionalStartMs(game.matchId)!
      const endedAt = game.gameEndAt.getTime()
      const candidates: Array<CandidateMatch & { region: string; puuid: string; data: any }> = []
      for (const acc of accounts) {
        const ids = await getMatchIdsBetween(acc.puuid, acc.region, startedAt / 1000 - WINDOW_PAD_SEC, endedAt / 1000 + WINDOW_PAD_SEC).catch(() => [] as string[])
        for (const id of ids) {
          const data = await cachedMatch(id, acc.region)
          const me = data?.info?.participants?.find((p: any) => p.puuid === acc.puuid)
          if (!data || !me) continue
          candidates.push({
            matchId: data.metadata?.matchId ?? id,
            gameStartTimestamp: data.info.gameStartTimestamp ?? data.info.gameCreation ?? 0,
            gameEndTimestamp: data.info.gameEndTimestamp ?? 0,
            championName: me.championName ?? '',
            region: acc.region, puuid: acc.puuid, data,
          })
        }
      }
      const picked = pickMatchForProvisional({ startedAt, endedAt, champion: game.champion }, candidates)
      if (!picked) continue
      const hit = candidates.find((c) => c.matchId === picked.matchId)!
      const stats = extractPlayerStats(hit.data, hit.puuid)
      if (!stats) continue
      const queueType = stats.queueType ?? 'unknown'

      const existing = await prisma.game.findUnique({ where: { matchId: picked.matchId } })
      let gameId: string
      if (existing) {
        await mergeInto(game.id, existing.id)
        gameId = existing.id
        tally.merged++
        console.log(`[stranded] merged provisional ${game.id} into ${existing.id} (${picked.matchId})`)
      } else {
        await prisma.game.update({
          where: { id: game.id },
          data: {
            matchId: picked.matchId,
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
            queueType,
            isSessionEligible: isQueueSessionEligible(queueType),
            opponentChampion: stats.opponentChampion ?? null,
          },
        })
        gameId = game.id
        console.log(`[stranded] enriched provisional ${game.id} → ${picked.matchId}`)
      }
      tally.recovered++
      try { onRecovered({ gameId, matchId: picked.matchId, win: stats.win, queueType }) } catch (err) {
        console.warn('[stranded] post-game work failed:', (err as Error)?.message)
      }
    }
    return tally
  } finally {
    running = false
  }
}
