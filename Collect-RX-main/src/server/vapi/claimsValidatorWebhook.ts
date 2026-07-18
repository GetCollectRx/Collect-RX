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
import { runWithRlsBypass } from '../db/rlsContext.js';

export interface ValidatorExtractedFacts {
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
}

export interface ValidatorWebhookPayload {
  callAttemptId: string;
  transcript: string;
  extractedFacts: ValidatorExtractedFacts;
}

/**
 * Coerce analysisPlan.structuredDataPlan output (untyped JSON) into the
 * validator's fact shape. Non-string values for known string fields are
 * dropped rather than stringified so completeness checks stay meaningful.
 */
export function coerceExtractedFacts(sd: Record<string, unknown>): ValidatorExtractedFacts {
  const facts: ValidatorExtractedFacts = {
    claimNumber: typeof sd.claimNumber === 'string' ? sd.claimNumber : '',
  };
  for (const [key, value] of Object.entries(sd)) {
    if (key === 'claimNumber') continue;
    if (typeof value === 'string' && value.length > 0) facts[key] = value;
    else if (typeof value === 'boolean') facts[key] = value;
  }
  return facts;
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

  // CLAIM NUMBER MATCH — normalized: voice transcription mangles separators and
  // leading zeros ("CLM-001" → "CLM minus 1" → "CLM-1"), so compare alphanumerics
  // with digit runs stripped of leading zeros.
  const normalizeClaimNumber = (s: string): string =>
    s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0+(\d)/g, '$1');
  if (normalizeClaimNumber(payload.extractedFacts.claimNumber) !== normalizeClaimNumber(originalClaimNumber)) {
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
    PARTIAL_PAYMENT: ['paymentAmount', 'paymentDate', 'shortfallReason'],
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

export type ClaimsValidationOutcome =
  | { status: 'not_found' }
  | { status: 'passed' | 'escalated'; result: ValidationResult };

/**
 * When the carrier gave a submission deadline, stamp it (and the overdue-sweep
 * trigger) onto the open practice-facing recovery action for this claim so
 * escalateOverdueRecoveryActions() can enforce it.
 */
async function applyDeadlineFromFacts(
  prisma: PrismaClient,
  claimId: string,
  facts: ValidatorExtractedFacts,
): Promise<void> {
  if (typeof facts.submissionDeadline !== 'string') return;
  const parsed = Date.parse(facts.submissionDeadline);
  if (!Number.isFinite(parsed)) return;
  const deadline = new Date(parsed);

  await prisma.claimRecoveryAction.updateMany({
    where: {
      claimId,
      status: { in: ['OPEN', 'BLOCKING'] },
      actionType: { in: ['PRACTICE_DOCS', 'PRACTICE_RESUBMIT'] },
      clearedAt: null,
      deadline: null,
    },
    data: { deadline, autoEscalateAt: deadline },
  });
}

/**
 * Core async validation — callable from the webhook route and directly from
 * the end-of-call-report path in src/webhooks/vapi.ts. Stores the result on
 * the CallAttempt; on failure creates an escalation and notifies the practice.
 */
export async function runClaimsValidation(
  prisma: PrismaClient,
  input: ValidatorWebhookPayload,
): Promise<ClaimsValidationOutcome> {
  const attempt = await prisma.callAttempt.findUnique({
    where: { id: input.callAttemptId },
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

  if (!attempt) return { status: 'not_found' };

  const result = await validateExtraction(prisma, input, attempt.claim.claimNumber);

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: {
      validationPassed: result.passed,
      validationResult: JSON.parse(JSON.stringify(result)),
    },
  });

  try {
    await applyDeadlineFromFacts(prisma, attempt.claim.id, input.extractedFacts);
  } catch (deadlineErr) {
    console.error('[validator] deadline stamping failed (non-fatal):', deadlineErr);
  }

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
      console.error('[validator] Practice notification failed (non-fatal):', notifErr);
    }

    return { status: 'escalated', result };
  }

  return { status: 'passed', result };
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

    // Authenticated by a shared validator secret, not a practice session — no
    // RLS context exists, so every tenant-table read/write below must run under
    // an explicit bypass or it silently touches zero rows under enforced RLS.
    const result = await runWithRlsBypass(async () => {
      if (await isValidatorDuplicate(prisma, hash)) {
        return { kind: 'duplicate' as const };
      }
      const payload: ValidatorWebhookPayload = rawBody;
      const outcome = await runClaimsValidation(prisma, payload);
      if (outcome.status === 'not_found') {
        return { kind: 'not_found' as const };
      }
      await markValidatorWebhookProcessed(prisma, hash);
      return { kind: 'processed' as const, outcome };
    });

    if (result.kind === 'duplicate') {
      res.status(200).json({ status: 'duplicate', message: 'Already processed' });
      return;
    }
    if (result.kind === 'not_found') {
      res.status(404).json({ error: 'CallAttempt not found' });
      return;
    }
    const { outcome } = result;

    if (outcome.status === 'escalated') {
      res.status(200).json({
        status: 'escalated',
        reason: outcome.result.escalationReason,
        violations: outcome.result.violations,
      });
    } else {
      res.status(200).json({
        status: 'passed',
        outcome: outcome.result.outcome,
        safetyScore: outcome.result.safetyScore,
      });
    }
  } catch (err) {
    console.error('[validator-webhook] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
