/**
 * CSV import wizard smoke test — login, upload sample template, reach preview step.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { signInAsE2eUser } from './helpers/signIn'

const email = process.env.E2E_USER_EMAIL
const password = process.env.E2E_USER_PASSWORD || 'changeme'
const sampleCsv = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sample-claims.csv')

test.describe('CSV import wizard', () => {
  test('uploads sample CSV and reaches preview step', async ({ page }) => {
    test.skip(!email, 'E2E_USER_EMAIL missing — check DATABASE_URL for e2e auto-seed')

    await signInAsE2eUser(page, email!, password)
    await page.goto('/import')

    await expect(page.getByRole('heading', { name: 'Import claims from CSV' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('navigation', { name: 'Import steps' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Download sample template' })).toBeVisible()

    await page.locator('#csv-file').setInputFiles(sampleCsv)

    await expect(page.getByRole('heading', { name: 'Step 2 — Preview & confirm' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole('button', { name: /Import \d+ claims/ })).toBeEnabled()
    await expect(page.getByText('sample-claims.csv')).toBeVisible()
  })
})
