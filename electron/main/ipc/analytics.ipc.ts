import { ipcMain } from 'electron'
import { getPrisma } from '../database'

function includeInAnalytics(game: { reviewStatus?: string | null }) {
  return game.reviewStatus !== 'to_be_reviewed'
}

export function registerAnalyticsHandlers() {
  ipcMain.handle('analytics:get-progress', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
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
    const user = await prisma.user.findFirst()
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
    const user = await prisma.user.findFirst()
    if (!user) return []

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
    const user = await prisma.user.findFirst()
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
}
