import type { PrismaClient } from '@prisma/client';
import { importPmsClaimsToPrisma } from './prismaClaimImporter.js';
import { validateImportTotals } from './importValidation.js';
import { syncWorkItemsForPractice } from '../services/workQueueService.js';

export type PmsSource = 'dentrix' | 'abeldent';

export interface RunPmsImportOptions {
  practiceId: string;
  pmsSource: PmsSource;
  rows: Record<string, unknown>[];
  /** Expected totals from export file header/summary (optional). */
  sourceRecordCount?: number;
  sourceBalanceTotal?: number;
}

export interface RunPmsImportResult {
  runId: string;
  status: string;
  validationPassed: boolean;
  imported: number;
  skipped: number;
  failed: number;
  driftPct: number | null;
  errors: { claimNumber?: string; error: string }[];
}

export async function runPmsImportPipeline(
  prisma: PrismaClient,
  options: RunPmsImportOptions,
): Promise<RunPmsImportResult> {
  const run = await prisma.pmsImportRun.create({
    data: {
      practiceId: options.practiceId,
      pmsSource: options.pmsSource,
      status: 'running',
      recordsTotal: options.rows.length,
      sourceRecordCount: options.sourceRecordCount ?? options.rows.length,
      sourceBalanceTotal: options.sourceBalanceTotal,
    },
  });

  try {
    const importResult = await importPmsClaimsToPrisma(
      prisma,
      options.rows,
      options.practiceId,
      options.pmsSource,
    );

    const validation = validateImportTotals({
      sourceRecordCount: options.sourceRecordCount ?? options.rows.length,
      importedRecordCount: importResult.imported,
      sourceBalanceTotal: options.sourceBalanceTotal ?? importResult.importedBalanceTotal,
      importedBalanceTotal: importResult.importedBalanceTotal,
    });

    const status = validation.passed
      ? importResult.failed > 0
        ? 'partial'
        : 'success'
      : 'validation_failed';

    await prisma.pmsImportRun.update({
      where: { id: run.id },
      data: {
        status,
        completedAt: new Date(),
        recordsImported: importResult.imported,
        recordsSkipped: importResult.skipped,
        recordsFailed: importResult.failed,
        importedBalanceTotal: importResult.importedBalanceTotal,
        driftPct: validation.driftPct,
        validationPassed: validation.passed,
        errorLog: {
          validationMessages: validation.messages,
          rowErrors: importResult.errors.slice(0, 50),
        },
      },
    });

    await syncWorkItemsForPractice(prisma, options.practiceId);

    return {
      runId: run.id,
      status,
      validationPassed: validation.passed,
      imported: importResult.imported,
      skipped: importResult.skipped,
      failed: importResult.failed,
      driftPct: validation.driftPct,
      errors: importResult.errors,
    };
  } catch (err) {
    await prisma.pmsImportRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        validationPassed: false,
        errorLog: { fatal: (err as Error).message },
      },
    });
    throw err;
  }
}
