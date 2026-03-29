import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { tryUnlockBadge } from '../badgeUnlock'

export function registerAssessmentHandlers() {
  ipcMain.handle(
    'assessment:save',
    async (_event, scores: Array<{ fundamentalId: string; subcategoryId?: string; score: number }>) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) throw new Error('No user found')

    // Snapshot previous scores before saving (for improvement_1 badge)
    const previousAssessment = await prisma.assessment.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { scores: true },
    })
    const prevScoreMap: Record<string, number> = {}
    if (previousAssessment) {
      for (const s of previousAssessment.scores) prevScoreMap[s.fundamentalId] = s.score
    }

    const assessment = await prisma.assessment.create({
        data: {
          userId: user.id,
          scores: {
            create: scores.map((s) => ({
              fundamentalId: s.fundamentalId,
              subcategoryId: s.subcategoryId ?? null,
              score: s.score,
            })),
          },
        },
        include: { scores: true },
      })

      // Schedule next assessment
      const nextDate = new Date()
      nextDate.setDate(nextDate.getDate() + user.assessmentFreqDays)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          nextAssessmentAt: nextDate,
          xp: user.xp + 100,
        },
      })

      // Badge: improvement_1 — any fundamental score improved by ≥1 point
      const improved = scores.some((s) => {
        const prev = prevScoreMap[s.fundamentalId]
        return prev !== undefined && s.score >= prev + 1
      })
      if (improved) await tryUnlockBadge(user.id, 'improvement_1')

      return assessment
    },
  )

  ipcMain.handle('assessment:get-latest', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) return null

    return prisma.assessment.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { scores: true },
    })
  })

  ipcMain.handle('assessment:get-history', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) return []

    return prisma.assessment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: { scores: true },
    })
  })
}
