import { test, expect } from '@playwright/test'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { launchApp, makeDataDir, seedUser, cleanup, goto, type LaunchedApp } from './fixtures'

/**
 * End-to-end tests against the built app (`npm run build`), each suite on its
 * own throw-away data folder. They need Windows (Prisma engine + ffmpeg).
 */

test.describe('first launch (no account)', () => {
  let ctx: LaunchedApp

  test.beforeAll(async () => { ctx = await launchApp() })
  test.afterAll(async () => { await ctx.close(); cleanup(ctx.dir) })

  test('opens the onboarding flow', async () => {
    await expect.poll(() => ctx.page.evaluate(() => window.location.hash)).toContain('/onboarding')
  })

  test('creates its database in the isolated folder only', async () => {
    expect(existsSync(join(ctx.dir, 'data', 'nexusmind.db'))).toBe(true)
  })
})

test.describe('NexusMind account gate', () => {
  let ctx: LaunchedApp

  test.beforeAll(async () => { ctx = await launchApp(makeDataDir(), { cloud: true }) })
  test.afterAll(async () => { await ctx.close(); cleanup(ctx.dir) })

  test('asks to sign in before anything else when the build has a cloud backend', async () => {
    const status = await ctx.page.evaluate(() => (window as any).api.cloudStatus())
    test.skip(!status.configured, 'build without Supabase configuration (e.g. CI)')
    await expect(ctx.page.getByText('Sign in to NexusMind')).toBeVisible()
    await expect(ctx.page.getByLabel('E-mail')).toBeVisible()
    // Onboarding is not reachable until signed in.
    await expect(ctx.page.getByText('Connect Your Riot Account')).toHaveCount(0)
  })

  test('rejects a malformed e-mail without calling the backend', async () => {
    const status = await ctx.page.evaluate(() => (window as any).api.cloudStatus())
    test.skip(!status.configured, 'build without Supabase configuration (e.g. CI)')
    const err = await ctx.page.evaluate(() => (window as any).api.cloudSendCode('not-an-email').then(() => null, (e: Error) => e.message))
    expect(err).toMatch(/Invalid input/)
  })
})

test.describe('security hardening', () => {
  let ctx: LaunchedApp

  test.beforeAll(async () => { ctx = await launchApp() })
  test.afterAll(async () => { await ctx.close(); cleanup(ctx.dir) })

  test('ships a Content-Security-Policy', async () => {
    const csp = await ctx.page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  test('renderer is sandboxed: only the preload API is exposed', async () => {
    const env = await ctx.page.evaluate(() => ({
      api: typeof (window as any).api,
      require: typeof (window as any).require,
      process: typeof (window as any).process,
    }))
    expect(env).toEqual({ api: 'object', require: 'undefined', process: 'undefined' })
  })

  test('window.open never creates a new Electron window', async () => {
    await ctx.page.evaluate(() => window.open('https://example.com', '_blank'))
    await ctx.page.waitForTimeout(500)
    expect(ctx.app.windows()).toHaveLength(1)
  })

  test('inline scripts are blocked by the CSP', async () => {
    const ran = await ctx.page.evaluate(() => {
      ;(window as any).__inline = false
      const s = document.createElement('script')
      s.textContent = 'window.__inline = true'
      document.head.appendChild(s)
      return (window as any).__inline
    })
    expect(ran).toBe(false)
  })

  test('nxm:// refuses media files outside the recording folders', async () => {
    const outside = join(ctx.dir, 'not-a-recording.jpg')
    writeFileSync(outside, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    const status = await ctx.page.evaluate(async (p) => {
      const r = await fetch('nxm:///' + p.replace(/\\/g, '/'))
      return r.status
    }, outside)
    expect(status).toBe(403)
  })
})

test.describe('main UI with an onboarded user', () => {
  const MAIN_ROUTES = [
    '/', '/session', '/record', '/review', '/analytics', '/history',
    '/stats', '/stats/mistakes', '/assessment', '/team', '/coaching', '/settings', '/help',
  ]
  let ctx: LaunchedApp
  const dir = makeDataDir()

  test.beforeAll(async () => {
    // First launch creates the schema, then we seed and relaunch.
    const first = await launchApp(dir)
    await first.close()
    await seedUser(dir)
    ctx = await launchApp(dir)
  })
  test.afterAll(async () => { await ctx.close(); cleanup(dir) })

  test('lands on the dashboard, not onboarding', async () => {
    await expect.poll(() => ctx.page.evaluate(() => window.location.hash)).not.toContain('/onboarding')
    await expect(ctx.page.getByText('E2E Tester').first()).toBeVisible()
  })

  test('the feedback button opens the bug / feature form', async () => {
    await ctx.page.getByRole('button', { name: 'Report a bug / suggest' }).click()
    const dialog = ctx.page.getByRole('dialog')
    await expect(dialog.getByText('Help improve NexusMind')).toBeVisible()
    const send = dialog.getByRole('button', { name: 'Send' })
    await expect(send).toBeDisabled()
    await dialog.getByLabel('Short title').fill('Crash on save')
    await dialog.getByLabel(/What happened/).fill('The app closes when I save a review.')
    await expect(send).toBeEnabled()
    await ctx.page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  for (const route of MAIN_ROUTES) {
    test(`page ${route} renders without crashing`, async () => {
      const before = ctx.pageErrors.length
      await goto(ctx.page, route)
      // The sidebar stays mounted unless the whole tree crashed.
      await expect(ctx.page.getByText('NexusMind').first()).toBeVisible()
      const bodyText = await ctx.page.evaluate(() => document.body.innerText)
      expect(bodyText).not.toMatch(/Something went wrong|Unexpected Application Error/i)
      expect(ctx.pageErrors.slice(before), `uncaught errors on ${route}`).toEqual([])
    })
  }
})
