/**
 * E2E tests for the Record Hub page.
 *
 * These tests require a running Electron window exposed via Playwright's
 * Electron integration. They are intentionally skipped in CI if the
 * Electron binary is not built yet (`SKIP_E2E=1`).
 */
import { test, expect } from '@playwright/test'

const SKIP = !!process.env.SKIP_E2E

test.describe('Record Hub', () => {
  test.skip(SKIP, 'Skipped: SKIP_E2E is set')

  test('should render the page title and scan button', async ({ page }) => {
    await page.goto('/')
    await page.click('[data-testid="nav-record"]')
    await expect(page.locator('h1')).toContainText('Record Hub')
    await expect(page.locator('button:has-text("Scan")')).toBeVisible()
  })

  test('should group recordings by date', async ({ page }) => {
    await page.goto('/records')
    // Each date group header should be visible
    const groupHeaders = page.locator('[data-testid="record-group-header"]')
    const count = await groupHeaders.count()
    // Either no records (0 groups) or groups are present and labelled with a date
    if (count > 0) {
      const firstLabel = await groupHeaders.first().textContent()
      // Date labels have the form "dimanche 05/04/2026"
      expect(firstLabel).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    }
  })

  test('pagination: next/prev buttons navigate between pages', async ({ page }) => {
    await page.goto('/records')
    const nextBtn = page.locator('button:has-text("Next")')
    const prevBtn = page.locator('button:has-text("Prev")')

    if (!(await nextBtn.isDisabled())) {
      await nextBtn.click()
      await expect(prevBtn).not.toBeDisabled()
      await prevBtn.click()
      await expect(prevBtn).toBeDisabled()
    }
  })

  test('should be able to create a folder', async ({ page }) => {
    await page.goto('/records')
    await page.click('button:has-text("Create a folder")')
    await page.fill('input[placeholder="Folder name…"]', 'Test Folder')
    await page.click('button:has-text("Create")')
    await expect(page.locator('text=Test Folder')).toBeVisible()
  })

  test('checkboxes: selecting a card reveals the bulk action bar', async ({ page }) => {
    await page.goto('/records')
    const firstCheckbox = page.locator('[data-testid="record-checkbox"]').first()
    if (await firstCheckbox.isVisible()) {
      await firstCheckbox.click()
      await expect(page.locator('text=1 selected')).toBeVisible()
      await expect(page.locator('button:has-text("Delete")')).toBeVisible()
    }
  })

  test('checkboxes: group checkbox selects all in group', async ({ page }) => {
    await page.goto('/records')
    const groupCheckbox = page.locator('[data-testid="group-checkbox"]').first()
    if (await groupCheckbox.isVisible()) {
      await groupCheckbox.click()
      // Count selected
      const bar = page.locator('[data-testid="bulk-action-bar"]')
      await expect(bar).toBeVisible()
    }
  })

  test('filter: selecting SoloQ mode should update results', async ({ page }) => {
    await page.goto('/records')
    await page.click('button:has-text("Filters")')
    await page.click('button:has-text("SoloQ")')
    // Pagination should reset to page 1
    const activePage = page.locator('[data-testid="page-btn"].active')
    if (await activePage.count() > 0) {
      await expect(activePage).toHaveText('1')
    }
  })
})
