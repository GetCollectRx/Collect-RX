// ─────────────────────────────────────────────────
// CollectRx: payer-program activation (DEC-10)
//
// Which funding programs the carrier-call workflow may dial. This is policy,
// kept as one typed table so the activation matrix (spec 4.5) can later move to
// data without touching dispatch. Every dispatch path reads it through
// validateDispatch(), so enforcement does not depend on any rollout flag.
//
// A claim with no payerType predates classification. It is treated as PRIVATE
// (the only program calls were ever placed for) and reported as `assumed`, so
// callers can surface the assumption instead of hiding it.
// ─────────────────────────────────────────────────

import type { PayerType } from '@prisma/client';

export interface PayerProgramRule {
  enabled: boolean;
  /** Policy reference from the activation matrix (spec 4.5). */
  policyRef: string;
  /** Shown to staff when the program is not enabled. */
  blockedReason: string;
}

export const PAYER_PROGRAM_ACTIVATION: Readonly<Record<PayerType, PayerProgramRule>> = {
  PRIVATE: {
    enabled: true,
    policyRef: 'LP-1',
    blockedReason: '',
  },
  CDCP: {
    enabled: false,
    policyRef: 'LP-4 / DEC-10',
    blockedReason:
      'CDCP claims are not dialed by the carrier-call workflow until the payer confirms in writing that agent calls are acceptable.',
  },
  PROVINCIAL: {
    enabled: false,
    policyRef: 'LP-5',
    blockedReason:
      'Provincial program claims have no verified call route and are not dialed by the carrier-call workflow.',
  },
};

export interface PayerProgramDecision {
  enabled: boolean;
  /** The program the decision was made on (PRIVATE when the claim has none). */
  effectivePayerType: PayerType;
  /** True when the claim had no payerType and PRIVATE was assumed. */
  assumed: boolean;
  policyRef: string;
  reason?: string;
}

export function evaluatePayerProgram(payerType: PayerType | null | undefined): PayerProgramDecision {
  const assumed = payerType === null || payerType === undefined;
  const effectivePayerType: PayerType = assumed ? 'PRIVATE' : payerType;
  const rule = PAYER_PROGRAM_ACTIVATION[effectivePayerType];
  return {
    enabled: rule.enabled,
    effectivePayerType,
    assumed,
    policyRef: rule.policyRef,
    ...(rule.enabled ? {} : { reason: rule.blockedReason }),
  };
}
