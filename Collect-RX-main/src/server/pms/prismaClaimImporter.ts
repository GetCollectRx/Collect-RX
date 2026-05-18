import type { CarrierId, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { mapToCarrierId } from './carrierMap.js';
import { normalizePmsClaimRow, type NormalizedPmsClaimRow } from './parseExportRows.js';
import { piiVault } from '../../services/pii-vault.js';

export interface PrismaImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: { claimNumber?: string; error: string }[];
  importedBalanceTotal: number;
}

function stablePatientId(practiceId: string, row: NormalizedPmsClaimRow): string {
  const key = `${practiceId}|${row.patientFirstName}|${row.patientLastName}|${row.claimNumber}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function patientTokenForRow(practiceId: string, row: NormalizedPmsClaimRow): string {
  return piiVault.tokenize(stablePatientId(practiceId, row));
}

async function upsertInsuranceClaim(
  prisma: PrismaClient,
  practiceId: string,
  row: NormalizedPmsClaimRow,
  carrierId: CarrierId,
): Promise<'imported' | 'skipped'> {
  if (row.outstandingAmount <= 0) return 'skipped';

  const patientToken = patientTokenForRow(practiceId, row);
  const daysOutstanding =
    row.daysOutstanding > 0
      ? row.daysOutstanding
      : row.servicedAt
        ? Math.max(0, Math.floor((Date.now() - row.servicedAt.getTime()) / 86400000))
        : 0;

  await prisma.insuranceClaim.upsert({
    where: {
      practiceId_claimNumber: { practiceId, claimNumber: row.claimNumber },
    },
    create: {
      practiceId,
      claimNumber: row.claimNumber,
      carrierId,
      patientToken,
      billedAmount: row.billedAmount,
      outstandingAmount: row.outstandingAmount,
      daysOutstanding,
      servicedAt: row.servicedAt,
      status: 'PENDING',
      priority: daysOutstanding > 90 ? 'URGENT' : daysOutstanding > 60 ? 'HIGH' : 'NORMAL',
    },
    update: {
      outstandingAmount: row.outstandingAmount,
      daysOutstanding,
      billedAmount: row.billedAmount,
      carrierId,
      servicedAt: row.servicedAt ?? undefined,
    },
  });

  return 'imported';
}

export async function importPmsClaimsToPrisma(
  prisma: PrismaClient,
  rows: Record<string, unknown>[],
  practiceId: string,
  pmsSource: 'dentrix' | 'abeldent',
): Promise<PrismaImportResult> {
  const result: PrismaImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    importedBalanceTotal: 0,
  };

  for (const raw of rows) {
    try {
      const row = normalizePmsClaimRow(raw, pmsSource);
      const carrierId = mapToCarrierId(row.carrierName);
      const outcome = await upsertInsuranceClaim(prisma, practiceId, row, carrierId);
      if (outcome === 'skipped') {
        result.skipped += 1;
      } else {
        result.imported += 1;
        result.importedBalanceTotal += row.outstandingAmount;
      }
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        claimNumber: getClaimNumberFromRaw(raw),
        error: (err as Error).message,
      });
    }
  }

  return result;
}

function getClaimNumberFromRaw(raw: Record<string, unknown>): string | undefined {
  for (const k of ['Claim ID', 'ClaimID', 'claim_number', 'id', 'Ref']) {
    const v = raw[k];
    if (v) return String(v);
  }
  return undefined;
}
