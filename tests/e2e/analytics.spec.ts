import { test, expect } from '@playwright/test'
import { join, resolve } from 'path'
import { launchApp, makeDataDir, seedUser, cleanup, goto, type LaunchedApp } from './fixtures'

/**
 * Analytics "Progress" tab: the summary must state the essentials in plain
 * words, and the charts keep their filters and explanations.
 */
const ROOT = resolve(__dirname, '..', '..')

async function seedSecondAssessment(dir: string): Promise<void> {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = join(ROOT, 'prisma-client', 'query_engine-windows.dll.node')
  const { PrismaClient } = require(join(ROOT, 'prisma-client'))
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${join(dir, 'data', 'nexusmind.db')}` } } })
  try {
    const user = await prisma.user.findFirstOrThrow()
    const old = await prisma.assessment.findFirstOrThrow({ where: { userId: user.id } })
    // Previous assessment one month ago, then a newer one with clear moves.
    await prisma.assessment.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 30 * 86400000) } })
    await prisma.assessmentScore.createMany({
      data: [
        { assessmentId: old.id, fundamentalId: 'map_awareness', score: 2 },
        { assessmentId: old.id, fundamentalId: 'itemization', score: 4 },
      ],
    })
    await prisma.assessment.create({
      data: {
        userId: user.id,
        scores: { create: [
          { fundamentalId: 'tempo', score: 4 },
          { fundamentalId: 'map_awareness', score: 4 },
          { fundamentalId: 'itemization', score: 2 },
        ] },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

test.describe('analytics readability', () => {
  let ctx: LaunchedApp
  const dir = makeDataDir()

  test.beforeAll(async () => {
    const first = await launchApp(dir)
    await first.close()
    await seedUser(dir)
    await seedSecondAssessment(dir)
    ctx = await launchApp(dir)
  })
  test.afterAll(async () => { await ctx.close(); cleanup(dir) })

  test('progress tab starts with a plain-language summary', async () => {
    await goto(ctx.page, '/analytics')
    await ctx.page.getByRole('tab', { name: /Progress/i }).click()
    await expect(ctx.page.getByText('Where I stand')).toBeVisible()
    await expect(ctx.page.getByText('Strengths')).toBeVisible()
    await expect(ctx.page.getByText('To work on')).toBeVisible()
    await expect(ctx.page.getByText('Biggest changes')).toBeVisible()
    // Comparison chart lists the moves in words.
    await expect(ctx.page.getByText('Changes since the previous assessment')).toBeVisible()
    await ctx.page.screenshot({ path: join(ROOT, 'test-results', 'analytics-progress.png'), fullPage: true })
    expect(ctx.pageErrors).toEqual([])
  })

  test('filters stay available and summarise the selection', async () => {
    await goto(ctx.page, '/analytics')
    const filterButtons = ctx.page.getByRole('button', { name: /Fundamentals/ })
    await expect(filterButtons).toHaveCount(2)
    await expect(ctx.page.getByText('All fundamentals').first()).toBeVisible()
    await filterButtons.first().click()
    await expect(ctx.page.getByText(/Click a category or a fundamental/)).toBeVisible()
  })
})
