import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import {
  suggestObjective,
  synthesizeReview,
  analyzePatterns,
  generateSessionSummary,
} from '../openaiClient'

export function registerAIHandlers() {
  ipcMain.handle('ai:suggest-objective', async (_event, scores: Record<string, number>) => {
    return suggestObjective(scores)
  })

  ipcMain.handle(
    'ai:synthesize-review',
    async (
      _event,
      data: { timelineNotes: Array<{ time: string; note: string }>; kpiScores: Record<string, number>; objective: string },
    ) => {
      return synthesizeReview(data)
    },
  )

  ipcMain.handle('ai:analyze-patterns', async (_event, reviews: any[]) => {
    return analyzePatterns(reviews)
  })

  ipcMain.handle('ai:session-summary', async (_event, sessionId: string) => {
    const prisma = getPrisma()
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        games: {
          include: { review: true },
          orderBy: { gameEndAt: 'asc' },
        },
      },
    })
    if (!session) throw new Error('Session not found')

    const reviews = session.games
      .filter((g) => g.review)
      .map((g) => ({
        timelineNotes: g.review!.timelineNotes,
        kpiScores: g.review!.kpiScores,
        objectiveRespected: g.review!.objectiveRespected,
        freeText: g.review!.freeText,
      }))

    if (reviews.length === 0) throw new Error('No reviews to summarize')

    return generateSessionSummary(reviews, session.objectiveId)
  })
}
