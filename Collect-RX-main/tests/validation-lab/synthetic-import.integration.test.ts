import { PrismaClient, type PracticeRole } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generatePracticeBundle } from '../../../tools/phi-guard/src/synthetic/factory.js'
import { piiVault } from '../../src/pii-vault.js'
import { parseSimpleCsv } from '../../src/server/csv/parseSimple.js'
import { runPmsImportPipeline } from '../../src/server/pms/pmsImportPipeline.js'

const previousPhiKey = process.env.PHI_ENCRYPTION_KEY
process.env.PHI_ENCRYPTION_KEY = '11'.repeat(32)

const prisma = new PrismaClient()
const bundle = generatePracticeBundle('synthetic_claim_standard', 'stage6-db', 8)
const practiceId = bundle.practice.id
const platformIdentities = bundle.identities.filter((identity) => identity.authSource === 'platform_user')
const practiceIdentities = bundle.identities.filter((identity) => identity.authSource === 'practice_user')
const issuedTokens: string[] = []

let dbReady = false
try {
  await prisma.$connect()
  await prisma.$queryRaw`SELECT 1`
  dbReady = true
} catch (error) {
  console.warn('[validation-lab synthetic import] DATABASE_URL unreachable, database assertions skipped:', (error as Error).message)
}

async function cleanup(): Promise<void> {
  if (!dbReady) return
  await prisma.callQueue.deleteMany({ where: { practiceId } })
  await prisma.workItem.deleteMany({ where: { practiceId } })
  await prisma.claimRecoveryEvent.deleteMany({ where: { practiceId } })
  await prisma.claimRecoveryAction.deleteMany({ where: { practiceId } })
  await prisma.phiVaultEntry.deleteMany({ where: { practiceId } })
  await prisma.insuranceClaim.deleteMany({ where: { practiceId } })
  await prisma.pmsImportRun.deleteMany({ where: { practiceId } })
  await prisma.user.deleteMany({ where: { practiceId } })
  await prisma.practice.deleteMany({ where: { id: practiceId } })
  await prisma.platformUser.deleteMany({ where: { id: { in: platformIdentities.map((identity) => identity.id) } } })
}

async function waitForVaultRows(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const count = await prisma.phiVaultEntry.count({ where: { practiceId } })
    if (count === expected) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`expected ${expected} persisted PHI vault rows`)
}

describe.skipIf(!dbReady)('validation lab synthetic factory through the real import pipeline', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.practice.create({
      data: {
        id: practiceId,
        name: bundle.practice.name,
        timezone: bundle.practice.timezone,
        passwordHash: 'synthetic-test-password-hash',
        billingPhone: bundle.practice.billingPhone,
        faxNumber: bundle.practice.faxNumber,
        practiceAddress: bundle.practice.practiceAddress,
        npi: bundle.practice.registrationNumber,
      },
    })
    await prisma.user.createMany({
      data: practiceIdentities.map((identity) => ({
        id: identity.id,
        practiceId,
        email: identity.email,
        passwordHash: 'synthetic-test-password-hash',
        role: identity.role as PracticeRole,
        displayName: `Synthetic ${identity.role}`,
      })),
    })
    await prisma.platformUser.createMany({
      data: platformIdentities.map((identity) => ({
        id: identity.id,
        email: identity.email,
        passwordHash: 'synthetic-test-password-hash',
        userRole: identity.role,
        practiceId: identity.role === 'auditor' ? practiceId : null,
      })),
    })
    piiVault.useStore(prisma)
  }, 30_000)

  afterAll(async () => {
    for (const token of issuedTokens) piiVault.expireToken(token, 'validation-lab-cleanup')
    await cleanup()
    await prisma.$disconnect().catch(() => undefined)
    if (previousPhiKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
    else process.env.PHI_ENCRYPTION_KEY = previousPhiKey
  })

  it('creates the fictional practice and all database-backed personas', async () => {
    expect(await prisma.practice.findUnique({ where: { id: practiceId } })).toMatchObject({
      name: bundle.practice.name,
      timezone: 'America/Toronto',
    })
    expect(await prisma.user.count({ where: { practiceId } })).toBe(7)
    expect(await prisma.platformUser.count({ where: { id: { in: platformIdentities.map((identity) => identity.id) } } })).toBe(3)
  })

  it('imports the clean synthetic CSV, encrypts PHI, and creates the eligible queue', async () => {
    const result = await runPmsImportPipeline(prisma, {
      practiceId,
      pmsSource: 'other',
      rows: parseSimpleCsv(bundle.csv.clean),
    })

    expect(result).toMatchObject({ status: 'success', validationPassed: true, imported: 8, skipped: 0, failed: 0 })
    const claims = await prisma.insuranceClaim.findMany({ where: { practiceId }, orderBy: { claimNumber: 'asc' } })
    expect(claims).toHaveLength(8)
    expect(await prisma.callQueue.count({ where: { practiceId } })).toBe(8)
    expect(await prisma.workItem.count({ where: { practiceId, itemType: 'insurance', status: 'open' } })).toBe(8)
    issuedTokens.push(...claims.map((claim) => claim.patientToken))

    await waitForVaultRows(8)
    const vaultRows = await prisma.phiVaultEntry.findMany({ where: { practiceId } })
    expect(vaultRows).toHaveLength(8)
    for (const row of vaultRows) {
      expect(row.ciphertext).toMatch(/^[0-9a-f]+$/u)
      expect(row.iv).toMatch(/^[0-9a-f]{24}$/u)
      expect(row.authTag).toMatch(/^[0-9a-f]{32}$/u)
      for (const record of bundle.cleanRecords) {
        expect(row.ciphertext).not.toContain(record.claim.patient_first_name)
        expect(row.ciphertext).not.toContain(record.claim.patient_last_name)
        expect(row.ciphertext).not.toContain(record.claim.patient_dob)
        expect(row.ciphertext).not.toContain(record.claim.subscriber_id)
      }
    }

    const firstRecord = bundle.cleanRecords[0]
    expect(firstRecord).toBeDefined()
    const firstClaim = await prisma.insuranceClaim.findUniqueOrThrow({
      where: { practiceId_claimNumber: { practiceId, claimNumber: firstRecord!.claim.claim_number } },
    })
    expect(firstClaim.patientToken).not.toContain(firstRecord!.claim.subscriber_id)
    expect(piiVault.detokenize(firstClaim.patientToken, 'validation-lab', { practiceId })).toEqual({
      success: true,
      phi: {
        patientName: `${firstRecord!.claim.patient_first_name} ${firstRecord!.claim.patient_last_name}`,
        dateOfBirth: firstRecord!.claim.patient_dob,
        subscriberId: firstRecord!.claim.subscriber_id,
        groupPolicyNumber: firstRecord!.claim.group_policy_number,
      },
    })
    expect(piiVault.detokenize(firstClaim.patientToken, 'validation-lab-wrong-tenant', { practiceId: 'different-practice' })).toEqual({
      success: false,
      error: 'PRACTICE_MISMATCH',
    })
  }, 30_000)

  it('imports the messy synthetic CSV, creates gates, and keeps the blocking claim out of the queue', async () => {
    const result = await runPmsImportPipeline(prisma, {
      practiceId,
      pmsSource: 'other',
      rows: parseSimpleCsv(bundle.csv.messy),
    })
    expect(result).toMatchObject({ status: 'success', validationPassed: true, imported: 8, skipped: 0, failed: 0 })

    const allClaims = await prisma.insuranceClaim.findMany({ where: { practiceId } })
    expect(allClaims).toHaveLength(16)
    issuedTokens.push(...allClaims.map((claim) => claim.patientToken).filter((token) => !issuedTokens.includes(token)))
    await waitForVaultRows(16)

    const blockingRecord = bundle.messyRecords[0]
    expect(blockingRecord).toBeDefined()
    const blockingClaim = await prisma.insuranceClaim.findUniqueOrThrow({
      where: { practiceId_claimNumber: { practiceId, claimNumber: blockingRecord!.claim.claim_number } },
    })
    expect(await prisma.claimRecoveryAction.findFirst({
      where: { claimId: blockingClaim.id, actionType: 'SUBMISSION_QUALITY', status: 'BLOCKING' },
    })).toMatchObject({ title: 'Submission readiness defects' })
    expect(await prisma.callQueue.findUnique({ where: { claimId: blockingClaim.id } })).toBeNull()

    expect(await prisma.callQueue.count({ where: { practiceId } })).toBe(15)
    expect(await prisma.claimRecoveryAction.count({
      where: { practiceId, actionType: 'SUBMISSION_QUALITY', status: { in: ['OPEN', 'BLOCKING'] } },
    })).toBe(4)
  }, 30_000)
})

afterAll(async () => {
  if (!dbReady) {
    await prisma.$disconnect().catch(() => undefined)
    if (previousPhiKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
    else process.env.PHI_ENCRYPTION_KEY = previousPhiKey
  }
})
