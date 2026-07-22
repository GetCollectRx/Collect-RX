import type { PrismaClient } from '@prisma/client';
import { getTriageCredentialStatus } from './triageCredentialService.js';

export interface CdanetClaimStatusRequest {
  practiceId: string;
  claimId: string;
}

export interface CdanetClaimStatusAdapter {
  readonly id: 'cdanet';
  probe(prisma: PrismaClient, request: CdanetClaimStatusRequest): Promise<null>;
}

/**
 * Contract-only adapter. CDAnet Tx23 serves pre-visit eligibility and
 * predetermination; it must never be repurposed as a claim-status lookup.
 * This adapter therefore makes no network requests until a compliant,
 * carrier-approved claim-status transport is implemented.
 */
export const enrolledCdanetClaimStatusAdapter: CdanetClaimStatusAdapter = {
  id: 'cdanet',
  async probe(prisma, request) {
    const status = await getTriageCredentialStatus(prisma, { practiceId: request.practiceId });
    if (!status.enrolled) return null;
    return null;
  },
};
