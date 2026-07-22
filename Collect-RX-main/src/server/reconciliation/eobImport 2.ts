/**
 * EOB / remittance CSV import — idempotent procedure-level payment reconciliation.
 */
import type { CarrierId, PrismaClient } from '@prisma/client';
import { getCell, parseMoney } from '../pms/parseExportRows.js';
import { mapToCarrierId } from '../pms/carrierMap.js';
import { detectUnderpayment, upsertUnderpaymentCase } from './underpaymentDetector.js';

export interface NormalizedEobRow {
  claimNumber: string;
  carrierName: string;
  paidAmount: number;
  expectedAmount: number | null;
  procedureCode: string | null;
  reasonCode: string | null;
  remittanceDate: Date | null;
}

export interface EobImportResult {
  processed: number;
  matched: number;
  underpayments: number;
  skipped: number;
  errors: { claimNumber?: string; error: string }[];
}

export function normalizeEobRow(raw: Record<string, unknown>): NormalizedEobRow | null {
  const claimNumber = getCell(raw,
    'Claim Number', 'Claim ID', 'ClaimID', 'claim_number', 'Claim #', 'Ref',
  );
  if (!claimNumber) return null;

  const carrierName = getCell(raw, 'Carrier', 'Insurance', 'Payer', 'carrier') ?? '';
  const paidAmount = parseMoney(getCell(raw,
    'Paid Amount', 'Amount Paid', 'paid_amount', 'Payment', 'Ins Paid',
  ));
  const expectedRaw = getCell(raw,
    'Expected Amount', 'Expected Pay', 'expected_amount', 'Allowed', 'Fee',
  );
  const expectedAmount = expectedRaw ? parseMoney(expectedRaw) : null;
  const procedureCode = getCell(raw, 'Procedure', 'CDT', 'Code', 'procedure_code');
  const reasonCode = getCell(raw, 'Reason Code', 'Denial Code', 'reason_code', 'Remark');
  const remittanceRaw = getCell(raw, 'Remittance Date', 'EOB Date', 'Payment Date', 'paid_date');
  const remittanceDate = remittanceRaw ? new Date(remittanceRaw) : null;

  return {
    claimNumber,
    carrierName,
    paidAmount,
    expectedAmount,
    procedureCode,
    reasonCode,
    remittanceDate: remittanceDate && !Number.isNaN(remittanceDate.getTime()) ? remittanceDate : null,
  };
}

export async function importEobRowsToPrisma(
  prisma: PrismaClient,
  practiceId: string,
  rows: Record<string, unknown>[],
): Promise<EobImportResult> {
  const result: EobImportResult = {
    processed: 0,
    matched: 0,
    underpayments: 0,
    skipped: 0,
    errors: [],
  };

  for (const raw of rows) {
    result.processed += 1;
    try {
      const row = normalizeEobRow(raw);
      if (!row) {
        result.skipped += 1;
        continue;
      }

      const claim = await prisma.insuranceClaim.findUnique({
        where: { practiceId_claimNumber: { practiceId, claimNumber: row.claimNumber } },
        select: {
          id: true,
          expectedAmount: true,
          carrierId: true,
        },
      });
      if (!claim) {
        result.skipped += 1;
        continue;
      }

      result.matched += 1;
      const expectedAmount = row.expectedAmount ?? (claim.expectedAmount != null ? Number(claim.expectedAmount) : null);
      const candidate = detectUnderpayment({
        expectedAmount,
        paidAmount: row.paidAmount,
        reasonCode: row.reasonCode,
      });

      if (candidate) {
        candidate.claimId = claim.id;
        await upsertUnderpaymentCase(prisma, practiceId, claim.id, candidate);
        result.underpayments += 1;
      }

      if (row.carrierName) {
        const carrierId = mapToCarrierId(row.carrierName);
        if (carrierId && carrierId !== claim.carrierId) {
          await prisma.insuranceClaim.update({
            where: { id: claim.id },
            data: { carrierId: carrierId as CarrierId },
          });
        }
      }

      await prisma.claimRecoveryEvent.create({
        data: {
          practiceId,
          claimId: claim.id,
          eventType: 'EOB_ROW_IMPORTED',
          metadata: {
            paidAmount: row.paidAmount,
            expectedAmount,
            procedureCode: row.procedureCode,
            reasonCode: row.reasonCode,
            remittanceDate: row.remittanceDate?.toISOString() ?? null,
          },
        },
      });
    } catch (err) {
      result.errors.push({
        claimNumber: getCell(raw, 'Claim Number', 'Claim ID', 'claim_number') ?? undefined,
        error: (err as Error).message,
      });
    }
  }

  return result;
}
