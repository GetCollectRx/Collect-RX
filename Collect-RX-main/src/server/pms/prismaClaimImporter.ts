import type { CarrierId, PrismaClient } from '@prisma/client';
import type { PmsImportFamily } from '../../types/pms.js';
import { mapToCarrierId } from './carrierMap.js';
import { normalizePmsClaimRow, type NormalizedPmsClaimRow } from './parseExportRows.js';
// Use the main PIIVault (AES-256-GCM, stores full PatientPHI objects).
// NOTE: do NOT import from '../../services/pii-vault.js' — that is the legacy
// simple tokenizer that stores only a patientId string and cannot provide PHI
// to the queue engine at call dispatch time.
import { piiVault, type PatientPHI } from '../../pii-vault.js';
import { runPaymentVerificationBatch } from '../recovery/paymentVerification.js';
import { syncDenialEvidenceItems } from '../recovery/denialEvidenceService.js';
import { detectUnderpayment, upsertUnderpaymentCase } from '../reconciliation/underpaymentDetector.js';
import { evaluateSubmissionQuality } from '../reconciliation/submissionQualityGate.js';
import { buildPmsT11DenialSignal, linkRecoveryActionToCdcpCase } from '../recovery/cdcpRecoveryBridge.js';
import { upsertReconsiderationFromSignal } from '../canadianExpansion/autoReconsideration.js';
import { validateTreatingDentistForClaim } from '../services/billing/validateTreatingDentist.js';

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

function patientTokenForRow(practiceId: string, row: NormalizedPmsClaimRow): string {
  // Tokenize full PatientPHI into the main AES-256-GCM vault so the queue engine
  // can detokenize at call dispatch time. The old services/pii-vault.ts stored only
  // a string ID and was disconnected from the queue engine — that path is removed.
  return piiVault.tokenize(buildPatientPHI(row), 'pms-import', practiceId);
}

async function upsertInsuranceClaim(
  prisma: PrismaClient,
  practiceId: string,
  row: NormalizedPmsClaimRow,
  carrierId: CarrierId,
  treatingDentistId: string | undefined,
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
      denialReasonCode: row.denialReasonCode ?? undefined,
      denialDate: row.denialReasonCode ? new Date() : undefined,
      daysOutstanding,
      servicedAt: row.servicedAt,
      submittedAt: row.submittedAt,
      treatmentCodes: row.treatmentCodes ?? undefined,
      treatingDentistId,
      status: 'PENDING',
      priority: daysOutstanding > 90 ? 'URGENT' : daysOutstanding > 60 ? 'HIGH' : 'NORMAL',
    },
    update: {
      outstandingAmount: row.outstandingAmount,
      daysOutstanding,
      billedAmount: row.billedAmount,
      carrierId,
      // Refresh the PHI token on every re-import: staff fix missing patient
      // data by re-importing, and the corrected PHI only reaches dispatch if
      // the claim points at the newly tokenized entry.
      patientToken,
      servicedAt: row.servicedAt ?? undefined,
      // Only overwrite an already-set treatingDentistId when this import row
      // actually carries one — a later re-import without the column must not
      // erase a dentist assignment made by an earlier one that had it.
      ...(treatingDentistId ? { treatingDentistId } : {}),
      // Update submittedAt and treatmentCodes if the new import has them and current row doesn't
      ...(row.submittedAt ? { submittedAt: row.submittedAt } : {}),
      ...(row.treatmentCodes ? { treatmentCodes: row.treatmentCodes } : {}),
      ...(row.expectedAmount != null ? { expectedAmount: row.expectedAmount } : {}),
      ...(row.denialReasonCode ? {
        denialReasonCode: row.denialReasonCode,
        denialDate: new Date(),
      } : {}),
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

  const syncUpdates: Array<{
    claimId: string;
    previousOutstanding: number;
    newOutstanding: number;
  }> = [];

  for (const raw of rows) {
    try {
      const row = normalizePmsClaimRow(raw, importFamily);
      const carrierId = mapToCarrierId(row.carrierName);
      if (!carrierId) {
        result.failed += 1;
        result.errors.push({
          claimNumber: row.claimNumber,
          error:
            `Unrecognized insurance carrier ${row.carrierName ? `"${row.carrierName}"` : '(blank)'} — ` +
            'claim not imported. Supported: Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare.',
        });
        continue;
      }
      let treatingDentistId: string | undefined;
      if (row.treatingDentistProviderNumber) {
        const dentistCheck = await validateTreatingDentistForClaim(
          prisma,
          practiceId,
          row.treatingDentistProviderNumber,
        );
        if (!dentistCheck.ok) {
          result.failed += 1;
          result.errors.push({ claimNumber: row.claimNumber, error: dentistCheck.error });
          continue;
        }
        treatingDentistId = dentistCheck.dentistId;
      }

      const outcome = await upsertInsuranceClaim(prisma, practiceId, row, carrierId, treatingDentistId);
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
        if (isT11) {
          const existingAction = await prisma.claimRecoveryAction.findFirst({
            where: {
              claimId: outcome.claimId,
              actionType: 'DENIAL_REVIEW',
              status: { in: ['OPEN', 'BLOCKING'] },
            },
          });
          let denialActionId = existingAction?.id ?? null;
          if (!existingAction) {
            const created = await prisma.claimRecoveryAction.create({
              data: {
                practiceId,
                claimId: outcome.claimId,
                actionType: 'DENIAL_REVIEW',
                status: 'BLOCKING',
                route: 'PRACTICE_GATE',
                title: 'Review insurer denial',
                detail: row.denialReasonCode ?? 'Imported denial requires practice review.',
                metadata: {
                  source: 'csv_import',
                  denialReasonCode: row.denialReasonCode ?? null,
                },
              },
            });
            denialActionId = created.id;
            await prisma.claimRecoveryEvent.create({
              data: {
                practiceId,
                claimId: outcome.claimId,
                eventType: 'DENIAL_IMPORTED_FROM_CSV',
                metadata: { denialReasonCode: row.denialReasonCode ?? null },
              },
            });
          }
          await syncDenialEvidenceItems(prisma, {
            practiceId,
            claimId: outcome.claimId,
            recoveryActionId: denialActionId,
            denialReasonCode: row.denialReasonCode,
            carrierId,
            treatmentCodes: row.treatmentCodes,
          });
        }

        if (row.insurancePaidAmount != null && row.expectedAmount != null) {
          const candidate = detectUnderpayment({
            expectedAmount: row.expectedAmount,
            paidAmount: row.insurancePaidAmount,
            reasonCode: row.denialReasonCode,
          });
          if (candidate) {
            candidate.claimId = outcome.claimId;
            await upsertUnderpaymentCase(prisma, practiceId, outcome.claimId, candidate);
          }
        }

        await evaluateSubmissionQuality(prisma, practiceId, outcome.claimId);
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
