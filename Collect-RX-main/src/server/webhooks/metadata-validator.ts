/**
 * Webhook Metadata Tampering Validator
 *
 * Security function to detect when webhook metadata doesn't match the actual
 * claim or call attempt being referenced. Prevents cross-practice claim hijacking.
 */

import type { PrismaClient } from '@prisma/client';
import type { VapiWebhookPayload } from '../../vapi/client';
import { logger } from '../observability/logger.js';

export interface MetadataValidationResult {
  valid: boolean;
  error?: string;
  details?: {
    mismatchedField?: string;
    expected?: string;
    received?: string;
  };
}

/**
 * Validates webhook metadata matches the claim and vapiCallId.
 *
 * Attack scenario being prevented:
 * - Attacker intercepts webhook from Practice A with vapiCallId_A
 * - Changes vapiCallId to vapiCallId_B (from Practice B claim)
 * - Handler looks up callAttempt by vapiCallId_B → finds Practice B data
 * - But metadata still says claimId_A (Practice A claim)
 * - Mismatch detected: claim.practiceId != metadata.practiceId → 403 Forbidden
 *
 * @param prisma Database client
 * @param payload Vapi webhook payload
 * @returns Validation result with error details if validation fails
 */
export async function validateWebhookMetadata(
  prisma: PrismaClient,
  payload: VapiWebhookPayload
): Promise<MetadataValidationResult> {
  const metadata = payload.metadata;
  const vapiCallId = payload.call?.id;

  // No metadata to validate
  if (!metadata) {
    return { valid: true };
  }

  // Must have at least a vapiCallId
  if (!vapiCallId) {
    return {
      valid: false,
      error: 'Missing vapiCallId',
    };
  }

  // Metadata must include practiceId
  if (!metadata.practiceId) {
    return {
      valid: false,
      error: 'Metadata missing practiceId',
    };
  }

  // ─── Check 1: If we have a claimId in metadata, verify it belongs to the claimed practice ───
  if (metadata.claimId) {
    try {
      const claim = await prisma.insuranceClaim.findUnique({
        where: { id: metadata.claimId },
        select: { id: true, practiceId: true },
      });

      if (claim && claim.practiceId !== metadata.practiceId) {
        return {
          valid: false,
          error: 'Claim practice mismatch',
          details: {
            mismatchedField: 'claimId',
            expected: claim.practiceId,
            received: metadata.practiceId,
          },
        };
      }
    } catch (err) {
      logger.error('[webhook-validator] Error validating claimId', { error: err });
      // If DB lookup fails, let it pass — downstream handler will fail gracefully
      return { valid: true };
    }
  }

  // ─── Check 2: If this vapiCallId already exists, verify the call belongs to the claimed practice ───
  try {
    const existing = await prisma.callAttempt.findUnique({
      where: { vapiCallId },
      include: { claim: { select: { practiceId: true } } },
    });

    if (existing && existing.claim.practiceId !== metadata.practiceId) {
      return {
        valid: false,
        error: 'Existing call practice mismatch',
        details: {
          mismatchedField: 'vapiCallId',
          expected: existing.claim.practiceId,
          received: metadata.practiceId,
        },
      };
    }

    // Also verify the claimId matches if we have both
    if (existing && metadata.claimId && existing.claimId !== metadata.claimId) {
      return {
        valid: false,
        error: 'Call attempt claim mismatch',
        details: {
          mismatchedField: 'claimId',
          expected: existing.claimId,
          received: metadata.claimId,
        },
      };
    }
  } catch (err) {
    logger.error('[webhook-validator] Error validating vapiCallId', { error: err });
    return { valid: true };
  }

  return { valid: true };
}

/**
 * Helper to format validation error for logging
 */
export function formatValidationError(result: MetadataValidationResult): string {
  if (result.valid) return 'No error';
  let msg = result.error || 'Unknown error';
  if (result.details) {
    msg += ` (${result.details.mismatchedField}: expected '${result.details.expected}', got '${result.details.received}')`;
  }
  return msg;
}
