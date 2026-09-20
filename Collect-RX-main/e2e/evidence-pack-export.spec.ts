/**
 * P10-11 regression: "Export evidence pack (JSON)" on a claim's detail page
 * called the API and showed a checksum toast, but never actually gave the
 * user a file — the backend's full pack payload (res.data) was discarded.
 * This proves a real browser download fires with the pack contents.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { test, expect } from '@playwright/test'
import { signInAsE2eUser } from './helpers/signIn'

const email = process.env.E2E_USER_EMAIL
const password = process.env.E2E_USER_PASSWORD || 'changeme'
const practiceId = process.env.E2E_PRACTICE_ID

test.describe('evidence pack export', () => {
  let claimId: string
  let claimNumber: string

  test.beforeAll(async () => {
    test.skip(!process.env.DATABASE_URL || !practiceId, 'DATABASE_URL/E2E_PRACTICE_ID missing')
    const prisma = new PrismaClient()
    claimNumber = `E2E-EVID-${Date.now()}`
    try {
      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practiceId!,
          carrierId: 'sun_life',
          claimNumber,
          patientToken: randomUUID(),
          billedAmount: 500,
          outstandingAmount: 500,
          daysOutstanding: 40,
          status: 'PENDING',
        },
      })
      claimId = claim.id
    } finally {
      await prisma.$disconnect()
    }
  })

  test('downloads a real JSON file containing the exported pack, not just a toast', async ({ page }) => {
    test.skip(!email, 'E2E_USER_EMAIL missing — check DATABASE_URL for e2e auto-seed')

    await signInAsE2eUser(page, email!, password)
    await page.goto(`/insurance/${claimId}`)

    await expect(page.getByRole('heading', { name: `Claim ${claimNumber}` })).toBeVisible({ timeout: 20_000 })

    const exportButton = page.getByRole('button', { name: /Export evidence pack/i })
    await expect(exportButton).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportButton.click(),
    ])

    expect(download.suggestedFilename()).toBe(`evidence-pack-${claimNumber}.json`)
    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()
    const fs = await import('node:fs')
    const content = JSON.parse(fs.readFileSync(downloadPath!, 'utf8'))
    expect(content.claim.claimNumber).toBe(claimNumber)

    await expect(page.getByText(/Evidence pack exported \(checksum/i)).toBeVisible()
  })
})
