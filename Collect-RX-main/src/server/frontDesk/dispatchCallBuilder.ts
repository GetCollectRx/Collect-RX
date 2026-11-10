import type { CarrierId, PrismaClient } from '@prisma/client';
import { CARRIER_CONFIGS, getTelusDialPhone } from '../../carriers/adapter.js';
import type { VapiCallParams } from '../../vapi/client.js';
import type { PatientPHI } from '../../pii-vault.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';
import { getApprovedNavigationNotes } from '../learning/carrierLessons.js';
import { getKnownSubmissionChannel } from '../learning/submissionChannelMemory.js';
import { getPublishedNavigationSteps } from '../discovery/carrierDiscoveryService.js';
import type { PracticeSettings } from '../../types/practiceSettings.js';
import type { DispatchMode } from './dispatchDecision.js';

/**
 * One place that assembles the variables for a carrier call, so the scheduled
 * path and the manual "Call now" route send the same set. PHI arrives already
 * detokenized from the caller and is only copied into ephemeral call variables;
 * nothing here stores or logs it.
 */

export interface PracticeCallContext {
  practiceName: string;
  practiceNpi: string | undefined;
  practiceTaxId: string | undefined;
  practiceAddress: string | undefined;
  practicePhone: string;
  providerNumber: string;
  languagePreference: 'en' | 'fr';
  settings: PracticeSettings;
}

export async function loadPracticeCallContext(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: CarrierId,
  preloadedSettings?: PracticeSettings,
): Promise<PracticeCallContext> {
  const [practice, settings] = await Promise.all([
    prisma.practice.findUnique({
      where: { id: practiceId },
      select: { name: true, billingPhone: true, npi: true, taxId: true, practiceAddress: true },
    }),
    preloadedSettings ? Promise.resolve(preloadedSettings) : getPracticeSettings(prisma, practiceId),
  ]);
  const carrierSettings = settings.carrierConfigs.find((c) => c.carrierId === carrierId);
  // billingPhone is the CRTC disclosure / carrier callback number.
  // escalationPhoneNumber is for staff takeover, so it is only the last fallback.
  const practicePhone =
    settings.billingPhone?.trim() ||
    practice?.billingPhone?.trim() ||
    settings.escalationPhoneNumber;
  return {
    practiceName: practice?.name ?? '',
    practiceNpi: practice?.npi ?? undefined,
    practiceTaxId: practice?.taxId ?? undefined,
    practiceAddress: practice?.practiceAddress ?? undefined,
    practicePhone,
    providerNumber: carrierSettings?.providerNumber ?? '',
    languagePreference: carrierSettings?.languagePreference ?? 'en',
    settings,
  };
}

export type CarrierDial =
  | { ok: true; carrierPhone: string }
  | { ok: false; code: 'TELUS_TPA_PHONE_UNVERIFIED' };

/**
 * TELUS AdjudiCare has no carrier-wide claims line: it aggregates many TPAs and
 * the configured number is a placeholder. Resolve the TPA-specific verified
 * number, and refuse (so the caller can route to a person) when none is
 * verified, rather than dial a number that may reach the wrong company.
 */
export function resolveCarrierDial(
  carrierId: CarrierId,
  phi: Pick<PatientPHI, 'subscriberId' | 'groupPolicyNumber'>,
): CarrierDial {
  const carrierConfig = CARRIER_CONFIGS[carrierId];
  if (carrierId !== 'telus_adjudicare') return { ok: true, carrierPhone: carrierConfig.phone };
  const telusPhone = getTelusDialPhone(phi.subscriberId, phi.groupPolicyNumber ?? '');
  if (!telusPhone) return { ok: false, code: 'TELUS_TPA_PHONE_UNVERIFIED' };
  return { ok: true, carrierPhone: telusPhone };
}

export interface CarrierCallHints {
  carrierIvrInstructions: string;
  knownResubmissionChannel: string;
  knownDocumentationChannel: string;
}

export async function loadCarrierCallHints(
  prisma: PrismaClient,
  carrierId: CarrierId,
): Promise<CarrierCallHints> {
  const carrierConfig = CARRIER_CONFIGS[carrierId];
  // Only published, human-approved snapshots may augment the static adapter
  // hints. Proposed discovery output is never exposed to a live call.
  const learnedNotes = await getApprovedNavigationNotes(prisma, carrierId);
  const publishedNavigation = await getPublishedNavigationSteps(prisma, carrierId);
  const carrierIvrInstructions = [
    ...carrierConfig.ivrHints,
    ...publishedNavigation,
    ...(learnedNotes ? [learnedNotes] : []),
  ].join(' | ');
  return {
    carrierIvrInstructions,
    knownResubmissionChannel: await getKnownSubmissionChannel(prisma, carrierId, 'CLAIM_RESUBMISSION'),
    knownDocumentationChannel: await getKnownSubmissionChannel(prisma, carrierId, 'DOCUMENTATION'),
  };
}

export interface DispatchClaimFields {
  id: string;
  carrierId: CarrierId;
  patientToken: string;
  claimNumber: string;
  billedAmount: unknown;
  outstandingAmount: unknown;
  expectedAmount: unknown;
  daysOutstanding: number;
  servicedAt: Date | null;
  submittedAt: Date | null;
  treatmentCodes: string | null;
}

export function buildVapiCallParams(input: {
  practiceId: string;
  claim: DispatchClaimFields;
  phi: PatientPHI;
  carrierPhone: string;
  context: PracticeCallContext;
  hints: CarrierCallHints;
  mode: DispatchMode;
  /** The attempt this call will be (1-based). Stable across a retry of the same attempt. */
  attemptNumber: number;
}): VapiCallParams {
  const { claim, phi, context, hints, mode } = input;
  return {
    claimId: claim.id,
    carrierId: claim.carrierId,
    patientToken: claim.patientToken,
    // ── PHI: resolved from piiVault.detokenize() by the caller; ephemeral, never stored ──
    patientName: phi.patientName,
    patientDob: phi.dateOfBirth,
    policyNumber: phi.subscriberId,
    groupNumber: phi.groupPolicyNumber,
    subscriberName: phi.subscriberName,
    subscriberDob: phi.subscriberDateOfBirth,
    // ── Claim fields ───────────────────────────────────────────────────────────
    carrierPhone: input.carrierPhone,
    claimNumber: claim.claimNumber,
    billedAmount: Number(claim.billedAmount),
    outstandingAmount: Number(claim.outstandingAmount),
    amountExpected: claim.expectedAmount ? Number(claim.expectedAmount) : undefined,
    daysOutstanding: claim.daysOutstanding,
    treatmentDate: claim.servicedAt?.toISOString().split('T')[0],
    claimSubmittedDate: claim.submittedAt?.toISOString().split('T')[0],
    treatmentCodes: claim.treatmentCodes ?? undefined,
    // ── Practice identity ──────────────────────────────────────────────────────
    practiceId: input.practiceId,
    practiceName: context.practiceName,
    practiceNpi: context.practiceNpi,
    practiceTaxId: context.practiceTaxId,
    practiceAddress: context.practiceAddress,
    providerNumber: context.providerNumber,
    practicePhone: context.practicePhone,
    languagePreference: context.languagePreference,
    carrierIvrInstructions: hints.carrierIvrInstructions,
    // V1: practice staff speak with the rep; CollectRx AI only navigates IVR /
    // holds / listens. A human-assisted practice never reaches the autonomous squad.
    squadId: mode.squadId,
    knownResubmissionChannel: hints.knownResubmissionChannel,
    knownDocumentationChannel: hints.knownDocumentationChannel,
    // Stable for this attempt: a retry of the same attempt (after an ambiguous
    // timeout) reuses it; the next real attempt gets a new one.
    idempotencyKey: `${claim.id}:${input.attemptNumber}`,
  };
}
