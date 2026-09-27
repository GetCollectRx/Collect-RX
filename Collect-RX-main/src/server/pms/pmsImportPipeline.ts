import type { PrismaClient } from '@prisma/client';
import type { PmsVendorId } from '../../types/pms.js';
import { importPmsClaimsToPrisma } from './prismaClaimImporter.js';
import { validateImportTotals } from './importValidation.js';
import {
  syncEligibleCallQueueForPractice,
  syncWorkItemsForPractice,
} from '../services/workQueueService.js';
import { checkAbeldentEdiVersion } from './abeldentEdiVersionGuard.js';
import { ensurePracticePmsVendor, resolvePmsImport } from './practicePmsContext.js';
import { PMS_VENDOR_PROFILES } from './pmsRegistry.js';
import { logger } from '../observability/logger.js';
import { normalizePmsClaimRow } from './parseExportRows.js';
import { mapToCarrierId } from './carrierMap.js';

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

function preflightImportRows(
  rows: Record<string, unknown>[],
  importFamily: Parameters<typeof normalizePmsClaimRow>[1],
): { claimNumber?: string; error: string }[] {
  const errors: { claimNumber?: string; error: string }[] = [];
  for (const raw of rows) {
    try {
      const row = normalizePmsClaimRow(raw, importFamily);
      if (!mapToCarrierId(row.carrierName)) {
        errors.push({
          claimNumber: row.claimNumber,
          error:
            `Unrecognized insurance carrier ${row.carrierName ? `"${row.carrierName}"` : '(blank)'} — ` +
            'claim not imported. Supported: Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare.',
        });
      }
    } catch (err) {
      errors.push({ error: (err as Error).message });
    }
  }
  return errors;
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
      logger.warn('[PmsImportPipeline] AbelDent EDI migration required', {
        practiceId: options.practiceId,
        message: ediGuardResult.message,
      });
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
    // Validate the entire file before the first claim, work item, or call-queue
    // row is written. A malformed mixed file must not partially enter the live
    // recovery workflow.
    const preflightErrors = preflightImportRows(options.rows, importFamily);
    if (preflightErrors.length > 0) {
      await prisma.pmsImportRun.update({
        where: { id: run.id },
        data: {
          status: 'validation_failed',
          completedAt: new Date(),
          recordsImported: 0,
          recordsSkipped: 0,
          recordsFailed: preflightErrors.length,
          validationPassed: false,
          errorLog: { rowErrors: preflightErrors.slice(0, 50) },
        },
      });
      return {
        runId: run.id,
        pmsVendor: vendorId,
        status: 'validation_failed',
        validationPassed: false,
        imported: 0,
        skipped: 0,
        failed: preflightErrors.length,
        driftPct: null,
        errors: preflightErrors,
        paymentsVerified: 0,
        dollarsRecoveredSyncVerified: 0,
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      // The import helpers use only model operations available on a transaction
      // client. Keep the cast local so every workflow write shares this commit.
      const transactionalPrisma = tx as unknown as PrismaClient;
      const importResult = await importPmsClaimsToPrisma(
        transactionalPrisma,
        options.rows,
        options.practiceId,
        importFamily,
      );

      const validation = validateImportTotals({
        sourceRecordCount: options.sourceRecordCount ?? options.rows.length,
        importedRecordCount: importResult.imported + importResult.skipped,
        sourceBalanceTotal: options.sourceBalanceTotal ?? importResult.importedBalanceTotal,
        importedBalanceTotal: importResult.importedBalanceTotal,
      });

      if (!validation.passed || importResult.failed > 0) {
        throw new Error(
          `Import validation failed: ${[
            ...validation.messages,
            ...importResult.errors.map((entry) => entry.error),
          ].join('; ')}`,
        );
      }

      await syncWorkItemsForPractice(transactionalPrisma, options.practiceId);
      await syncEligibleCallQueueForPractice(transactionalPrisma, options.practiceId);
      if (importResult.imported > 0 || importResult.skipped > 0) {
        await ensurePracticePmsVendor(transactionalPrisma, options.practiceId, vendorId);
      }
      await transactionalPrisma.pmsImportRun.update({
        where: { id: run.id },
        data: {
          status: 'success',
          completedAt: new Date(),
          recordsImported: importResult.imported,
          recordsSkipped: importResult.skipped,
          recordsFailed: 0,
          importedBalanceTotal: importResult.importedBalanceTotal,
          driftPct: validation.driftPct,
          validationPassed: true,
          errorLog: { validationMessages: [], rowErrors: [] },
        },
      });
      return { importResult, validation };
    });

    return {
      runId: run.id,
      pmsVendor: vendorId,
      status: 'success',
      validationPassed: true,
      imported: result.importResult.imported,
      skipped: result.importResult.skipped,
      failed: 0,
      driftPct: result.validation.driftPct,
      errors: [],
      paymentsVerified: result.importResult.paymentsVerified,
      dollarsRecoveredSyncVerified: result.importResult.dollarsRecoveredSyncVerified,
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
