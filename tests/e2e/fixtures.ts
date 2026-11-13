import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '..', '..')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  dir: string
  /** Uncaught exceptions raised in the renderer since launch. */
  pageErrors: string[]
  close: () => Promise<void>
}

/** A fresh, isolated data folder: never the developer's dev.db or real userData. */
export function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'nxm-e2e-'))
}

/**
 * Launches the *built* app (`npm run build` first) against an isolated data
 * folder. English UI is forced so assertions don't depend on the OS locale.
 */
export async function launchApp(dir = makeDataDir(), opts: { cloud?: boolean } = {}): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: [ROOT, '--lang=en-US'],
    cwd: ROOT,
    env: {
      ...process.env,
      NEXUSMIND_DB_PATH: join(dir, 'data', 'nexusmind.db'),
      NEXUSMIND_USER_DATA: join(dir, 'userData'),
      ELECTRON_RENDERER_URL: '',
      // Most suites test the local app; the cloud gate has its own suite.
      NEXUSMIND_CLOUD_DISABLED: opts.cloud ? '0' : '1',
    },
  })
  const page = await app.firstWindow()
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  await page.waitForLoadState('domcontentloaded')
  return {
    app,
    page,
    dir,
    pageErrors,
    close: async () => {
      await app.close()
    },
  }
}

/**
 * Inserts a minimal onboarded user with the app's own Prisma client, so the
 * main UI (not onboarding) loads. The schema must already exist: launch the
 * app once on `dir` before calling this.
 */
export async function seedUser(dir: string): Promise<void> {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = join(ROOT, 'prisma-client', 'query_engine-windows.dll.node')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require(join(ROOT, 'prisma-client'))
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${join(dir, 'data', 'nexusmind.db')}` } } })
  try {
    const user = await prisma.user.create({
      data: {
        summonerName: 'E2E Tester',
        displayName: 'E2E Tester',
        puuid: 'e2e-puuid',
        tagLine: 'E2E',
        region: 'EUW1',
        nextAssessmentAt: new Date(Date.now() + 14 * 86400000),
      },
    })
    // Analytics and the dashboard are gated behind a first assessment.
    await prisma.assessment.create({
      data: { userId: user.id, scores: { create: [{ fundamentalId: 'wave_management', score: 3 }] } },
    })
  } finally {
    await prisma.$disconnect()
  }
}

export function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows may still hold files */ }
}

/** Client-side navigation (the app uses a hash router). */
export async function goto(page: Page, route: string): Promise<void> {
  await page.evaluate((r) => { window.location.hash = `#${r}` }, route)
  await page.waitForTimeout(800)
}
