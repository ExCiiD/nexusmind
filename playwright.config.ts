import { defineConfig } from '@playwright/test'

// E2E tests launch the built Electron app (`npm run build` first — the
// `test:e2e` script does it). One app at a time: each suite owns its
// isolated data folder, but parallel Electron instances are slow and flaky.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
})
