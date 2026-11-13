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
    // Ten days earlier: 8 games at ~9 CS/min, so today's 5.7 reads as a CS
    // downtrend — a measurable problem the focus can be tested on.
    const older = await prisma.session.create({
      data: { userId: user.id, objectiveId: 'csing_pathing', objectiveIds: '["csing_pathing"]', status: 'completed', date: new Date(Date.now() - 13 * 86_400_000) },
    })
    for (let i = 0; i < 8; i++) {
      await prisma.game.create({
        data: {
          sessionId: older.id, matchId: `EUW1_E2EOLD${i}`, champion: 'Ahri', role: 'MIDDLE',
          kills: 6, deaths: 3, assists: 6, cs: 260 + (i % 3) * 10, visionScore: 22, duration: 1800, win: true,
          gameEndAt: new Date(Date.now() - (10 * 1440 + i * 120) * 60_000),
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

  test('insights are grouped by problem, the break guard comes first, at most one focus', async () => {
    await goto(ctx.page, '/session')
    const card = ctx.page.getByTestId('assistant-card-session')
    const insights = card.getByTestId('assistant-insight')
    await expect(insights.first()).toHaveAttribute('data-rule-id', 'tilt_break')
    const problems = await insights.evaluateAll((els) => els.map((e) => e.getAttribute('data-problem-id')))
    expect(problems.every(Boolean)).toBe(true)
    expect(new Set(problems).size).toBe(problems.length)
    expect(await card.locator('[data-focus="true"]').count()).toBeLessThanOrEqual(1)
    // The brief was remembered for anti-repetition.
    await expect.poll(async () => {
      const prisma = prismaFor(dir)
      try { return await prisma.adviceLog.count() } finally { await prisma.$disconnect() }
    }).toBeGreaterThan(0)
  })

  test('the focus can be tested over 5 games: experiment panel, then abandon', async () => {
    await goto(ctx.page, '/session')
    const card = ctx.page.getByTestId('assistant-card-session')
    const start = card.getByTestId('coach-start-experiment')
    await expect(start).toBeVisible()
    await start.click()
    const panel = card.getByTestId('coach-experiment')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('data-status', 'active')
    await expect(panel).toContainText('0 passed out of 0')
    await expect(card.getByTestId('coach-start-experiment')).toHaveCount(0)
    await expect.poll(async () => {
      const prisma = prismaFor(dir)
      try { return await prisma.coachingExperiment.count({ where: { status: 'active' } }) } finally { await prisma.$disconnect() }
    }).toBe(1)

    await panel.getByRole('button', { name: 'Abandon the experiment' }).click()
    await expect(card.getByTestId('coach-experiment')).toHaveCount(0)
    await expect(card.getByTestId('coach-start-experiment')).toBeVisible()
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
