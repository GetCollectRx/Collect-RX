import { beforeEach, describe, expect, it, vi } from 'vitest';

const { importClaims, syncWorkItems, syncCallQueue, ensureVendor } = vi.hoisted(() => ({
  importClaims: vi.fn(),
  syncWorkItems: vi.fn(),
  syncCallQueue: vi.fn(),
  ensureVendor: vi.fn(),
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
      paymentsVerified: 0,
      dollarsRecoveredSyncVerified: 0,
    });
    syncWorkItems.mockResolvedValue({ upserted: 1 });
    syncCallQueue.mockResolvedValue({ created: 1 });
    ensureVendor.mockResolvedValue(undefined);
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
    expect(importClaims).toHaveBeenCalledWith(tx, [validRow], 'practice-1', 'generic');
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
      },
      callQueue: { createMany },
    };

    const result = await syncEligibleCallQueueForPractice(prisma as never, 'practice-1');

    expect(result).toEqual({ created: 1 });
    expect(prisma.insuranceClaim.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        practiceId: 'practice-1',
        status: 'PENDING',
        daysOutstanding: { gte: 30, lte: 90 },
        queueEntry: null,
      }),
      select: { id: true, priority: true },
    });
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });
});
