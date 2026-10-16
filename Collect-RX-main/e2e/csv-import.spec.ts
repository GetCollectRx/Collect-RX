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
    // Coverage has no default either: the file must say whether it lists all open claims.
    await expect(page.locator('#csv-scope-full')).not.toBeChecked()
    await expect(page.locator('#csv-scope-partial')).not.toBeChecked()
    await expect(page.getByRole('button', { name: /Import \d+ claims/ })).toBeDisabled()
    await page.locator('#csv-scope-partial').check()
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
    await page.locator('#csv-scope-partial').check()
    await expect(page.getByRole('button', { name: /Import \d+ claims/ })).toBeEnabled()

    await page.goto('/import')
    await upload('bad.csv', [row('E2E-4', 'medicare')])
    await expect(page.getByText(/Unrecognized payer type "medicare"/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /Import \d+ claims/ })).toBeDisabled()
  })

  test('a full export shows what would stop being called and needs a confirmation', async ({ page }) => {
    test.skip(!email, 'E2E_USER_EMAIL missing, check DATABASE_URL for e2e auto-seed')
    await signInAsE2eUser(page, email!, password)

    // Seed open claims through the real import so there is something a smaller file can leave out.
    const header = 'claim_number,patient_first_name,patient_last_name,carrier_name,procedure_code,amount_billed,amount_outstanding,days_outstanding,patient_dob,policy_number,group_number,submission_date,treatment_date,status,payer_type,treatment_codes,expected_amount'
    const line = (id: string, n: number) =>
      `${id},Test,Patient${n},Sun Life,D1110,120.00,120.00,45,1985-06-12,SUB${n},GRP1,2026-08-20,2026-08-10,Pending,PRIVATE,D1110,100.00`
    const stamp = Date.now().toString(36)
    const seedIds = [`E2E-FX-${stamp}-1`, `E2E-FX-${stamp}-2`, `E2E-FX-${stamp}-3`]
    const seed = await page.request.post('/api/admin/sync/import/other', {
      multipart: {
        file: { name: 'seed.csv', mimeType: 'text/csv', buffer: Buffer.from([header, ...seedIds.map((id, i) => line(id, i + 1))].join('\n')) },
        exportScope: 'partial',
      },
    })
    expect(seed.ok()).toBeTruthy()

    await page.goto('/import')
    await page.locator('#csv-file').setInputFiles({
      name: 'one-claim.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from([header, line(seedIds[0], 1)].join('\n')),
    })
    await expect(page.getByRole('heading', { name: 'Step 2 — Preview & confirm' })).toBeVisible({ timeout: 10_000 })
    const importButton = page.getByRole('button', { name: /Import \d+ claims/ })
    await expect(importButton).toBeDisabled()

    await page.locator('#csv-scope-full').check()
    const confirmBox = page.getByTestId('absence-confirm')
    await expect(confirmBox).toBeVisible({ timeout: 10_000 })
    await expect(confirmBox).toContainText(/\d+ of your \d+ open claims are not in this file/)
    await expect(importButton).toBeDisabled()
    await page.locator('#csv-absence-confirm').check()
    await expect(importButton).toBeEnabled()
    // Switching to partial drops the requirement.
    await page.locator('#csv-scope-partial').check()
    await expect(page.getByTestId('absence-confirm')).toHaveCount(0)
    await expect(importButton).toBeEnabled()
  })
})
