/**
 * Carrier approvals page (DEC-9 b): the practice owner approves a carrier once,
 * then can stop calling it. Seeds a PENDING checkpoint directly, drives the real
 * page and API, and checks the append-only audit trail.
 */
import { PrismaClient } from '@prisma/client'
import { test, expect } from '@playwright/test'
import { signInAsE2eUser } from './helpers/signIn'

const email = process.env.E2E_USER_EMAIL
const password = process.env.E2E_USER_PASSWORD || 'changeme'
const practiceId = process.env.E2E_PRACTICE_ID

async function withBypass<T>(prisma: PrismaClient, work: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'true', true)`
    return work(tx as unknown as PrismaClient)
  })
}

test.describe('Carrier approvals page', () => {
  test.skip(!email || !practiceId, 'E2E_USER_EMAIL / E2E_PRACTICE_ID missing, check DATABASE_URL for e2e auto-seed')

  const prisma = new PrismaClient()

  test.beforeEach(async () => {
    await withBypass(prisma, async (tx) => {
      await tx.dispatchCheckpoint.deleteMany({ where: { practiceId: practiceId! } })
      await tx.dispatchCheckpoint.create({ data: { practiceId: practiceId!, carrierId: 'sun_life' } })
    })
  })

  test.afterAll(async () => {
    await withBypass(prisma, (tx) => tx.dispatchCheckpoint.deleteMany({ where: { practiceId: practiceId! } }))
    await prisma.$disconnect()
  })

  test('owner approves a waiting carrier, then stops calling it', async ({ page }) => {
    await signInAsE2eUser(page, email!, password)
    await page.goto('/carrier-approvals')
    await expect(page.getByRole('heading', { name: 'Carrier approvals' })).toBeVisible({ timeout: 20_000 })

    const row = page.getByRole('row', { name: /Sun Life/ })
    await expect(row.getByText('Waiting for your approval')).toBeVisible()

    await row.getByRole('button', { name: 'Approve' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/automated calls to Sun Life/)).toBeVisible()
    // Cancel changes nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(row.getByText('Waiting for your approval')).toBeVisible()

    await row.getByRole('button', { name: 'Approve' }).click()
    await page.getByRole('dialog').getByRole('textbox').fill('Reviewed carrier setup')
    await page.getByRole('dialog').getByRole('button', { name: 'Approve and start calling' }).click()
    await expect(row.getByText('Approved', { exact: true })).toBeVisible()
    await expect(row.getByText('Reviewed carrier setup')).toBeVisible()

    await row.getByRole('button', { name: 'Stop calling' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Stop calling' }).click()
    await expect(row.getByText('Calling stopped')).toBeVisible()
    await expect(row.getByRole('button', { name: 'Approve' })).toBeVisible()

    const events = await withBypass(prisma, (tx) =>
      tx.dispatchCheckpointEvent.findMany({
        where: { practiceId: practiceId!, carrierId: 'sun_life' },
        orderBy: { createdAt: 'asc' },
      }),
    )
    expect(events.map((e) => e.action).slice(-2)).toEqual(['APPROVED', 'REVOKED'])
    expect(events.find((e) => e.action === 'APPROVED')?.actorUserId).toBeTruthy()
  })
})
