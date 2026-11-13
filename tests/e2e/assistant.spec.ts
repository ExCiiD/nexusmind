import { test, expect } from '@playwright/test'
import { join, resolve } from 'path'
import { launchApp, makeDataDir, seedUser, cleanup, goto, type LaunchedApp } from './fixtures'

/**
 * Phase A assistant: the rule-based cards render on real pages with real
 * IPC, and a 👍 is stored locally.
 */

const ROOT = resolve(__dirname, '..', '..')

function prismaFor(dir: string) {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = join(ROOT, 'prisma-client', 'query_engine-windows.dll.node')
  const { PrismaClient } = require(join(ROOT, 'prisma-client'))
  return new PrismaClient({ datasources: { db: { url: `file:${join(dir, 'data', 'nexusmind.db')}` } } })
}

/** An active session with 4 straight losses, back to back over ~2.5 h. */
async function seedLosingSession(dir: string): Promise<void> {
  const prisma = prismaFor(dir)
  try {
    const user = await prisma.user.findFirstOrThrow()
    const session = await prisma.session.create({
      data: { userId: user.id, objectiveId: 'wave_management', objectiveIds: '["wave_management"]', status: 'active' },
    })
    for (let i = 0; i < 4; i++) {
      await prisma.game.create({
        data: {
          sessionId: session.id, matchId: `EUW1_E2E${i}`, champion: 'Ahri', role: 'MIDDLE',
          kills: 1, deaths: 7, assists: 2, cs: 170, visionScore: 15, duration: 1800, win: false,
          gameEndAt: new Date(Date.now() - (5 + i * 35) * 60_000),
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

test.describe('rule-based assistant', () => {
  let ctx: LaunchedApp
  const dir = makeDataDir()

  test.beforeAll(async () => {
    const first = await launchApp(dir)
    await first.close()
    await seedUser(dir)
    await seedLosingSession(dir)
    ctx = await launchApp(dir)
  })
  test.afterAll(async () => { await ctx.close(); cleanup(dir) })

  test('session page shows the brief with an explained break suggestion', async () => {
    await goto(ctx.page, '/session')
    const card = ctx.page.getByTestId('assistant-card-session')
    await expect(card).toBeVisible()
    // Wording is drawn from several variants (seeded by player + day), so
    // assert the rule that fired and the explanation, not a phrasing.
    const breakInsight = card.locator('[data-testid="assistant-insight"][data-rule-id="tilt_break"]')
    await expect(breakInsight).toBeVisible()
    await expect(breakInsight).toContainText('4')
    await expect(card).toContainText('Based on')
    expect(ctx.pageErrors).toEqual([])
  })

  test('a thumbs-up is stored locally', async () => {
    await goto(ctx.page, '/session')
    const card = ctx.page.getByTestId('assistant-card-session')
    await card.getByRole('button', { name: 'Helpful' }).first().click()
    await expect.poll(async () => {
      const prisma = prismaFor(dir)
      try { return await prisma.assistantFeedback.count({ where: { vote: 1 } }) } finally { await prisma.$disconnect() }
    }).toBe(1)
  })

  test('dashboard shows the weekly summary', async () => {
    await goto(ctx.page, '/')
    const card = ctx.page.getByTestId('assistant-card-weekly')
    await expect(card).toBeVisible()
    await expect(card).toContainText('4 games this week')
    expect(ctx.pageErrors).toEqual([])
  })
})
