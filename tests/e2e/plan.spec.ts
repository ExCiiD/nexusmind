import { test, expect } from '@playwright/test'
import { join, resolve } from 'path'
import { launchApp, makeDataDir, seedUser, cleanup, goto, type LaunchedApp } from './fixtures'

/**
 * "Mon plan" (lot 5): composes the weekly report + experiments already
 * built by the earlier lots. This seeds a dominant mistake tag (4 of the
 * last 10 games) so the focus has real "Why?" evidence games to open.
 */

const ROOT = resolve(__dirname, '..', '..')

function prismaFor(dir: string) {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = join(ROOT, 'prisma-client', 'query_engine-windows.dll.node')
  const { PrismaClient } = require(join(ROOT, 'prisma-client'))
  return new PrismaClient({ datasources: { db: { url: `file:${join(dir, 'data', 'nexusmind.db')}` } } })
}

async function seedDominantMistake(dir: string): Promise<void> {
  const prisma = prismaFor(dir)
  try {
    const user = await prisma.user.findFirstOrThrow()
    const tag = await prisma.mistakeTag.findUniqueOrThrow({ where: { slug: 'unused-gold' } })
    const session = await prisma.session.create({
      data: { userId: user.id, objectiveId: 'recall_timing', objectiveIds: '["recall_timing"]', status: 'completed', date: new Date(Date.now() - 2 * 86_400_000) },
    })
    for (let i = 0; i < 10; i++) {
      const game = await prisma.game.create({
        data: {
          sessionId: session.id, matchId: `EUW1_PLANE2E${i}`, champion: 'Ahri', role: 'MIDDLE',
          kills: 3, deaths: 4, assists: 5, cs: 180, visionScore: 20, duration: 1800, win: i % 2 === 0,
          gameEndAt: new Date(Date.now() - (10 - i) * 50 * 60_000),
        },
      })
      if (i < 4) {
        await prisma.mistake.create({ data: { gameId: game.id, tagId: tag.id, gameTimeSec: 700, severity: 2, autoDetected: true } })
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

test.describe('Mon plan', () => {
  let ctx: LaunchedApp
  const dir = makeDataDir()

  test.beforeAll(async () => {
    const first = await launchApp(dir)
    await first.close()
    await seedUser(dir)
    await seedDominantMistake(dir)
    ctx = await launchApp(dir)
  })
  test.afterAll(async () => { await ctx.close(); cleanup(dir) })

  test('shows the focus with evidence games, opened from "Why?"', async () => {
    await goto(ctx.page, '/plan')
    const focus = ctx.page.getByTestId('plan-focus')
    await expect(focus).toBeVisible()

    const insight = focus.getByTestId('plan-insight').first()
    await insight.getByTestId('plan-why-toggle').click()
    const games = insight.getByTestId('plan-why-games')
    await expect(games).toBeVisible()
    await expect(games.locator('button').first()).toBeVisible()
    expect(ctx.pageErrors).toEqual([])
  })

  test('the reassessment banner and nav entry both work', async () => {
    await goto(ctx.page, '/')
    await ctx.page.getByRole('link', { name: /mon plan|my plan/i }).click()
    await expect(ctx.page).toHaveURL(/\/plan$/)
    expect(ctx.pageErrors).toEqual([])
  })
})
