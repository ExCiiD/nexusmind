import { ipcMain } from 'electron'
import { getPrisma } from '../database'

function includeInAnalytics(game: { reviewStatus?: string | null }) {
  return game.reviewStatus !== 'to_be_reviewed'
}

export function registerAnalyticsHandlers() {
  ipcMain.handle('analytics:get-progress', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return []

    const assessments = await prisma.assessment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: { scores: true },
    })

    return assessments.flatMap((a) =>
      a.scores.map((s) => ({
        date: a.createdAt.toISOString(),
        fundamentalId: s.fundamentalId,
        subcategoryId: s.subcategoryId,
        score: s.score,
      })),
    )
  })

  ipcMain.handle('analytics:get-session-stats', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return null

    const sessions = await prisma.session.findMany({
      where: { userId: user.id, status: 'completed' },
      include: {
        games: { include: { review: true } },
      },
    })

    const allGames = sessions.flatMap((s) => s.games).filter(includeInAnalytics)
    const allReviews = allGames.filter((g) => g.review).map((g) => g.review!)

    const totalGames = allGames.length
    const wins = allGames.filter((g) => g.win).length
    const totalKills = allGames.reduce((sum, g) => sum + g.kills, 0)
    const totalDeaths = allGames.reduce((sum, g) => sum + g.deaths, 0)
    const totalAssists = allGames.reduce((sum, g) => sum + g.assists, 0)
    const totalCS = allGames.reduce((sum, g) => sum + g.cs, 0)
    const totalDuration = allGames.reduce((sum, g) => sum + g.duration, 0)
    const totalVision = allGames.reduce((sum, g) => sum + g.visionScore, 0)
    const objectiveRespected = allReviews.filter((r) => r.objectiveRespected).length

    return {
      totalGames,
      wins,
      losses: totalGames - wins,
      avgKDA: totalDeaths === 0 ? totalKills + totalAssists : Number(((totalKills + totalAssists) / totalDeaths).toFixed(2)),
      avgCSPerMin: totalDuration > 0 ? Number((totalCS / (totalDuration / 60)).toFixed(1)) : 0,
      avgVisionScore: totalGames > 0 ? Number((totalVision / totalGames).toFixed(1)) : 0,
      objectiveSuccessRate: allReviews.length > 0 ? Number((objectiveRespected / allReviews.length * 100).toFixed(0)) : 0,
      sessionsCompleted: sessions.length,
    }
  })

  ipcMain.handle('sessions:list', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return []

    const accounts = await prisma.account.findMany({ where: { userId: user.id } })

    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { date: 'desc' },
      include: {
        games: {
          include: { review: true },
          orderBy: { gameEndAt: 'asc' },
        },
      },
    })

    // Batch-load match caches to resolve account names without N+1 queries
    const allMatchIds = sessions.flatMap((s) => s.games.map((g) => g.matchId)).filter(Boolean)
    const caches = await prisma.matchCache.findMany({
      where: { matchId: { in: allMatchIds } },
      select: { matchId: true, matchJson: true },
    })
    const cacheByMatchId = new Map(caches.map((c) => [c.matchId, c.matchJson]))

    const allPuuids = [user.puuid, ...accounts.map((a) => a.puuid)]

    const resolveGameAccountInfo = (matchId: string | null): { accountName: string; accountProfileIconId: number } => {
      const defaultName = user.displayName || user.summonerName
      const defaultIconId = (user as any).profileIconId ?? 0
      if (!matchId) return { accountName: defaultName, accountProfileIconId: defaultIconId }
      const raw = cacheByMatchId.get(matchId)
      if (!raw) return { accountName: defaultName, accountProfileIconId: defaultIconId }
      try {
        const matchData = JSON.parse(raw)
        const participants: any[] = matchData.info?.participants ?? []
        const matchedPuuid = allPuuids.find((p) => participants.some((pp: any) => pp.puuid === p))
        if (!matchedPuuid || matchedPuuid === user.puuid) return { accountName: defaultName, accountProfileIconId: defaultIconId }
        const acc = accounts.find((a) => a.puuid === matchedPuuid)
        return {
          accountName: acc?.gameName ?? defaultName,
          accountProfileIconId: (acc as any)?.profileIconId ?? 0,
        }
      } catch {
        return { accountName: defaultName, accountProfileIconId: defaultIconId }
      }
    }

    return sessions.map((s) => {
      const games = s.games
      const countedGames = games.filter(includeInAnalytics)
      const reviews = countedGames.filter((g) => g.review)
      const wins = countedGames.filter((g) => g.win).length
      const respected = reviews.filter((g) => g.review!.objectiveRespected).length
      const totalDuration = countedGames.reduce((sum, g) => sum + g.duration, 0)
      const totalCS = countedGames.reduce((sum, g) => sum + g.cs, 0)
      const totalKills = countedGames.reduce((sum, g) => sum + g.kills, 0)
      const totalDeaths = countedGames.reduce((sum, g) => sum + g.deaths, 0)
      const totalAssists = countedGames.reduce((sum, g) => sum + g.assists, 0)

      return {
        id: s.id,
        objectiveId: s.objectiveId,
        subObjective: s.subObjective,
        customNote: s.customNote,
        status: s.status,
        date: s.date.toISOString(),
        aiSummary: s.aiSummary,
        sessionConclusion: s.sessionConclusion ?? null,
        gamesPlayed: countedGames.length,
        reviewsCompleted: reviews.length,
        wins,
        losses: countedGames.length - wins,
        objectiveSuccessRate: reviews.length > 0 ? Math.round((respected / reviews.length) * 100) : null,
        avgKDA: totalDeaths === 0
          ? totalKills + totalAssists
          : Number(((totalKills + totalAssists) / totalDeaths).toFixed(2)),
        avgCSPerMin: totalDuration > 0
          ? Number((totalCS / (totalDuration / 60)).toFixed(1))
          : 0,
        games: games.map((g) => ({
          id: g.id,
          matchId: g.matchId,
          champion: g.champion,
          opponentChampion: g.opponentChampion,
          reviewStatus: g.reviewStatus,
          role: g.role,
          kills: g.kills,
          deaths: g.deaths,
          assists: g.assists,
          cs: g.cs,
          visionScore: g.visionScore,
          duration: g.duration,
          win: g.win,
          gameEndAt: g.gameEndAt.toISOString(),
          ...resolveGameAccountInfo(g.matchId),
          review: g.review ? {
            id: g.review.id,
            timelineNotes: g.review.timelineNotes,
            kpiScores: g.review.kpiScores,
            freeText: g.review.freeText,
            aiSummary: g.review.aiSummary,
            objectiveRespected: g.review.objectiveRespected,
          } : null,
        })),
      }
    })
  })

  ipcMain.handle('analytics:get-game-history', async (_event, limit = 20) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return []

    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
      include: {
        games: {
          include: { review: true },
          orderBy: { gameEndAt: 'desc' },
          take: limit,
        },
      },
      orderBy: { date: 'desc' },
    })

    return sessions.flatMap((s) =>
      s.games.map((g) => ({
        ...g,
        objectiveId: s.objectiveId,
        subObjective: s.subObjective,
      })),
    ).slice(0, limit)
  })

  /**
   * Returns session-based KPI score trends over time.
   * For each completed session that has at least one reviewed game with KPI scores,
   * computes the average KPI score across all reviews in that session.
   * Scores are normalised from the 0-10 KPI scale to the 0-5 Assessment scale.
   */
  ipcMain.handle('analytics:get-kpi-timeline', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return []

    const sessions = await prisma.session.findMany({
      where: { userId: user.id, status: 'completed' },
      orderBy: { date: 'asc' },
      include: {
        games: { include: { review: true } },
      },
    })

    const points: Array<{ date: string; objectiveId: string; avgScore: number; gamesReviewed: number }> = []

    for (const session of sessions) {
      if (!session.objectiveId) continue

      const allScores: number[] = []
      for (const game of session.games) {
        if (!game.review?.kpiScores) continue
        try {
          const kpiMap: Record<string, number> = JSON.parse(game.review.kpiScores)
          const vals = Object.values(kpiMap).filter((v) => typeof v === 'number' && v >= 0)
          allScores.push(...vals)
        } catch { /* ignore malformed JSON */ }
      }

      if (allScores.length === 0) continue

      const avg = allScores.reduce((a, b) => a + b, 0) / allScores.length
      points.push({
        date: session.date.toISOString(),
        objectiveId: session.objectiveId,
        avgScore: Number(avg.toFixed(2)), // 0-10 scale, same as assessments
        gamesReviewed: session.games.filter((g) => g.review !== null).length,
      })
    }

    return points
  })
}

