// ─────────────────────────────────────────────────────────────────────────────
// CollectRx AR Engine — Polymorphic Carrier Adjudication Schema
//
// Every carrier reports claim status differently over the phone. Before any
// sync tool (e.g. the AbelDent connector, `desktop/services/abeldent-sync.cjs`)
// writes an adjudication result back to a practice's ledger, that result must
// be normalized into one locked, validated shape. This module owns that
// shape and its per-carrier normalizers.
//
// `CarrierId` is duplicated here (not imported from `@prisma/client`) on
// purpose: this schema is the edge-validation contract for data arriving
// from voice/transcript extraction, which must be checked before it is known
// to be trustworthy enough to touch the DB layer. Keep the two enums in
// lockstep by hand — CI's typecheck will not catch drift between them, so a
// carrier added to `prisma/schema.prisma` must be added here too (see
// "Adding a new carrier" in CLAUDE.md).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { isValidPatientToken } from './tokenizer.js';

export const CARRIER_IDS = [
  'sun_life',
  'canada_life',
  'manulife',
  'green_shield',
  'rbc',
  'telus_adjudicare',
] as const;

export const CarrierIdSchema = z.enum(CARRIER_IDS);
export type CarrierIdLiteral = z.infer<typeof CarrierIdSchema>;

export const ADJUDICATION_STATUSES = ['PAID', 'DENIED', 'PENDING'] as const;
export const AdjudicationStatusSchema = z.enum(ADJUDICATION_STATUSES);
export type AdjudicationStatus = z.infer<typeof AdjudicationStatusSchema>;

/**
 * The locked write-back contract. Field names are snake_case to match the
 * wire shape carrier-facing tools and the PMS sync layer expect, distinct
 * from this codebase's camelCase TypeScript convention elsewhere.
 */
export const CarrierAdjudicationPayloadSchema = z.object({
  carrier: CarrierIdSchema,
  claim_id_token: z.string().refine(isValidPatientToken, {
    message: 'claim_id_token must be a UUID token — raw claim identifiers never enter this schema',
  }),
  adjudication_status: AdjudicationStatusSchema,
  denial_reason_code: z.string().trim().min(1).nullable(),
  amount_covered_cents: z.number().int().nonnegative(),
});

export type CarrierAdjudicationPayload = z.infer<typeof CarrierAdjudicationPayloadSchema>;

export class LockedPayloadValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super(
      `[schemas] Carrier adjudication payload failed validation — refusing write-back: ${issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
    this.name = 'LockedPayloadValidationError';
  }
}

/**
 * Parse + freeze a payload as the "locked" contract handed to a sync tool.
 * Freezing is a cheap correctness signal (any accidental post-validation
 * mutation throws in strict mode) — validation itself is what makes the
 * payload trustworthy, freezing just keeps it that way.
 */
export function assertLockedAdjudicationPayload(payload: unknown): Readonly<CarrierAdjudicationPayload> {
  const result = CarrierAdjudicationPayloadSchema.safeParse(payload);
  if (!result.success) {
    throw new LockedPayloadValidationError(result.error.issues);
  }
  return Object.freeze(result.data);
}

// ---------------------------------------------------------------------------
// Per-carrier normalization
// ---------------------------------------------------------------------------

/**
 * Minimal, source-agnostic signal set a normalizer needs. Deliberately not
 * `ProcessedOutcome` from `src/outcome/processor.ts` — that type carries
 * fields (transcript URLs, rep names) irrelevant to the ledger write-back
 * contract, and coupling this schema to that module's shape would make an
 * unrelated change there a breaking change here.
 */
export interface AdjudicationSourceSignals {
  claimIdToken: string;
  /** Coarse outcome — RESOLVED/DENIED/PENDING/... from the outcome processor, or an equivalent. */
  outcome: string;
  denialReasonCode?: string | null;
  /** From `telephonyParser.extractFinancialTotals` — the "covered" labelled amount, if any. */
  coveredAmountCents?: number | null;
}

function defaultAdjudicationStatus(outcome: string): AdjudicationStatus {
  const normalized = outcome.toUpperCase();
  if (normalized === 'RESOLVED') return 'PAID';
  if (normalized === 'DENIED') return 'DENIED';
  return 'PENDING';
}

/**
 * Generic normalizer used by every carrier unless overridden below. Carriers
 * do report differently in practice, but until a carrier-specific quirk is
 * observed and confirmed in production transcripts, inventing one here would
 * be a fabricated business rule — the override hook exists precisely so a
 * real quirk can be added without touching the schema.
 */
export function normalizeAdjudication(
  carrier: CarrierIdLiteral,
  signals: AdjudicationSourceSignals,
): CarrierAdjudicationPayload {
  const candidate = {
    carrier,
    claim_id_token: signals.claimIdToken,
    adjudication_status: defaultAdjudicationStatus(signals.outcome),
    denial_reason_code: signals.denialReasonCode?.trim() || null,
    amount_covered_cents: Math.max(0, Math.round(signals.coveredAmountCents ?? 0)),
  };
  return assertLockedAdjudicationPayload(candidate) as CarrierAdjudicationPayload;
}

export type CarrierAdjudicationParser = (signals: AdjudicationSourceSignals) => CarrierAdjudicationPayload;

/**
 * Per-carrier override registry. All six carriers default to the generic
 * normalizer today — see the comment on `normalizeAdjudication` for why.
 */
export const CARRIER_ADJUDICATION_PARSERS: Record<CarrierIdLiteral, CarrierAdjudicationParser> =
  Object.fromEntries(
    CARRIER_IDS.map((carrier) => [
      carrier,
      (signals: AdjudicationSourceSignals) => normalizeAdjudication(carrier, signals),
    ]),
  ) as Record<CarrierIdLiteral, CarrierAdjudicationParser>;

export function parseCarrierAdjudication(
  carrier: CarrierIdLiteral,
  signals: AdjudicationSourceSignals,
): CarrierAdjudicationPayload {
  return CARRIER_ADJUDICATION_PARSERS[carrier](signals);
}

export const schemas = {
  CarrierIdSchema,
  AdjudicationStatusSchema,
  CarrierAdjudicationPayloadSchema,
  assertLockedAdjudicationPayload,
  parseCarrierAdjudication,
} as const;

export default schemas;
