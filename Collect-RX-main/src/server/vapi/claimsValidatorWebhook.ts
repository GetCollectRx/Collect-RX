/**
 * Async Claims Validator Webhook — runs off-call after Claims_Agent completes
 *
 * The validator runs AFTER the call ends (async, not blocking the rep).
 * It receives the full transcript + extracted facts and validates:
 * - HARD CONSTRAINTS: PHI, claim number match, reference numbers
 * - OUTCOME COMPLETENESS: required fields per outcome type
 * - SAFETY VIOLATIONS: argumentative language, defensive tone, carrier block risk
 *
 * Output:
 * - PASS: Log success, update callAttempt with validation result
 * - FAIL: Create escalation, notify practice via email/dashboard
 */

import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import { createEscalation } from '../services/escalationService.js';
import { sendPracticeNotification } from '../services/practiceNotificationService.js';

interface ValidatorWebhookPayload {
  callAttemptId: string;
  transcript: string;
  extractedFacts: {
    claimNumber: string;
    outcome?: string;
    referenceNumber?: string;
    repName?: string;
    callbackNumber?: string;
    paymentAmount?: string;
    paymentDate?: string;
    paymentReference?: string;
    denialCode?: string;
    denialReason?: string;
    expectedCompletionDate?: string;
    requiredDocumentation?: string;
    submissionMethod?: string;
    submissionDestination?: string;
    submissionDeadline?: string;
    nextAction?: string;
    [key: string]: unknown;
  };
}

interface ValidationResult {
  passed: boolean;
  outcome: string;
  violations: Array<{
    phase: string;
    rule: string;
    severity: string;
    message: string;
  }>;
  safetyScore: number;
  carrierBlockRisk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  action: 'PASS' | 'ESCALATE' | 'RE_ATTEMPT';
  escalationReason?: string;
}

function verifyValidatorAuth(req: Request): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  const x = req.get('x-vapi-secret') || req.get('X-Vapi-Secret');
  if (x && x === secret) return true;
  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m?.[1] && m[1] === secret) return true;
  return false;
}

function bodyHash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function isValidatorDuplicate(prisma: PrismaClient, hash: string): Promise<boolean> {
  const existing = await prisma.processedValidatorWebhook.findUnique({ where: { bodyHash: hash } });
  return Boolean(existing);
}

async function markValidatorWebhookProcessed(prisma: PrismaClient, hash: string): Promise<void> {
  await prisma.processedValidatorWebhook.create({ data: { bodyHash: hash } });
}

/**
 * PHASE 1: HARD CONSTRAINTS
 * Return violations array; if any violation, validation fails
 */
function validateHardConstraints(
  payload: ValidatorWebhookPayload,
  originalClaimNumber: string,
): Array<{ phase: string; rule: string; severity: string; message: string }> {
  const violations = [];

  // PHI CHECK: No patient full name, DOB, health card, SSN
  const phiPatterns = [
    /\d{4}-\d{2}-\d{2}/, // ISO dates (DOB proxy)
    /\b(?:patient|member)\s+(?:name|full\s+name)[:=\s]+([A-Za-z\s]+)/i,
    /\b(?:health\s+)?card\s+(?:number|#)[:=\s]+[\w-]+/i,
    /\b(?:social\s+security|ssn)[:=\s]+[\d-]+/i,
  ];

  for (const pattern of phiPatterns) {
    if (pattern.test(payload.transcript)) {
      violations.push({
        phase: 'HARD_CONSTRAINTS',
        rule: 'PHI_CHECK',
        severity: 'CRITICAL',
        message: `PHI detected in transcript: ${pattern.source}`,
      });
    }
  }

  // CLAIM NUMBER MATCH
  if (payload.extractedFacts.claimNumber !== originalClaimNumber) {
    violations.push({
      phase: 'HARD_CONSTRAINTS',
      rule: 'CLAIM_NUMBER_MATCH',
      severity: 'CRITICAL',
      message: `Claim number mismatch: extracted ${payload.extractedFacts.claimNumber} vs original ${originalClaimNumber}`,
    });
  }

  // REFERENCE NUMBER — if outcome not UNCLEAR, must have reference or callback
  if (
    payload.extractedFacts.outcome !== 'UNCLEAR' &&
    !payload.extractedFacts.referenceNumber &&
    !payload.extractedFacts.callbackNumber
  ) {
    violations.push({
      phase: 'HARD_CONSTRAINTS',
      rule: 'REFERENCE_NUMBER',
      severity: 'CRITICAL',
      message: `No reference/callback documented for outcome ${payload.extractedFacts.outcome}`,
    });
  }

  // SETTLEMENT CHECK — no unauthorized settlements
  const settlementPatterns = [/agree\s+to\s+\$/, /settle\s+at\s+\$/, /close\s+out\s+for\s+\$/i];
  for (const pattern of settlementPatterns) {
    if (pattern.test(payload.transcript)) {
      violations.push({
        phase: 'HARD_CONSTRAINTS',
        rule: 'SETTLEMENT_CHECK',
        severity: 'CRITICAL',
        message: `Unauthorized settlement detected in transcript: ${pattern.source}`,
      });
    }
  }

  return violations;
}

/**
 * PHASE 2: OUTCOME COMPLETENESS
 * Check required fields per outcome type
 */
function validateOutcomeCompleteness(
  payload: ValidatorWebhookPayload,
): Array<{ phase: string; rule: string; severity: string; message: string }> {
  const violations = [];
  const { extractedFacts: facts } = payload;
  const outcome = facts.outcome;

  const required: Record<string, string[]> = {
    CLAIM_NOT_RECEIVED: ['submissionMethod', 'submissionDestination'],
    CLAIM_PAID: ['paymentAmount', 'paymentDate', 'paymentReference'],
    CLAIM_DENIED: ['denialCode', 'denialReason'],
    PROCESSING: ['expectedCompletionDate'],
    NEED_INFORMATION: ['requiredDocumentation', 'submissionMethod', 'submissionDestination'],
    UNCLEAR: ['referenceNumber', 'callbackNumber', 'nextAction'],
  };

  if (outcome && required[outcome]) {
    for (const field of required[outcome]) {
      if (!facts[field]) {
        violations.push({
          phase: 'COMPLETENESS',
          rule: 'OUTCOME_COMPLETENESS',
          severity: field.includes('payment') || field.includes('denial') ? 'CRITICAL' : 'WARNING',
          message: `${outcome} incomplete: missing ${field}`,
        });
      }
    }
  }

  return violations;
}

/**
 * PHASE 3: SAFETY RULES
 * Search for argumentative language, defensive tone, carrier block risk patterns
 */
function validateSafetyRules(payload: ValidatorWebhookPayload): { safetyScore: number; violations: Array<{ phase: string; rule: string; severity: string; message: string }> } {
  const violations = [];
  let safetyScore = 0;
  const { transcript } = payload;

  // ARGUMENTATIVE LANGUAGE after refusal
  if (/(however|but|i'm authorized|you have to)\s+/i.test(transcript) && /(?:don't work with|ending this|we won't|refused)/i.test(transcript)) {
    safetyScore += 2;
    violations.push({
      phase: 'SAFETY',
      rule: 'ARGUMENTATIVE_LANGUAGE',
      severity: 'WARNING',
      message: `Argumentative language detected after carrier refusal (+2 score)`,
    });
  }

  // DEFENSIVE TONE after refusal
  if (/(?:i understand|this is legitimate|we're calling|on behalf of)/i.test(transcript) && /(?:refused|ending|hang up)/i.test(transcript)) {
    safetyScore += 1;
    violations.push({
      phase: 'SAFETY',
      rule: 'DEFENSIVE_TONE',
      severity: 'WARNING',
      message: `Defensive tone detected after carrier refusal (+1 score)`,
    });
  }

  // CLAIM DETAIL DUMP after refusal
  if (/(?:policy|npi|claim number|procedures|amount|billed)/i.test(transcript) && /(?:refused|ending|hang up)/i.test(transcript)) {
    const refusalPos = transcript.search(/(?:refused|ending|hang up)/i);
    const claimPos = transcript.search(/(?:policy|npi|claim number)/i);
    if (claimPos > refusalPos) {
      safetyScore += 2;
      violations.push({
        phase: 'SAFETY',
        rule: 'CLAIM_DETAIL_DUMP',
        severity: 'WARNING',
        message: `Claim details dumped after carrier refusal (+2 score)`,
      });
    }
  }

  // VAGUE ANSWERS accepted (agent said "noted" without pushing)
  if (/(?:i'll note|noted|pending|call back|follow up)/i.test(transcript)) {
    safetyScore += 1;
    violations.push({
      phase: 'SAFETY',
      rule: 'VAGUE_ANSWERS',
      severity: 'WARNING',
      message: `Vague answer pattern detected without push for reference (+1 score)`,
    });
  }

  // DISCLOSURE TIMING — not in first 30 seconds
  const firstAutoWords = transcript.match(/automated|robot|system/i);
  if (firstAutoWords && transcript.indexOf(firstAutoWords[0]) > 2000) { // rough proxy: ~30 sec of speech
    safetyScore += 1;
    violations.push({
      phase: 'SAFETY',
      rule: 'DISCLOSURE_TIMING',
      severity: 'WARNING',
      message: `Automated disclosure not given within first 30 seconds (+1 score)`,
    });
  }

  return { safetyScore, violations };
}

/**
 * Main validator entry point
 */
async function validateExtraction(_prisma: PrismaClient, payload: ValidatorWebhookPayload, originalClaimNumber: string): Promise<ValidationResult> {
  const violations = [];

  // PHASE 1: HARD CONSTRAINTS
  const hardViolations = validateHardConstraints(payload, originalClaimNumber);
  violations.push(...hardViolations);
  if (hardViolations.some((v) => v.severity === 'CRITICAL')) {
    return {
      passed: false,
      outcome: payload.extractedFacts.outcome || 'UNCLEAR',
      violations,
      safetyScore: 0,
      carrierBlockRisk: 'MEDIUM',
      action: 'ESCALATE',
      escalationReason: `Hard constraint violations: ${hardViolations.map((v) => v.rule).join(', ')}`,
    };
  }

  // PHASE 2: COMPLETENESS
  const completenessViolations = validateOutcomeCompleteness(payload);
  const criticalCompleteness = completenessViolations.filter((v) => v.severity === 'CRITICAL');
  violations.push(...completenessViolations);
  if (criticalCompleteness.length > 0) {
    return {
      passed: false,
      outcome: payload.extractedFacts.outcome || 'UNCLEAR',
      violations,
      safetyScore: 0,
      carrierBlockRisk: 'LOW',
      action: 'ESCALATE',
      escalationReason: `Outcome completeness violations: ${criticalCompleteness.map((v) => v.rule).join(', ')}`,
    };
  }

  // PHASE 3: SAFETY RULES
  const { safetyScore, violations: safetyViolations } = validateSafetyRules(payload);
  violations.push(...safetyViolations);

  // PHASE 4: CARRIER BLOCK RISK
  let carrierBlockRisk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' = 'NONE';
  if (safetyScore >= 3) {
    carrierBlockRisk = 'HIGH';
  } else if (safetyScore >= 2) {
    carrierBlockRisk = 'MEDIUM';
  } else if (safetyScore >= 1) {
    carrierBlockRisk = 'LOW';
  }

  if (safetyScore >= 3 || carrierBlockRisk === 'HIGH') {
    return {
      passed: false,
      outcome: payload.extractedFacts.outcome || 'UNCLEAR',
      violations,
      safetyScore,
      carrierBlockRisk,
      action: 'ESCALATE',
      escalationReason: `Safety violations + carrier block risk: score=${safetyScore}, risk=${carrierBlockRisk}`,
    };
  }

  // ALL PASS
  return {
    passed: true,
    outcome: payload.extractedFacts.outcome || 'UNCLEAR',
    violations,
    safetyScore,
    carrierBlockRisk,
    action: 'PASS',
  };
}

/**
 * Webhook handler entry point
 */
export async function handleClaimsValidatorWebhook(
  req: Request,
  res: Response,
  prisma: PrismaClient,
): Promise<void> {
  try {
    if (!verifyValidatorAuth(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rawBody = req.body;
    const bodyStr = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
    const hash = bodyHash(Buffer.from(bodyStr));

    if (await isValidatorDuplicate(prisma, hash)) {
      res.status(200).json({ status: 'duplicate', message: 'Already processed' });
      return;
    }

    const payload: ValidatorWebhookPayload = rawBody;

    const attempt = await prisma.callAttempt.findUnique({
      where: { id: payload.callAttemptId },
      include: {
        claim: {
          select: {
            id: true,
            practiceId: true,
            claimNumber: true,
            carrierId: true,
            billedAmount: true,
          },
        },
      },
    });

    if (!attempt) {
      res.status(404).json({ error: 'CallAttempt not found' });
      return;
    }

    // RUN VALIDATION
    const result = await validateExtraction(prisma, payload, attempt.claim.claimNumber);

    // STORE RESULT
    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: {
        validationPassed: result.passed,
        validationResult: JSON.parse(JSON.stringify(result)),
      },
    });

    await markValidatorWebhookProcessed(prisma, hash);

    // IF FAILED: CREATE ESCALATION + NOTIFY
    if (!result.passed) {
      await createEscalation(prisma, {
        practiceId: attempt.claim.practiceId,
        claimId: attempt.claim.id,
        claimRef: attempt.claim.claimNumber,
        carrierId: attempt.claim.carrierId,
        amountClaimedCents: Math.round(Number(attempt.claim.billedAmount) * 100),
        reason: result.escalationReason || 'Validation failed',
        callAttemptId: attempt.id,
      });

      // NOTIFY PRACTICE
      try {
        await sendPracticeNotification(prisma, {
          practiceId: attempt.claim.practiceId,
          type: 'VALIDATION_ESCALATION',
          subject: `Claim ${attempt.claim.claimNumber}: Validation Issues`,
          message: `Claim validation detected issues requiring manual review. Reason: ${result.escalationReason}`,
          claimId: attempt.claim.id,
          severity: result.carrierBlockRisk === 'HIGH' ? 'critical' : 'warning',
        });
      } catch (notifErr) {
        console.error('[validator-webhook] Practice notification failed (non-fatal):', notifErr);
      }

      res.status(200).json({
        status: 'escalated',
        reason: result.escalationReason,
        violations: result.violations,
      });
    } else {
      res.status(200).json({
        status: 'passed',
        outcome: result.outcome,
        safetyScore: result.safetyScore,
      });
    }
  } catch (err) {
    console.error('[validator-webhook] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
