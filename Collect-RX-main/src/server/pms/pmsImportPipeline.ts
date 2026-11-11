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
import { claimIdOf, normalizePmsClaimRow, type NormalizedPmsClaimRow } from './parseExportRows.js';
import { mapToCarrierId } from './carrierMap.js';
import { mergeClaimRows } from './claimRowMerge.js';
import { closeClaimsMissingFromFullExport, type AbsentClaimResult } from './absentClaimHandler.js';

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
  /**
   * 'full' means the file is the practice's complete open insurance AR, so a
   * claim missing from it is presumed resolved in the PMS and is not called.
   * Defaults to 'partial', which never closes claims.
   */
  exportScope?: ExportScope;
}

export type ExportScope = 'full' | 'partial';

export type ImportRowError = {
  claimNumber?: string;
  /** 1-based position among the file's data rows, header excluded. */
  dataRow?: number;
  error: string;
};

export interface RunPmsImportResult {
  runId: string;
  pmsVendor: PmsVendorId;
  status: string;
  validationPassed: boolean;
  imported: number;
  skipped: number;
  failed: number;
  driftPct: number | null;
  errors: ImportRowError[];
  /** Rows held back so the rest of the file could import. Empty on a clean file. */
  quarantined: ImportRowError[];
  /** Fully blank rows (for example trailing rows from a spreadsheet) that were ignored, not errors. */
  blankRowsIgnored: number;
  paymentsVerified: number;
  dollarsRecoveredSyncVerified: number;
  /** Claims closed because a full export no longer lists them. */
  claimsClosedAsMissing: number;
  /** Set when the mass-absence guardrail held closures for staff review. */
  missingClaimsWarning: string | null;
  /** Set when Abeldent EDI version check detects legacy CDAnet v2 or ITRANS 1.x */
  ediMigrationRequired?: boolean;
  ediVersionStatus?: string;
  ediVersionMessage?: string;
}

interface PreflightResult {
  goodRows: Record<string, unknown>[];
  quarantined: ImportRowError[];
  blankRowsIgnored: number;
}

function isBlankRow(raw: Record<string, unknown>): boolean {
  return Object.values(raw).every((v) => v === undefined || v === null || String(v).trim() === '');
}

/**
 * Splits the file into rows that can import and rows held back with a reason.
 * Quarantine works per claim, not per row: a line-level export carries several
 * rows for one claim, and importing only some of them would store wrong totals.
 */
function preflightImportRows(
  rows: Record<string, unknown>[],
  importFamily: Parameters<typeof normalizePmsClaimRow>[1],
): PreflightResult {
  interface Entry {
    raw: Record<string, unknown>;
    dataRow: number;
    norm?: NormalizedPmsClaimRow;
    claimNumber?: string;
    error?: string;
  }
  const entries: Entry[] = [];
  let blankRowsIgnored = 0;
  rows.forEach((raw, i) => {
    if (isBlankRow(raw)) {
      blankRowsIgnored += 1;
      return;
    }
    const entry: Entry = { raw, dataRow: i + 1 };
    try {
      entry.norm = normalizePmsClaimRow(raw, importFamily);
      entry.claimNumber = entry.norm.claimNumber;
      if (!mapToCarrierId(entry.norm.carrierName)) {
        entry.error =
          `Unrecognized insurance carrier ${entry.norm.carrierName ? `"${entry.norm.carrierName}"` : '(blank)'} — ` +
          'claim not imported. Supported: Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare.';
      }
    } catch (err) {
      entry.error = (err as Error).message;
      entry.claimNumber = claimIdOf(raw, importFamily) ?? undefined;
    }
    entries.push(entry);
  });

  const badClaims = new Map<string, string>();
  for (const e of entries) {
    if (e.error && e.claimNumber) badClaims.set(e.claimNumber, e.error);
  }
  const clean = entries.flatMap((e) => (e.norm && !e.error ? [e.norm] : []));
  for (const conflict of mergeClaimRows(clean).conflicts) {
    badClaims.set(conflict.claimNumber, conflict.error);
  }

  const goodRows: Record<string, unknown>[] = [];
  const quarantined: ImportRowError[] = [];
  for (const e of entries) {
    if (e.error) {
      quarantined.push({ claimNumber: e.claimNumber, dataRow: e.dataRow, error: e.error });
    } else if (e.claimNumber && badClaims.has(e.claimNumber)) {
      quarantined.push({
        claimNumber: e.claimNumber,
        dataRow: e.dataRow,
        error: `${badClaims.get(e.claimNumber) ?? 'Another row for this claim was rejected.'} The whole claim was held back so its totals stay correct.`,
      });
    } else {
      goodRows.push(e.raw);
    }
  }
  return { goodRows, quarantined, blankRowsIgnored };
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
    // Validate every row before the first claim, work item, or call-queue row
    // is written. Bad claims are quarantined with a reason and the rest of the
    // file imports; a file with nothing importable is rejected whole.
    const preflight = preflightImportRows(options.rows, importFamily);
    const preflightErrors = preflight.quarantined;
    const importableRows = preflight.goodRows;
    if (importableRows.length === 0 && preflightErrors.length > 0) {
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
        quarantined: preflightErrors,
        blankRowsIgnored: preflight.blankRowsIgnored,
        paymentsVerified: 0,
        dollarsRecoveredSyncVerified: 0,
        claimsClosedAsMissing: 0,
        missingClaimsWarning: null,
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      // The import helpers use only model operations available on a transaction
      // client. Keep the cast local so every workflow write shares this commit.
      const transactionalPrisma = tx as unknown as PrismaClient;
      const importResult = await importPmsClaimsToPrisma(
        transactionalPrisma,
        importableRows,
        options.practiceId,
        importFamily,
      );

      // The declared totals describe the whole file. With rows held back they cannot
      // reconcile, so the record count is reduced by the held and blank rows and the balance
      // check falls back to comparing the import with itself. The held rows are
      // reported to the caller instead.
      const heldBack = preflightErrors.length;
      const validation = validateImportTotals({
        sourceRecordCount:
          options.sourceRecordCount === undefined
            ? importableRows.length
            : Math.max(0, options.sourceRecordCount - heldBack - preflight.blankRowsIgnored),
        importedRecordCount: importResult.sourceRowsAccounted,
        sourceBalanceTotal:
          heldBack > 0 ? importResult.importedBalanceTotal : (options.sourceBalanceTotal ?? importResult.importedBalanceTotal),
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

      let absent: AbsentClaimResult = { closed: 0, held: 0, warning: null };
      if (options.exportScope === 'full' && heldBack > 0) {
        // A held-back claim looks absent from the file. Closing claims as resolved
        // on that basis would hide them, so closure waits for a clean export.
        absent = {
          closed: 0,
          held: 0,
          warning: `${heldBack} row(s) were held back, so claims missing from this file were not closed. Fix those rows and re-import.`,
        };
      } else if (options.exportScope === 'full') {
        const claimNumbersInFile = new Set<string>();
        for (const raw of importableRows) {
          claimNumbersInFile.add(normalizePmsClaimRow(raw, importFamily).claimNumber);
        }
        absent = await closeClaimsMissingFromFullExport(
          transactionalPrisma,
          options.practiceId,
          claimNumbersInFile,
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
          status: heldBack > 0 ? 'success_with_quarantine' : 'success',
          completedAt: new Date(),
          recordsImported: importResult.imported,
          recordsSkipped: importResult.skipped,
          recordsFailed: heldBack,
          importedBalanceTotal: importResult.importedBalanceTotal,
          driftPct: validation.driftPct,
          validationPassed: true,
          errorLog: { validationMessages: [], rowErrors: preflightErrors.slice(0, 50) },
        },
      });
      return { importResult, validation, absent };
    });

    return {
      runId: run.id,
      pmsVendor: vendorId,
      status: preflightErrors.length > 0 ? 'success_with_quarantine' : 'success',
      validationPassed: true,
      imported: result.importResult.imported,
      skipped: result.importResult.skipped,
      failed: preflightErrors.length,
      driftPct: result.validation.driftPct,
      errors: preflightErrors,
      quarantined: preflightErrors,
      blankRowsIgnored: preflight.blankRowsIgnored,
      paymentsVerified: result.importResult.paymentsVerified,
      dollarsRecoveredSyncVerified: result.importResult.dollarsRecoveredSyncVerified,
      claimsClosedAsMissing: result.absent.closed,
      missingClaimsWarning: result.absent.warning,
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
