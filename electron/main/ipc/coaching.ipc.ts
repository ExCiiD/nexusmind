import { ipcMain } from 'electron'
import { getPrisma } from '../database'

interface WeakKpi {
  kpiId: string
  avgScore: number
  sessionCount: number
  objectiveId: string
}

interface CoachingPatterns {
  weakKpis: WeakKpi[]
  reviewCompletionRate: number
  mostRepeatedObjective: { objectiveId: string; count: number } | null
  recentObjectiveIds: string[]
  totalSessionsAnalyzed: number
  /** True when the player's avg deaths over last 20 session games is >= 5 */
  highDeathsWarning: boolean
  avgDeathsRecent: number | null
}

export function registerCoachingHandlers() {
  /**
   * Scans the last 10 completed sessions and returns deterministic coaching patterns:
   * - KPIs that consistently score below 6 across multiple sessions (recurring weaknesses)
   * - Review completion rate (how often the player actually reviews)
   * - Most repeated objective (what the player focuses on most)
   * - Recent objective IDs (last 5 sessions, used for suggestion recency penalty)
   */
  ipcMain.handle('coaching:get-patterns', async (): Promise<CoachingPatterns | null> => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return null

    const sessions = await prisma.session.findMany({
      where: { userId: user.id, status: 'completed' },
      orderBy: { date: 'desc' },
      take: 10,
      include: {
        games: { include: { review: true } },
      },
    })

    if (sessions.length === 0) return null

    // KPI score accumulator: kpiId → { totalScore, count, sessionIds, objectiveId }
    const kpiAcc: Record<
      string,
      { totalScore: number; count: number; objectiveId: string; sessionIds: Set<string> }
    > = {}
    let totalGames = 0
    let reviewedGames = 0

    for (const session of sessions) {
      for (const game of session.games) {
        if (game.reviewStatus === 'to_be_reviewed') continue
        totalGames++
        if (!game.review?.kpiScores) continue
        reviewedGames++
        try {
          const kpiMap: Record<string, number> = JSON.parse(game.review.kpiScores)
          for (const [kpiId, score] of Object.entries(kpiMap)) {
            if (typeof score !== 'number' || score <= 0) continue
            if (!kpiAcc[kpiId]) {
              kpiAcc[kpiId] = {
                totalScore: 0,
                count: 0,
                objectiveId: session.objectiveId,
                sessionIds: new Set(),
              }
            }
            kpiAcc[kpiId].totalScore += score
            kpiAcc[kpiId].count++
            kpiAcc[kpiId].sessionIds.add(session.id)
          }
        } catch { /* ignore malformed KPI JSON */ }
      }
    }

    // Weak KPIs: avg score < 6, scored in at least 2 distinct sessions
    const weakKpis: WeakKpi[] = Object.entries(kpiAcc)
      .filter(([, v]) => v.sessionIds.size >= 2 && v.totalScore / v.count < 6)
      .map(([kpiId, v]) => ({
        kpiId,
        avgScore: Number((v.totalScore / v.count).toFixed(1)),
        sessionCount: v.sessionIds.size,
        objectiveId: v.objectiveId,
      }))
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 5)

    // Most repeated objective across all analyzed sessions
    const objCounts: Record<string, number> = {}
    for (const session of sessions) {
      let ids: string[] = []
      try { ids = JSON.parse(session.objectiveIds) as string[] } catch { ids = [session.objectiveId] }
      for (const id of ids) {
        objCounts[id] = (objCounts[id] ?? 0) + 1
      }
    }
    const topEntry = Object.entries(objCounts).sort(([, a], [, b]) => b - a)[0]
    const mostRepeatedObjective = topEntry
      ? { objectiveId: topEntry[0], count: topEntry[1] }
      : null

    // Distinct recent objective IDs from the last 5 sessions (for recency penalty in suggestion)
    const recentObjectiveIds = [
      ...new Set(
        sessions.slice(0, 5).flatMap((s) => {
          try { return JSON.parse(s.objectiveIds) as string[] } catch { return [s.objectiveId] }
        }),
      ),
    ]

    // High-deaths detection: collect up to 20 most recent games across all sessions and
    // compute average deaths. If avg >= 5, surface a death_regulation suggestion.
    const allGames = sessions.flatMap((s) => s.games).slice(0, 20)
    let avgDeathsRecent: number | null = null
    let highDeathsWarning = false
    if (allGames.length >= 5) {
      const totalDeaths = allGames.reduce((sum, g) => sum + g.deaths, 0)
      avgDeathsRecent = Number((totalDeaths / allGames.length).toFixed(1))
      highDeathsWarning = avgDeathsRecent >= 5
    }

    return {
      weakKpis,
      reviewCompletionRate:
        totalGames > 0 ? Math.round((reviewedGames / totalGames) * 100) : 0,
      mostRepeatedObjective,
      recentObjectiveIds,
      totalSessionsAnalyzed: sessions.length,
      highDeathsWarning,
      avgDeathsRecent,
    }
  })
}
