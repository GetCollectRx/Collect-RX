import { beforeEach, describe, expect, it, vi } from 'vitest';

const { importClaims, syncWorkItems, syncCallQueue, ensureVendor, closeMissing } = vi.hoisted(() => ({
  importClaims: vi.fn(),
  syncWorkItems: vi.fn(),
  syncCallQueue: vi.fn(),
  ensureVendor: vi.fn(),
  closeMissing: vi.fn(),
}));

vi.mock('../src/server/pms/absentClaimHandler.js', () => ({
  closeClaimsMissingFromFullExport: closeMissing,
}));

vi.mock('../src/server/pms/prismaClaimImporter.js', () => ({
  importPmsClaimsToPrisma: importClaims,
}));
vi.mock('../src/server/services/workQueueService.js', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../src/server/services/workQueueService.js')>();
  return {
    ...original,
    syncWorkItemsForPractice: syncWorkItems,
    syncEligibleCallQueueForPractice: syncCallQueue,
  };
});
vi.mock('../src/server/frontDesk/dispatchDecision.js', () => ({
  resolveDispatchMode: vi.fn().mockResolvedValue({ humanAssisted: true, squadId: 'human-assisted-squad' }),
}));
vi.mock('../src/server/pms/practicePmsContext.js', () => ({
  resolvePmsImport: vi.fn().mockResolvedValue({ vendorId: 'other', importFamily: 'generic' }),
  ensurePracticePmsVendor: ensureVendor,
}));

import { runPmsImportPipeline } from '../src/server/pms/pmsImportPipeline.js';

const validRow = {
  claim_number: 'CLM-100',
  patient_first_name: 'Jane',
  patient_last_name: 'Doe',
  carrier_name: 'Sun Life',
  amount_billed: '125.00',
  amount_outstanding: '125.00',
  days_outstanding: '45',
};

describe('CSV-to-call queue remediation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importClaims.mockResolvedValue({
      imported: 1,
      skipped: 0,
      failed: 0,
      errors: [],
      importedBalanceTotal: 125,
      sourceRowsAccounted: 1,
      paymentsVerified: 0,
      dollarsRecoveredSyncVerified: 0,
    });
    syncWorkItems.mockResolvedValue({ upserted: 1 });
    syncCallQueue.mockResolvedValue({ created: 1 });
    ensureVendor.mockResolvedValue(undefined);
    closeMissing.mockResolvedValue({ closed: 2, held: 0, warning: null });
  });

  function transactionalPrisma() {
    const tx = { pmsImportRun: { update: vi.fn().mockResolvedValue({}) } };
    return {
      pmsImportRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-3' }),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
  }

  it('never closes missing claims unless the file is marked as the full open AR', async () => {
    const result = await runPmsImportPipeline(transactionalPrisma() as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow],
    });
    expect(closeMissing).not.toHaveBeenCalled();
    expect(result.claimsClosedAsMissing).toBe(0);
  });

  it('closes claims missing from a full export, using every claim number in the file', async () => {
    const result = await runPmsImportPipeline(transactionalPrisma() as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow],
      exportScope: 'full',
    });
    expect(closeMissing).toHaveBeenCalledWith(expect.anything(), 'practice-1', new Set(['CLM-100']));
    expect(result.claimsClosedAsMissing).toBe(2);
  });

  it('rejects a file whose rows for one claim name different carriers before writing anything', async () => {
    const prisma = transactionalPrisma();
    const result = await runPmsImportPipeline(prisma as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow, { ...validRow, carrier_name: 'Manulife' }],
    });
    expect(result.status).toBe('validation_failed');
    expect(result.errors[0]).toMatchObject({ claimNumber: 'CLM-100' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('commits claim, work-item, and eligible call-queue synchronization in one transaction', async () => {
    const tx = { pmsImportRun: { update: vi.fn().mockResolvedValue({}) } };
    const prisma = {
      pmsImportRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };

    const result = await runPmsImportPipeline(prisma as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow],
    });

    expect(result.status).toBe('success');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(importClaims).toHaveBeenCalledWith(tx, [validRow], 'practice-1', 'generic', { defaultPayerType: undefined });
    expect(syncWorkItems).toHaveBeenCalledWith(tx, 'practice-1');
    expect(syncCallQueue).toHaveBeenCalledWith(tx, 'practice-1');
    expect(ensureVendor).toHaveBeenCalledWith(tx, 'practice-1', 'other');
    expect(tx.pmsImportRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'success', validationPassed: true }),
    }));
  });

  it('rejects a mixed invalid file before starting a write transaction', async () => {
    const prisma = {
      pmsImportRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-2' }),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(),
    };

    const result = await runPmsImportPipeline(prisma as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow, { ...validRow, claim_number: 'CLM-INVALID', amount_outstanding: 'not-money' }],
    });

    expect(result.status).toBe('validation_failed');
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(importClaims).not.toHaveBeenCalled();
    expect(syncWorkItems).not.toHaveBeenCalled();
    expect(syncCallQueue).not.toHaveBeenCalled();
  });

  it('creates only missing eligible queue rows and never resets an existing row', async () => {
    const { syncEligibleCallQueueForPractice } = await vi.importActual<
      typeof import('../src/server/services/workQueueService.js')
    >('../src/server/services/workQueueService.js');
    const createMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = {
      insuranceClaim: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'claim-1', priority: 'HIGH' },
          { id: 'claim-2', priority: 'NORMAL' },
        ]),
        count: vi.fn().mockResolvedValue(0),
      },
      callQueue: { createMany },
    };

    const result = await syncEligibleCallQueueForPractice(prisma as never, 'practice-1');

    expect(result).toEqual({ created: 1, excludedByPayerProgram: 0 });
    expect(prisma.insuranceClaim.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        practiceId: 'practice-1',
        status: 'PENDING',
        daysOutstanding: { gte: 30 },
        queueEntry: null,
      }),
      select: { id: true, priority: true },
    });
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('queues only enabled payer programs, plus unclassified claims treated as PRIVATE (DEC-10)', async () => {
    const { syncEligibleCallQueueForPractice } = await vi.importActual<
      typeof import('../src/server/services/workQueueService.js')
    >('../src/server/services/workQueueService.js');
    const prisma = {
      insuranceClaim: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(3),
      },
      callQueue: { createMany: vi.fn() },
    };

    const result = await syncEligibleCallQueueForPractice(prisma as never, 'practice-1');

    expect(prisma.insuranceClaim.findMany.mock.calls[0][0].where.OR).toEqual([
      { payerType: null },
      { payerType: { in: ['PRIVATE'] } },
    ]);
    expect(prisma.insuranceClaim.count.mock.calls[0][0].where.payerType).toEqual({
      notIn: ['PRIVATE'],
      not: null,
    });
    expect(result).toEqual({ created: 0, excludedByPayerProgram: 3 });
  });

  it('keeps the 90 day ceiling in autonomous mode only (DEC-2)', async () => {
    const { resolveDispatchMode } = await import('../src/server/frontDesk/dispatchDecision.js');
    vi.mocked(resolveDispatchMode).mockResolvedValueOnce({ humanAssisted: false, squadId: undefined });
    const { syncEligibleCallQueueForPractice } = await vi.importActual<
      typeof import('../src/server/services/workQueueService.js')
    >('../src/server/services/workQueueService.js');
    const prisma = {
      insuranceClaim: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      callQueue: { createMany: vi.fn() },
    };

    await syncEligibleCallQueueForPractice(prisma as never, 'practice-1');

    expect(prisma.insuranceClaim.findMany.mock.calls[0][0].where.daysOutstanding).toEqual({ gte: 30, lte: 90 });
  });
});
