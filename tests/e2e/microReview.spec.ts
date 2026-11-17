import { test, expect } from '@playwright/test'
import { join, resolve } from 'path'
import { launchApp, makeDataDir, seedUser, cleanup, goto, type LaunchedApp } from './fixtures'
import { buildGame, at } from '../unit/microReviewFixtures'

/**
 * Micro-review, end to end in the real app: the cached timeline is analysed
 * in the main process, the Review page shows the guided QCM, answers reach
 * the Mistake Library (a `justified` one does not), the Codex fiche and the
 * XP appear, the Mistake Lab shows the prescription, and the low-energy
 * protocol becomes the running session's objective in one click.
 */

const ROOT = resolve(__dirname, '..', '..')
const BARON_PIT = { x: 5007, y: 10471 }
const DRAGON_PIT = { x: 9866, y: 4414 }

function prismaFor(dir: string) {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = join(ROOT, 'prisma-client', 'query_engine-windows.dll.node')
  const { PrismaClient } = require(join(ROOT, 'prisma-client'))
  return new PrismaClient({ datasources: { db: { url: `file:${join(dir, 'data', 'nexusmind.db')}` } } })
}

/** Top laner: enemy dragon at 15:30 with no ward, then a death next to Baron 30 s before it is lost. */
function timelineFixture() {
  const g = buildGame({ minutes: 30, me: 1, events: [
    { type: 'ELITE_MONSTER_KILL', timestamp: at(15, 30), killerId: 7, killerTeamId: 200, monsterType: 'DRAGON', position: DRAGON_PIT },
    { type: 'CHAMPION_KILL', timestamp: at(25, 28), victimId: 1, killerId: 7, assistingParticipantIds: [8, 9], position: { x: 5600, y: 10000 } },
    { type: 'ELITE_MONSTER_KILL', timestamp: at(25, 58), killerId: 7, killerTeamId: 200, monsterType: 'BARON_NASHOR', position: BARON_PIT },
  ] })
  g.match.info.participants[0].puuid = 'e2e-puuid'
  g.match.info.participants[0].championName = 'Ahri'
  return g
}

let gameId = ''
let sessionId = ''

/**
 * Yesterday afternoon, local time. The games must not end at night: a game
 * played between 0 h and 6 h is a low-energy one, and the micro-review then
 * offers the protocol in place of the second diagnosis — whatever the hour
 * this suite runs at, the cards below must be the daytime ones.
 */
function yesterdayAt(hour: number, minute: number): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, hour, minute)
}

/** A running session with two straight losses; the first one has its timeline cached. */
async function seedSession(dir: string): Promise<void> {
  const prisma = prismaFor(dir)
  try {
    const user = await prisma.user.findFirstOrThrow()
    const session = await prisma.session.create({
      data: { userId: user.id, objectiveId: 'vision_control', objectiveIds: '["vision_control"]', status: 'active' },
    })
    sessionId = session.id
    const fixture = timelineFixture()
    const game = await prisma.game.create({
      data: {
        sessionId, matchId: 'EUW1_MRE2E1', champion: 'Ahri', role: 'TOP', kills: 2, deaths: 5, assists: 3, cs: 190, visionScore: 14,
        duration: 1800, win: false, gameEndAt: yesterdayAt(15, 0),
      },
    })
    gameId = game.id
    await prisma.matchCache.create({ data: { matchId: 'EUW1_MRE2E1', matchJson: JSON.stringify(fixture.match), timelineJson: JSON.stringify(fixture.timeline) } })
    await prisma.game.create({
      data: {
        sessionId, matchId: 'EUW1_MRE2E2', champion: 'Ahri', role: 'TOP', kills: 1, deaths: 6, assists: 2, cs: 170, visionScore: 12,
        duration: 1700, win: false, gameEndAt: yesterdayAt(15, 40),
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

test.describe('guided micro-review', () => {
  // One story told in order: each step builds on what the previous one stored.
  test.describe.configure({ mode: 'serial' })
  let ctx: LaunchedApp
  const dir = makeDataDir()

  test.beforeAll(async () => {
    const first = await launchApp(dir)
    await first.close()
    await seedUser(dir)
    await seedSession(dir)
    ctx = await launchApp(dir)
  })
  test.afterAll(async () => { await ctx.close(); cleanup(dir) })

  test('Review: the moments are detected, answered, and reach the Mistake Library', async () => {
    await goto(ctx.page, `/review?gameId=${gameId}`)
    const panel = ctx.page.getByTestId('micro-review')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByRole('button', { name: /15:10/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: /25:28/ })).toBeVisible()
    // Moment 1 — enemy dragon without setup: the fiche's official example is offered up front.
    await expect(panel.getByTestId('micro-review-summary')).toContainText('15:10')
    await expect(panel.getByTestId('qcm-reference-clips')).toBeVisible()

    // A justified answer: recorded, but no mistake.
    await panel.getByRole('button', { name: /Not contestable/ }).click()
    await expect(panel.getByText(/does not count in your mistake stats/)).toBeVisible()

    // Moment 2 — death next to Baron, 30 s before it is lost.
    await panel.getByRole('button', { name: /Next moment/ }).click()
    await expect(panel.getByTestId('micro-review-summary')).toContainText('died 30 s before losing Baron')
    await panel.getByRole('button', { name: /Bad objective setup/ }).click()
    await expect(panel.getByTestId('codex-card')).toBeVisible()
    await expect(panel.getByTestId('codex-card')).toContainText(/Objective setup/)

    // Every moment answered: completion + XP, once.
    const done = panel.getByTestId('micro-review-done')
    await expect(done).toBeVisible()
    await expect(done).toContainText('+30 Ascend XP')
    await expect(done).toContainText('1 mistake(s) tagged, 1 justified decision(s)')

    // The session objective (vision control) is checked automatically: no ward before the dragon — the Baron,
    // lost while the player was dead, is not held against them.
    await expect(ctx.page.getByTestId('objective-auto-check')).toContainText('(0/1)')

    const prisma = prismaFor(dir)
    try {
      const answers = await prisma.microReviewAnswer.findMany({ where: { gameId }, orderBy: { gameTimeSec: 'asc' } })
      expect(answers.map((a: any) => [a.momentKey, a.outcome, a.tagSlug])).toEqual([
        ['absent-objective@910', 'justified', null],
        ['critical-death@1528', 'mistake', 'no-ward-pre-obj'],
      ])
      const mistakes = await prisma.mistake.findMany({ where: { gameId }, include: { tag: true } })
      expect(mistakes.map((m: any) => [m.tag.slug, m.gameTimeSec, m.autoDetected])).toEqual([['no-ward-pre-obj', 1528, false]])
      expect((await prisma.user.findFirstOrThrow()).xp).toBe(30)
    } finally {
      await prisma.$disconnect()
    }
    expect(ctx.pageErrors).toEqual([])
  })

  test('Review: coming back shows the stored answers and grants nothing more', async () => {
    await goto(ctx.page, '/')
    await goto(ctx.page, `/review?gameId=${gameId}`)
    const panel = ctx.page.getByTestId('micro-review')
    await expect(panel.getByTestId('micro-review-done')).toBeVisible({ timeout: 20_000 })
    // Changing an answer keeps the XP where it was.
    await panel.getByRole('button', { name: /25:28/ }).click()
    await panel.getByRole('button', { name: /Caught alone/ }).click()
    await expect(panel.getByTestId('codex-card')).toBeVisible()
    const prisma = prismaFor(dir)
    try {
      await expect.poll(async () => (await prisma.mistake.findMany({ where: { gameId }, include: { tag: true } })).map((m: any) => m.tag.slug)).toEqual(['caught-out'])
      expect((await prisma.user.findFirstOrThrow()).xp).toBe(30)
    } finally {
      await prisma.$disconnect()
    }
    expect(ctx.pageErrors).toEqual([])
  })

  test('Mistake Lab: the tagged mistake comes with its Codex prescription', async () => {
    await goto(ctx.page, '/stats/mistakes')
    await expect(ctx.page.getByTestId('codex-card')).toBeVisible({ timeout: 15_000 })
    await expect(ctx.page.getByRole('button', { name: /Set up my next session/ })).toBeVisible()
    expect(ctx.pageErrors).toEqual([])
  })

  test('Dashboard: two losses in a row → the low-energy protocol becomes the session objective', async () => {
    await goto(ctx.page, '/')
    const prompt = ctx.page.getByTestId('low-energy-dashboard')
    await expect(prompt).toBeVisible({ timeout: 15_000 })
    await expect(prompt).toContainText('2 losses in a row in this session')
    await prompt.getByRole('button', { name: /Activate on the running session/ }).click()
    await expect(prompt).toContainText('Low-energy protocol active on the running session')

    const prisma = prismaFor(dir)
    try {
      const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })
      expect(session.objectiveId).toBe('resilience')
      expect(JSON.parse(session.objectiveIds)).toEqual(['resilience', 'vision_control'])
      expect(session.customNote).toContain('Low-energy protocol')
    } finally {
      await prisma.$disconnect()
    }
    expect(ctx.pageErrors).toEqual([])
  })

  test('Session: the protocol shows as active, and Stats → Analysis renders its panels', async () => {
    await goto(ctx.page, '/session')
    await expect(ctx.page.getByTestId('low-energy-session')).toContainText('Low-energy protocol active on the running session')
    await goto(ctx.page, '/stats')
    expect(ctx.pageErrors).toEqual([])
  })

  test('Review: "Other cause…" always offers a way out that is not a mistake', async () => {
    await goto(ctx.page, `/review?gameId=${gameId}`)
    const panel = ctx.page.getByTestId('micro-review')
    await expect(panel.getByTestId('micro-review-done')).toBeVisible({ timeout: 20_000 })
    // The death is currently tagged "Caught alone": call it a decision instead, through the 4th button.
    await panel.getByRole('button', { name: /25:28/ }).click()
    await panel.getByRole('button', { name: /Other cause/ }).click()
    await panel.getByTestId('other-justified').click()
    await expect(panel.getByText(/does not count in your mistake stats/)).toBeVisible()
    await expect(panel.getByRole('button', { name: /My call: this was not a mistake/ })).toBeVisible()

    const prisma = prismaFor(dir)
    try {
      await expect.poll(async () => (await prisma.mistake.count({ where: { gameId } }))).toBe(0)
      const answer = await prisma.microReviewAnswer.findUniqueOrThrow({ where: { gameId_momentKey: { gameId, momentKey: 'critical-death@1528' } } })
      expect([answer.outcome, answer.reason, answer.viaOther, answer.tagSlug, answer.mistakeId]).toEqual(['justified', 'assumed', true, null, null])
      expect((await prisma.user.findFirstOrThrow()).xp).toBe(30)
    } finally {
      await prisma.$disconnect()
    }
    expect(ctx.pageErrors).toEqual([])
    // Leave the Review page before the app closes: its unsaved-draft guard (beforeunload) would raise a dialog.
    await goto(ctx.page, '/')
  })
})
