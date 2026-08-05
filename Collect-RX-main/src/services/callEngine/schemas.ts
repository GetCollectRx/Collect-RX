// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Polymorphic Carrier Adjudication Schema
//
// Each Canadian carrier's reps phrase claim status differently on a call —
// "the claim has been processed and payment issued" (Sun Life) reads very
// differently from "adjudication complete, EFT on file" (Manulife) — but the
// AR ledger write-back needs one fixed shape. This module is the choke point:
// every carrier-specific parser funnels into `adjudicationPayloadSchema`, and
// nothing reaches `writeAdjudicationEvent`/EmrSyncOutbox without passing
// `.parse()` first.
//
// Per CLAUDE.md's "carrier rules are data, not code" principle, the denial-
// phrase → code tables below are the only carrier-specific logic — adding a
// carrier means adding a table entry, not a new code path. Carrier IDs and
// display names are read from the same `carrier-configs.json` the eligibility
// engine uses (`../eligibility/rules/carrier-configs.json`), so the two
// systems can't drift out of sync on what carriers exist.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import type { CarrierId } from '@prisma/client';
import carrierRulesJson from '../eligibility/rules/carrier-configs.json';
import type { TelephonyExtraction } from './telephonyParser';

type CarrierRules = { carriers: Record<string, { carrierId: string; name: string }> };
const CARRIER_RULES = carrierRulesJson as unknown as CarrierRules;

export const CARRIER_IDS = Object.keys(CARRIER_RULES.carriers) as CarrierId[];

export function carrierDisplayName(carrierId: CarrierId): string {
  return CARRIER_RULES.carriers[carrierId]?.name ?? carrierId;
}

// ---------------------------------------------------------------------------
// Standardized output schema
// ---------------------------------------------------------------------------

export const adjudicationStatusSchema = z.enum(['PAID', 'DENIED', 'PENDING']);
export type AdjudicationStatus = z.infer<typeof adjudicationStatusSchema>;

export const adjudicationPayloadSchema = z.object({
  carrier: z.enum(CARRIER_IDS as [CarrierId, ...CarrierId[]]),
  /** UUID — `InsuranceClaim.id`, never the practice's raw claim number and never PHI. */
  claim_id_token: z.string().uuid(),
  adjudication_status: adjudicationStatusSchema,
  /** Required when adjudication_status is DENIED; null otherwise. */
  denial_reason_code: z.string().nullable(),
  amount_covered_cents: z.number().int().nonnegative(),
});

export type AdjudicationPayload = z.infer<typeof adjudicationPayloadSchema>;

/** Validate before any sync tool writes to a practice ledger (Abeldent or otherwise). */
export function assertValidAdjudicationPayload(payload: unknown): AdjudicationPayload {
  return adjudicationPayloadSchema.parse(payload);
}

// ---------------------------------------------------------------------------
// Per-carrier denial phrase -> code tables (data, not code)
//
// Codes are CollectRx-internal, stable identifiers — not vendor codes, since
// carriers don't expose machine-readable denial codes over a voice call.
// ---------------------------------------------------------------------------

interface DenialRule {
  code: string;
  pattern: RegExp;
}

const DENIAL_RULES: Record<CarrierId, DenialRule[]> = {
  sun_life: [
    { code: 'ANNUAL_MAX_REACHED', pattern: /annual\s+maximum|benefit\s+limit\s+reached/i },
    { code: 'NOT_ELIGIBLE', pattern: /not\s+eligible|not\s+a\s+covered\s+service/i },
    { code: 'DOCS_REQUIRED', pattern: /documentation\s+required|radiograph|x-ray/i },
  ],
  canada_life: [
    { code: 'ANNUAL_MAX_REACHED', pattern: /maximum\s+has\s+been\s+reached|exceeds\s+plan\s+maximum/i },
    { code: 'WAITING_PERIOD', pattern: /waiting\s+period/i },
    { code: 'NOT_ELIGIBLE', pattern: /not\s+covered\s+under\s+this\s+plan/i },
  ],
  manulife: [
    { code: 'FREQUENCY_LIMIT', pattern: /frequency\s+limit|too\s+soon\s+since\s+last/i },
    { code: 'ANNUAL_MAX_REACHED', pattern: /annual\s+max|plan\s+maximum\s+reached/i },
    { code: 'DOCS_REQUIRED', pattern: /clinical\s+notes|supporting\s+documentation/i },
  ],
  green_shield: [
    { code: 'NOT_ELIGIBLE', pattern: /not\s+an\s+eligible\s+expense|excluded\s+service/i },
    { code: 'COB_REQUIRED', pattern: /coordination\s+of\s+benefits|other\s+insurance\s+on\s+file/i },
  ],
  rbc: [
    { code: 'ANNUAL_MAX_REACHED', pattern: /annual\s+limit|maximum\s+benefit\s+used/i },
    { code: 'NOT_ELIGIBLE', pattern: /not\s+a\s+covered\s+benefit/i },
  ],
  telus_adjudicare: [
    { code: 'TPA_ROUTING_REQUIRED', pattern: /wrong\s+(?:plan|carrier)|routed\s+to\s+(?:the\s+)?underlying\s+insurer/i },
    { code: 'ANNUAL_MAX_REACHED', pattern: /annual\s+maximum|plan\s+maximum/i },
    { code: 'NOT_ELIGIBLE', pattern: /not\s+eligible|not\s+covered/i },
  ],
};

const PAID_SIGNAL = /payment\s+(?:issued|sent|processed)|claim\s+(?:has\s+been\s+)?paid|eft\s+(?:sent|processed)|cheque\s+mailed/i;
const PENDING_SIGNAL = /still\s+(?:in\s+)?process|currently\s+being\s+(?:reviewed|adjudicated)|not\s+yet\s+finalized/i;

function classifyDenialCode(carrierId: CarrierId, text: string): string | null {
  for (const rule of DENIAL_RULES[carrierId]) {
    if (rule.pattern.test(text)) return rule.code;
  }
  return null;
}

function classifyStatus(text: string, denialCode: string | null): AdjudicationStatus {
  if (denialCode) return 'DENIED';
  if (PAID_SIGNAL.test(text)) return 'PAID';
  if (PENDING_SIGNAL.test(text)) return 'PENDING';
  return 'PENDING';
}

// ---------------------------------------------------------------------------
// Carrier-agnostic parse entry point
//
// Combines `telephonyParser.ts`'s structural extraction (dollar figures) with
// this module's carrier-specific denial-phrase classification, then validates
// the result. Callers supply `claimIdToken` (the InsuranceClaim UUID) — this
// module never mints or resolves tokens itself.
// ---------------------------------------------------------------------------

export function parseCarrierAdjudication(
  carrierId: CarrierId,
  claimIdToken: string,
  transcriptText: string,
  extraction: TelephonyExtraction,
): AdjudicationPayload {
  const denialCode = classifyDenialCode(carrierId, transcriptText);
  const status = classifyStatus(transcriptText, denialCode);

  const covered = extraction.financialMentions.find((m) => m.label === 'covered');
  const amountCoveredCents = status === 'PAID' ? (covered?.amountCents ?? 0) : 0;

  const payload: AdjudicationPayload = {
    carrier: carrierId,
    claim_id_token: claimIdToken,
    adjudication_status: status,
    denial_reason_code: denialCode,
    amount_covered_cents: amountCoveredCents,
  };

  return assertValidAdjudicationPayload(payload);
}
