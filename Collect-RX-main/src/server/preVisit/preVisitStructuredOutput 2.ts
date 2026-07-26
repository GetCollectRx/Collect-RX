/**
 * Zod schema for pre-visit VAPI structured outputs.
 * Matches fields in tests/fixtures/preVisitWebhooks.ts and vapi-previsit-config.json.
 */
import { z } from 'zod';

const statusEnum = z.enum(['approved', 'denied', 'pending', 'unknown']);
const eligibilityEnum = z.enum(['eligible', 'ineligible', 'unknown']);

export const preVisitStructuredDataSchema = z
  .object({
    predetermination_status: statusEnum.optional(),
    predet_status: statusEnum.optional(),
    predeterminationStatus: statusEnum.optional(),
    eligibility_status: eligibilityEnum.optional(),
    eligibilityStatus: eligibilityEnum.optional(),
    reason_code: z.string().optional(),
    denial_reason: z.string().optional(),
    denial_reason_text: z.string().optional(),
    outcome: z.string().optional(),
    claim_ref: z.string().optional(),
    predetermination_ref: z.string().optional(),
    procedure_code: z.string().optional(),
    is_appealable: z.union([z.boolean(), z.string()]).optional(),
    practice_id: z.string().optional(),
    patient_token: z.string().optional(),
    carrier_code: z.string().optional(),
  })
  .passthrough();

export type PreVisitStructuredData = z.infer<typeof preVisitStructuredDataSchema>;

export interface ParsedPreVisitStructured {
  predetStatus: string | null;
  eligibilityStatus: string | null;
  denialCode: string | null;
  denialText: string | null;
  valid: boolean;
  parseWarnings: string[];
}

export function parsePreVisitStructuredData(
  raw: unknown,
): ParsedPreVisitStructured {
  const result = preVisitStructuredDataSchema.safeParse(raw);
  if (!result.success) {
    return {
      predetStatus: null,
      eligibilityStatus: null,
      denialCode: null,
      denialText: null,
      valid: false,
      parseWarnings: result.error.issues.map((i) => i.message),
    };
  }

  const sd = result.data;
  return {
    predetStatus:
      sd.predetermination_status ??
      sd.predet_status ??
      sd.predeterminationStatus ??
      null,
    eligibilityStatus:
      sd.eligibility_status ?? sd.eligibilityStatus ?? null,
    denialCode: sd.reason_code ?? sd.denial_reason ?? null,
    denialText: sd.denial_reason_text ?? null,
    valid: true,
    parseWarnings: [],
  };
}

/** JSON schema fragment for VAPI dashboard structured output configuration. */
export const PRE_VISIT_STRUCTURED_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['outcome'],
  properties: {
    outcome: { type: 'string', enum: ['APPROVED', 'DENIED', 'PENDING', 'NO_ANSWER', 'FAILED'] },
    predetermination_status: { type: 'string', enum: ['approved', 'denied', 'pending', 'unknown'] },
    eligibility_status: { type: 'string', enum: ['eligible', 'ineligible', 'unknown'] },
    reason_code: { type: 'string' },
    denial_reason_text: { type: 'string' },
    claim_ref: { type: 'string' },
    predetermination_ref: { type: 'string' },
    procedure_code: { type: 'string' },
    is_appealable: { type: 'string', enum: ['true', 'false'] },
    practice_id: { type: 'string' },
    patient_token: { type: 'string' },
    carrier_code: { type: 'string' },
  },
} as const;
