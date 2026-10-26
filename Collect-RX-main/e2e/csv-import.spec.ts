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
    // The sample file has no payer type column, so the wizard must ask. No silent default.
    await expect(page.getByRole('button', { name: /Import \d+ claims/ })).toBeDisabled()
    await page.locator('#csv-payer-type').selectOption('PRIVATE')
    await expect(page.getByRole('button', { name: /Import \d+ claims/ })).toBeEnabled()
    await expect(page.getByText('sample-claims.csv')).toBeVisible()
  })

  test('mixed payer programs: only the unclassified row needs a choice; bad values block', async ({ page }) => {
    test.skip(!email, 'E2E_USER_EMAIL missing — check DATABASE_URL for e2e auto-seed')
    await signInAsE2eUser(page, email!, password)
    await page.goto('/import')
    const header = 'id,patient_first_name,patient_last_name,carrier_code,carrier_name,policy_number,patient_dob,procedure_code,amount_billed,amount_outstanding,submission_date,payer_type'
    const row = (id: string, payer: string) =>
      `${id},Test,Patient,sun_life,Sun Life,P-${id},1980-01-01,D2750,500.00,500.00,2025-01-01,${payer}`
    const upload = (name: string, rows: string[]) =>
      page.locator('#csv-file').setInputFiles({
        name,
        mimeType: 'text/csv',
        buffer: Buffer.from([header, ...rows].join('\n')),
      })

    await upload('mixed.csv', [row('E2E-1', 'PRIVATE'), row('E2E-2', 'CDCP'), row('E2E-3', '')])
    await expect(page.getByRole('heading', { name: 'Step 2 — Preview & confirm' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /Import \d+ claims/ })).toBeDisabled()
    await page.locator('#csv-payer-type').selectOption('PRIVATE')
    await expect(page.getByRole('button', { name: /Import \d+ claims/ })).toBeEnabled()

    await page.goto('/import')
    await upload('bad.csv', [row('E2E-4', 'medicare')])
    await expect(page.getByText(/Unrecognized payer type "medicare"/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /Import \d+ claims/ })).toBeDisabled()
  })
})
