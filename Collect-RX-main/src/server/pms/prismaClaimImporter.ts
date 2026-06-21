import type { CarrierId, PrismaClient } from '@prisma/client';
import type { PmsImportFamily } from '../../types/pms.js';
import { mapToCarrierId } from './carrierMap.js';
import { normalizePmsClaimRow, type NormalizedPmsClaimRow } from './parseExportRows.js';
// Use the main PIIVault (AES-256-GCM, stores full PatientPHI objects).
// NOTE: do NOT import from '../../services/pii-vault.js' — that is the legacy
// simple tokenizer that stores only a patientId string and cannot provide PHI
// to the queue engine at call dispatch time.
import { piiVault, type PatientPHI } from '../../pii-vault.js';

export interface PrismaImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: { claimNumber?: string; error: string }[];
  importedBalanceTotal: number;
  paymentsVerified: number;
  dollarsRecoveredSyncVerified: number;
}

/**
 * Build the PatientPHI object from a normalized import row.
 * Fields sourced from PHI columns in the PMS export — never stored in DB.
 * All PHI is AES-256-GCM encrypted in the main PIIVault (src/pii-vault.ts).
 */
function buildPatientPHI(row: NormalizedPmsClaimRow): PatientPHI {
  const patientName = [row.patientFirstName, row.patientLastName].filter(Boolean).join(' ');
  return {
    patientName: patientName || 'Unknown',
    dateOfBirth: row.patientDob ?? '',
    subscriberId: row.subscriberId ?? '',
    groupPolicyNumber: row.groupPolicyNumber ?? '',
    ...(row.subscriberName ? { subscriberName: row.subscriberName } : {}),
    ...(row.subscriberDateOfBirth ? { subscriberDateOfBirth: row.subscriberDateOfBirth } : {}),
  };
}

function patientTokenForRow(_practiceId: string, row: NormalizedPmsClaimRow): string {
  // Tokenize full PatientPHI into the main AES-256-GCM vault so the queue engine
  // can detokenize at call dispatch time. The old services/pii-vault.ts stored only
  // a string ID and was disconnected from the queue engine — that path is removed.
  return piiVault.tokenize(buildPatientPHI(row), 'pms-import');
}

async function upsertInsuranceClaim(
  prisma: PrismaClient,
  practiceId: string,
  row: NormalizedPmsClaimRow,
  carrierId: CarrierId,
): Promise<
  | { outcome: 'imported'; claimId: string; previousOutstanding: number; newOutstanding: number }
  | { outcome: 'skipped' }
> {
  const existing = await prisma.insuranceClaim.findUnique({
    where: {
      practiceId_claimNumber: { practiceId, claimNumber: row.claimNumber },
    },
    select: { id: true, outstandingAmount: true },
  });

  if (row.outstandingAmount <= 0) {
    if (!existing || Number(existing.outstandingAmount) <= 0) {
      return { outcome: 'skipped' };
    }
    await prisma.insuranceClaim.update({
      where: { id: existing.id },
      data: {
        outstandingAmount: 0,
        daysOutstanding: row.daysOutstanding > 0 ? row.daysOutstanding : undefined,
      },
    });
    return {
      outcome: 'imported',
      claimId: existing.id,
      previousOutstanding: Number(existing.outstandingAmount),
      newOutstanding: 0,
    };
  }

  const previousOutstanding = existing ? Number(existing.outstandingAmount) : row.outstandingAmount;

  const patientToken = patientTokenForRow(practiceId, row);
  const daysOutstanding =
    row.daysOutstanding > 0
      ? row.daysOutstanding
      : row.servicedAt
        ? Math.max(0, Math.floor((Date.now() - row.servicedAt.getTime()) / 86400000))
        : 0;

  const upserted = await prisma.insuranceClaim.upsert({
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
      expectedAmount: row.expectedAmount ?? undefined,
      daysOutstanding,
      servicedAt: row.servicedAt,
      submittedAt: row.submittedAt,
      treatmentCodes: row.treatmentCodes ?? undefined,
      status: 'PENDING',
      priority: daysOutstanding > 90 ? 'URGENT' : daysOutstanding > 60 ? 'HIGH' : 'NORMAL',
    },
    update: {
      outstandingAmount: row.outstandingAmount,
      daysOutstanding,
      billedAmount: row.billedAmount,
      carrierId,
      servicedAt: row.servicedAt ?? undefined,
      // Update submittedAt and treatmentCodes if the new import has them and current row doesn't
      ...(row.submittedAt ? { submittedAt: row.submittedAt } : {}),
      ...(row.treatmentCodes ? { treatmentCodes: row.treatmentCodes } : {}),
      ...(row.expectedAmount != null ? { expectedAmount: row.expectedAmount } : {}),
    },
  });

  return {
    outcome: 'imported',
    claimId: upserted.id,
    previousOutstanding,
    newOutstanding: row.outstandingAmount,
  };
}

export async function importPmsClaimsToPrisma(
  prisma: PrismaClient,
  rows: Record<string, unknown>[],
  practiceId: string,
  importFamily: PmsImportFamily,
): Promise<PrismaImportResult> {
  const result: PrismaImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    importedBalanceTotal: 0,
    paymentsVerified: 0,
    dollarsRecoveredSyncVerified: 0,
  };

  const { runPaymentVerificationBatch } = await import('../recovery/paymentVerification.js');
  const { buildPmsT11DenialSignal, linkRecoveryActionToCdcpCase } = await import(
    '../recovery/cdcpRecoveryBridge.js'
  );
  const { upsertReconsiderationFromSignal } = await import(
    '../canadianExpansion/autoReconsideration.js'
  );
  const syncUpdates: Array<{
    claimId: string;
    previousOutstanding: number;
    newOutstanding: number;
  }> = [];

  for (const raw of rows) {
    try {
      const row = normalizePmsClaimRow(raw, importFamily);
      const carrierId = mapToCarrierId(row.carrierName);
      const outcome = await upsertInsuranceClaim(prisma, practiceId, row, carrierId);
      if (outcome.outcome === 'skipped') {
        result.skipped += 1;
      } else {
        result.imported += 1;
        result.importedBalanceTotal += row.outstandingAmount;
        syncUpdates.push({
          claimId: outcome.claimId,
          previousOutstanding: outcome.previousOutstanding,
          newOutstanding: outcome.newOutstanding,
        });

        const isT11 =
          row.transactionType?.toUpperCase() === 'T11' ||
          Boolean(row.denialReasonCode?.trim());
        const isCdcpCarrier =
          row.carrierName.toLowerCase().includes('cdcp') ||
          row.carrierName.toLowerCase().includes('canadian dental care');
        if (isT11 && isCdcpCarrier) {
          try {
            const patientToken = patientTokenForRow(practiceId, row);
            const signal = buildPmsT11DenialSignal({
              practiceId,
              patientToken,
              claimRef: row.claimNumber,
              procedureCode: row.procedureCode || null,
              reasonCode: row.denialReasonCode,
            });
            const cdcp = await upsertReconsiderationFromSignal(prisma, signal);
            await linkRecoveryActionToCdcpCase(prisma, outcome.claimId, cdcp.id);
          } catch (cdcpErr) {
            result.errors.push({
              claimNumber: row.claimNumber,
              error: `CDCP auto-post: ${(cdcpErr as Error).message}`,
            });
          }
        }
      }
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        claimNumber: getClaimNumberFromRaw(raw),
        error: (err as Error).message,
      });
    }
  }

  const verified = await runPaymentVerificationBatch(prisma, practiceId, syncUpdates);
  result.paymentsVerified = verified.filter((v) => v.verified).length;
  result.dollarsRecoveredSyncVerified =
    verified.reduce((s, v) => s + v.amountRecoveredCents, 0) / 100;

  return result;
}

function getClaimNumberFromRaw(raw: Record<string, unknown>): string | undefined {
  for (const k of ['Claim ID', 'ClaimID', 'claim_number', 'id', 'Ref']) {
    const v = raw[k];
    if (v) return String(v);
  }
  return undefined;
}
