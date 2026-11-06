/**
 * Non-dental claim import: parse CSV -> tokenize PHI -> upsert insurance_claims.
 *
 * Scope decisions (see the Phase 1/2 review):
 *  - Dashboard ingest only. Rows are NOT added to the call queue, and claims are
 *    saved with carrierId 'other', which the queue engine skips and the Vapi
 *    client refuses to dial until verified payer numbers and IVR configs exist.
 *  - Dental stays on /claims/import (PMS pipeline). This path rejects DENTAL.
 *  - Nothing person-linked is persisted raw. The insured name goes to PIIVault
 *    and its token becomes patientToken. VIN, policy number, patient id and MRN
 *    become vault tokens through toClaimPersistFields().
 *  - The whole file is written in one transaction. If anything fails, tokens
 *    minted for this upload are expired so no orphan PHI is left in the vault.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { PatientPHI } from '../../pii-vault.js';
import type { IndustryType, ReferenceKind } from '../../types/industry-claims';
import {
  parseIndustryCsv,
  toClaimPersistFields,
  type DateFormat,
  type RowIssue,
} from './csvParser';

export interface VaultLike {
  tokenize(phi: PatientPHI, callerContext: string, practiceId: string): string;
  expireToken(token: string, callerContext: string): void;
}

export interface ImportIndustryClaimsOptions {
  practiceId: string;
  industryType: IndustryType;
  csvText: string;
  /** Required. Slashed dates are never guessed for Canadian practices (03/04/2026 is March 4 or April 3). */
  dateFormat: DateFormat;
}

export interface ImportIndustryClaimsResult {
  industryType: IndustryType;
  totalRows: number;
  imported: number;
  updated: number;
  skippedZeroBalance: number;
  duplicateRowsInFile: number;
  conflicts: Array<{ claimNumber: string; error: string }>;
  rejected: RowIssue[];
  warnings: RowIssue[];
  dateAssumedRowCount: number;
  unmappedHeaders: string[];
}

export class ImportRejectedError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
    this.name = 'ImportRejectedError';
  }
}

const CALLER = 'industry-csv-import';
const DAY_MS = 86_400_000;

function referenceToPhi(_kind: ReferenceKind, raw: string): PatientPHI {
  // The vault stores PatientPHI objects; the reference value rides in subscriberId.
  return { patientName: '', dateOfBirth: '', subscriberId: raw, groupPolicyNumber: '' };
}

export async function importIndustryClaims(
  prisma: PrismaClient,
  vault: VaultLike,
  options: ImportIndustryClaimsOptions,
): Promise<ImportIndustryClaimsResult> {
  const { practiceId, industryType } = options;
  if (industryType === 'DENTAL') {
    throw new ImportRejectedError('Dental claims use POST /api/insurance/claims/import, not this endpoint');
  }

  if (options.dateFormat !== 'MDY' && options.dateFormat !== 'DMY' && options.dateFormat !== 'YMD') {
    throw new ImportRejectedError('dateFormat is required and must be MDY, DMY or YMD');
  }

  const parsed = parseIndustryCsv(options.csvText, { industryType, dateFormat: options.dateFormat });

  // Refuse to overwrite claims that belong to another vertical (for example a
  // dental claim sharing a claim number).
  const numbers = parsed.records.map((r) => r.claimNumber);
  const existing = numbers.length
    ? await prisma.insuranceClaim.findMany({
        where: { practiceId, claimNumber: { in: numbers } },
        select: { claimNumber: true, industryType: true, carrierId: true },
      })
    : [];
  const existingByNumber = new Map(existing.map((e) => [e.claimNumber, e]));
  const conflicts: ImportIndustryClaimsResult['conflicts'] = [];

  const minted: string[] = [];
  const mint = (phi: PatientPHI, ctx: string): string => {
    const token = vault.tokenize(phi, ctx, practiceId);
    minted.push(token);
    return token;
  };

  let imported = 0;
  let updated = 0;
  let skippedZeroBalance = 0;

  try {
    // Tokenize and build writes first (in memory), then commit in one transaction.
    const writes: Array<{ claimNumber: string; data: Prisma.InsuranceClaimUncheckedCreateInput; isUpdate: boolean }> = [];
    for (const rec of parsed.records) {
      const prior = existingByNumber.get(rec.claimNumber);
      if (prior && (prior.industryType !== industryType || prior.carrierId !== 'other')) {
        conflicts.push({
          claimNumber: rec.claimNumber,
          error: `Claim number already exists for this practice as a ${prior.industryType} claim`,
        });
        continue;
      }
      if (Number(rec.balanceDue) <= 0) {
        skippedZeroBalance++;
        continue;
      }

      const persist = toClaimPersistFields(rec, (kind, raw) =>
        mint(referenceToPhi(kind, raw), `${CALLER}:${kind}`),
      );
      const patientToken = mint(
        { patientName: rec.insuredName, dateOfBirth: '', subscriberId: '', groupPolicyNumber: '' },
        CALLER,
      );

      const servicedAt = new Date(`${rec.dateOfService}T00:00:00.000Z`);
      const daysOutstanding =
        rec.agingDays ?? Math.max(0, Math.floor((Date.now() - servicedAt.getTime()) / DAY_MS));

      writes.push({
        claimNumber: rec.claimNumber,
        isUpdate: Boolean(prior),
        data: {
          practiceId,
          claimNumber: rec.claimNumber,
          carrierId: 'other',
          patientToken,
          billedAmount: rec.billedAmount,
          outstandingAmount: rec.balanceDue,
          daysOutstanding,
          servicedAt,
          status: 'PENDING',
          priority: daysOutstanding > 90 ? 'URGENT' : daysOutstanding > 60 ? 'HIGH' : 'NORMAL',
          industryType: persist.industryType,
          primaryReferenceId: persist.primaryReferenceId,
          primaryReferenceKind: persist.primaryReferenceKind,
          secondaryReferenceId: persist.secondaryReferenceId,
          secondaryReferenceKind: persist.secondaryReferenceKind,
          payerName: persist.payerName,
          lineItems: (persist.lineItems ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    }

    if (conflicts.length > 0) {
      throw new ImportRejectedError(
        `Import blocked: ${conflicts.length} claim number(s) already exist under a different vertical. Nothing was imported.`,
        409,
      );
    }

    await prisma.$transaction(async (tx) => {
      for (const w of writes) {
        const { practiceId: _p, claimNumber: _c, ...rest } = w.data;
        await tx.insuranceClaim.upsert({
          where: { practiceId_claimNumber: { practiceId, claimNumber: w.claimNumber } },
          create: w.data,
          update: rest,
        });
        if (w.isUpdate) updated++;
        else imported++;
      }
    });
  } catch (err) {
    for (const t of minted) vault.expireToken(t, `${CALLER}:rollback`);
    if (err instanceof ImportRejectedError) (err as ImportRejectedError & { conflicts?: unknown }).conflicts = conflicts;
    throw err;
  }

  return {
    industryType,
    totalRows: parsed.totalRows,
    imported,
    updated,
    skippedZeroBalance,
    duplicateRowsInFile: parsed.duplicateRows.length,
    conflicts,
    rejected: parsed.rejected,
    warnings: parsed.warnings,
    dateAssumedRowCount: parsed.dateAssumedRowCount,
    unmappedHeaders: parsed.unmappedHeaders,
  };
}
