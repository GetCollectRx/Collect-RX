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
    expect(importClaims).toHaveBeenCalledWith(tx, [validRow], 'practice-1', 'generic');
    expect(syncWorkItems).toHaveBeenCalledWith(tx, 'practice-1');
    expect(syncCallQueue).toHaveBeenCalledWith(tx, 'practice-1');
    expect(ensureVendor).toHaveBeenCalledWith(tx, 'practice-1', 'other');
    expect(tx.pmsImportRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'success', validationPassed: true }),
    }));
  });

  it('quarantines a bad claim, imports the rest in one transaction, and says why', async () => {
    const prisma = transactionalPrisma();
    const bad = { ...validRow, claim_number: 'CLM-INVALID', amount_outstanding: 'not-money' };

    const result = await runPmsImportPipeline(prisma as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow, bad],
    });

    expect(result.status).toBe('success_with_quarantine');
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.quarantined).toEqual([expect.objectContaining({ claimNumber: 'CLM-INVALID', dataRow: 2 })]);
    expect(result.quarantined[0]?.error).toMatch(/not a valid number/u);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(importClaims).toHaveBeenCalledWith(expect.anything(), [validRow], 'practice-1', 'generic');
  });

  it('holds back every row of a claim when one of its rows is bad, so totals never come from half a claim', async () => {
    const prisma = transactionalPrisma();
    const lineA = { ...validRow, claim_number: 'CLM-LINES' };
    const lineB = { ...validRow, claim_number: 'CLM-LINES', amount_outstanding: 'abc' };

    const result = await runPmsImportPipeline(prisma as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow, lineA, lineB],
    });

    expect(result.quarantined.map((q) => q.dataRow)).toEqual([2, 3]);
    expect(result.quarantined[0]?.error).toMatch(/whole claim was held back/u);
    expect(importClaims).toHaveBeenCalledWith(expect.anything(), [validRow], 'practice-1', 'generic');
  });

  it('ignores fully blank trailing rows without calling them errors', async () => {
    const blank = { claim_number: '', patient_first_name: '', carrier_name: ' ', amount_outstanding: '' };
    const result = await runPmsImportPipeline(transactionalPrisma() as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow, blank, blank, blank],
    });
    expect(result.status).toBe('success');
    expect(result.blankRowsIgnored).toBe(3);
    expect(result.quarantined).toEqual([]);
  });

  it('quarantines unsupported carriers, blank carriers, missing claim numbers and a totals row, and imports the good rows', async () => {
    const rows = [
      validRow,
      { ...validRow, claim_number: 'CLM-ODD', carrier_name: 'Desjardins Dental Plan' },
      { ...validRow, claim_number: 'CLM-BLANK', carrier_name: '' },
      { ...validRow, claim_number: '' },
      { claim_number: 'TOTAL', patient_first_name: '', patient_last_name: '', carrier_name: '', amount_billed: '48210.00', amount_outstanding: '19234.50' },
    ];
    const result = await runPmsImportPipeline(transactionalPrisma() as never, { practiceId: 'practice-1', pmsSource: 'other', rows });
    expect(result.status).toBe('success_with_quarantine');
    expect(result.quarantined.map((q) => q.dataRow)).toEqual([2, 3, 4, 5]);
    expect(importClaims).toHaveBeenCalledWith(expect.anything(), [validRow], 'practice-1', 'generic');
  });

  it('rejects the whole file only when nothing in it can import', async () => {
    const prisma = transactionalPrisma();
    const result = await runPmsImportPipeline(prisma as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [{ ...validRow, carrier_name: 'Desjardins Dental Plan' }],
    });
    expect(result.status).toBe('validation_failed');
    expect(result.imported).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(importClaims).not.toHaveBeenCalled();
  });

  it('does not close claims missing from a full export when rows were held back, because they would look absent', async () => {
    const result = await runPmsImportPipeline(transactionalPrisma() as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow, { ...validRow, claim_number: 'CLM-BAD', amount_outstanding: 'x' }],
      exportScope: 'full',
    });
    expect(closeMissing).not.toHaveBeenCalled();
    expect(result.claimsClosedAsMissing).toBe(0);
    expect(result.missingClaimsWarning).toMatch(/held back/u);
  });

  it('reconciles a declared record count that includes blank and held rows', async () => {
    const blank = { claim_number: '', carrier_name: '', amount_outstanding: '' };
    const result = await runPmsImportPipeline(transactionalPrisma() as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow, { ...validRow, claim_number: 'CLM-BAD', amount_outstanding: 'x' }, blank, blank],
      sourceRecordCount: 4,
    });
    expect(result.validationPassed).toBe(true);
    expect(result.blankRowsIgnored).toBe(2);
  });

  it('reconciles declared record counts after rows are held back', async () => {
    const result = await runPmsImportPipeline(transactionalPrisma() as never, {
      practiceId: 'practice-1',
      pmsSource: 'other',
      rows: [validRow, { ...validRow, claim_number: 'CLM-BAD', amount_outstanding: 'x' }],
      sourceRecordCount: 2,
    });
    expect(result.status).toBe('success_with_quarantine');
    expect(result.validationPassed).toBe(true);
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
