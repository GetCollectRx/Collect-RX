/**
 * Not in latest file page (DEC-14): claims a confirmed full export left out wait
 * for the practice owner, who confirms them resolved or puts them back.
 */
import { test, expect } from '@playwright/test'
import { signInAsE2eUser } from './helpers/signIn'

const email = process.env.E2E_USER_EMAIL
const password = process.env.E2E_USER_PASSWORD || 'changeme'

const header = 'claim_number,patient_first_name,patient_last_name,carrier_name,procedure_code,amount_billed,amount_outstanding,days_outstanding,patient_dob,policy_number,group_number,submission_date,treatment_date,status,payer_type,treatment_codes,expected_amount'
const line = (id: string, n: number) =>
  `${id},Test,Patient${n},Sun Life,D1110,120.00,120.00,45,1985-06-12,SUB${n},GRP1,2026-08-20,2026-08-10,Pending,PRIVATE,D1110,100.00`

test.describe('Not in latest file page', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!email, 'E2E_USER_EMAIL missing, check DATABASE_URL for e2e auto-seed')

  test('owner confirms one claim resolved and puts another back', async ({ page }) => {
    await signInAsE2eUser(page, email!, password)
    const stamp = Date.now().toString(36)
    const ids = [`E2E-NL-${stamp}-1`, `E2E-NL-${stamp}-2`, `E2E-NL-${stamp}-3`]
    const csv = (rows: string[]) => Buffer.from([header, ...rows].join('\n'))

    // Clear anything left waiting by earlier runs, then seed through the real import.
    const before = await page.request.get('/api/claims-not-in-latest-file')
    expect(before.ok()).toBeTruthy()
    const leftovers = ((await before.json()) as { data: { id: string }[] }).data.map((c) => c.id)
    if (leftovers.length > 0) {
      const cleared = await page.request.post('/api/claims-not-in-latest-file/decision', {
        data: { claimIds: leftovers.slice(0, 200), decision: 'RESOLVED' },
      })
      expect(cleared.ok()).toBeTruthy()
    }

    const seed = await page.request.post('/api/admin/sync/import/other', {
      multipart: {
        file: { name: 'seed.csv', mimeType: 'text/csv', buffer: csv(ids.map((id, i) => line(id, i + 1))) },
        exportScope: 'partial',
      },
    })
    expect(seed.ok()).toBeTruthy()
    // The practice may hold other open claims, and other specs seed claims in parallel, so ask the
    // server what this file leaves out and retry if that count moves before the import (409).
    let imported = false
    for (let attempt = 0; attempt < 4 && !imported; attempt++) {
      const preview = await page.request.post('/api/admin/sync/import/other/absence-preview', {
        multipart: { file: { name: 'one.csv', mimeType: 'text/csv', buffer: csv([line(ids[0], 1)]) } },
      })
      const missing = ((await preview.json()) as { data: { missingClaims: number; wouldHold: boolean } }).data
      test.skip(missing.wouldHold, 'Other open claims would trip the mass-absence guard in this database')
      const full = await page.request.post('/api/admin/sync/import/other', {
        multipart: {
          file: { name: 'one.csv', mimeType: 'text/csv', buffer: csv([line(ids[0], 1)]) },
          exportScope: 'full',
          confirmedMissingCount: String(missing.missingClaims),
        },
      })
      if (full.status() === 409) continue
      expect(full.ok()).toBeTruthy()
      imported = true
    }
    expect(imported).toBeTruthy()

    await page.goto('/not-in-latest-file')
    await expect(page.getByRole('heading', { name: 'Not in latest file' })).toBeVisible({ timeout: 20_000 })
    const second = page.getByRole('row', { name: new RegExp(ids[1]) })
    const third = page.getByRole('row', { name: new RegExp(ids[2]) })
    await expect(second).toBeVisible()
    await expect(third).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(ids[0]) })).toHaveCount(0)

    await expect(page.getByRole('button', { name: /Confirm resolved/ })).toBeDisabled()
    await second.getByRole('checkbox').check()
    await page.getByRole('button', { name: /^Confirm resolved/ }).click()
    await expect(page.getByRole('dialog').getByText(/will stay closed/)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm resolved', exact: true }).click()
    await expect(second).toHaveCount(0)
    await expect(third).toBeVisible()

    await third.getByRole('checkbox').check()
    await page.getByRole('button', { name: /^Put back into follow-up/ }).first().click()
    await expect(page.getByRole('dialog').getByText(/go back to the follow-up/)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Put back into follow-up', exact: true }).click()
    await expect(third).toHaveCount(0)
  })
})
