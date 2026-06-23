import type { PrismaClient } from '@prisma/client';
import type { PmsVendorId } from '../../types/pms.js';
import { importPmsClaimsToPrisma } from './prismaClaimImporter.js';
import { validateImportTotals } from './importValidation.js';
import { syncWorkItemsForPractice } from '../services/workQueueService.js';
import { checkAbeldentEdiVersion } from './abeldentEdiVersionGuard.js';
import { ensurePracticePmsVendor, resolvePmsImport } from './practicePmsContext.js';
import { PMS_VENDOR_PROFILES } from './pmsRegistry.js';

/** @deprecated Use PmsVendorId — kept for callers passing legacy slugs. */
export type PmsSource = PmsVendorId;

export interface RunPmsImportOptions {
  practiceId: string;
  /** Canonical vendor id or legacy slug; resolved via practicePmsContext when omitted. */
  pmsSource?: string | null;
  rows: Record<string, unknown>[];
  /** Expected totals from export file header/summary (optional). */
  sourceRecordCount?: number;
  sourceBalanceTotal?: number;
}

export interface RunPmsImportResult {
  runId: string;
  pmsVendor: PmsVendorId;
  status: string;
  validationPassed: boolean;
  imported: number;
  skipped: number;
  failed: number;
  driftPct: number | null;
  errors: { claimNumber?: string; error: string }[];
  paymentsVerified: number;
  dollarsRecoveredSyncVerified: number;
  /** Set when Abeldent EDI version check detects legacy CDAnet v2 or ITRANS 1.x */
  ediMigrationRequired?: boolean;
  ediVersionStatus?: string;
  ediVersionMessage?: string;
}

export async function runPmsImportPipeline(
  prisma: PrismaClient,
  options: RunPmsImportOptions,
): Promise<RunPmsImportResult> {
  const resolved = await resolvePmsImport(prisma, options.practiceId, options.pmsSource);
  const { vendorId, importFamily } = resolved;
  const profile = PMS_VENDOR_PROFILES[vendorId];

  // ── AbelDent EDI version guard (import-only; does not affect phone routing) ─
  let ediGuardResult: ReturnType<typeof checkAbeldentEdiVersion> | null = null;
  if (profile.supportsEdiVersionGuard) {
    ediGuardResult = checkAbeldentEdiVersion(options.rows);
    if (ediGuardResult.migrationRequired) {
      console.warn(
        '[PmsImportPipeline] AbelDent EDI migration required for practice',
        options.practiceId,
        ediGuardResult.message,
      );
    }
  }

  const run = await prisma.pmsImportRun.create({
    data: {
      practiceId: options.practiceId,
      pmsSource: vendorId,
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
      importFamily,
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
    if (importResult.imported > 0 || importResult.skipped > 0) {
      await ensurePracticePmsVendor(prisma, options.practiceId, vendorId);
    }

    return {
      runId: run.id,
      pmsVendor: vendorId,
      status,
      validationPassed: validation.passed,
      imported: importResult.imported,
      skipped: importResult.skipped,
      failed: importResult.failed,
      driftPct: validation.driftPct,
      errors: importResult.errors,
      paymentsVerified: importResult.paymentsVerified,
      dollarsRecoveredSyncVerified: importResult.dollarsRecoveredSyncVerified,
      // EDI version guard results (Abeldent only)
      ...(ediGuardResult
        ? {
            ediMigrationRequired: ediGuardResult.migrationRequired,
            ediVersionStatus: ediGuardResult.status,
            ediVersionMessage: ediGuardResult.migrationRequired
              ? ediGuardResult.message
              : undefined,
          }
        : {}),
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
