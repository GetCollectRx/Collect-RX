import { piiVault } from '../pii-vault';
import { Violation } from './types';
import rulesJson from './rules.json';
import { writeAuditLog } from './audit';

const RULES = rulesJson;

export interface ValidateDispatchParams {
  practiceId: string;
  carrierId: string;
  daysOutstanding: number;
  attemptsSoFar: number;
  claimStatus: string;
  scheduledFor: Date;
}

// Lightweight check: validate that the PHI token is still valid in the vault
export async function checkPhiToken(patientToken: string | null): Promise<Violation | null> {
  if (!patientToken) {
    return {
      rule_id: 'PRE_DISPATCH_PHI_TOKENIZED',
      severity: 'block',
      evidence: 'Patient token is null',
    };
  }

  const tokenOk = piiVault.isValid(patientToken);
  if (!tokenOk) {
    return {
      rule_id: 'PRE_DISPATCH_PHI_TOKENIZED',
      severity: 'block',
      evidence: `Patient token is invalid or expired`,
    };
  }

  return null;
}

// Non-blocking guardrail check: can be called at any pre-dispatch point
// to add a PHI token validity check before the main validateDispatch logic
export async function writeDispatchAudit(
  claimId: string,
  patientToken: string | null,
  decision: { allowed: boolean; reason?: string },
  practiceId: string,
): Promise<void> {
  const tokenViolation = await checkPhiToken(patientToken);

  const violations: Violation[] = [];
  if (tokenViolation) {
    violations.push(tokenViolation);
  }

  if (!decision.allowed) {
    violations.push({
      rule_id: 'PRE_DISPATCH_VALIDATION_FAILED',
      severity: 'block',
      evidence: decision.reason || 'Dispatch validation failed',
    });
  }

  await writeAuditLog({
    action: 'GUARDRAIL_PRE_DISPATCH',
    subjectType: 'InsuranceClaim',
    subjectId: claimId,
    details: {
      allowed: decision.allowed && !tokenViolation,
      violations,
      rulesVersion: RULES.version,
    },
    rulesVersion: RULES.version,
    practiceId,
  });
}
