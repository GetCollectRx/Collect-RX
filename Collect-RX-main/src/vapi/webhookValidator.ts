/**
 * Vapi webhook payload validation (Zod schemas).
 *
 * CRITICAL: Webhook payloads must be strictly validated before processing.
 * Missing or malformed fields could cause crashes or incorrect claim routing.
 *
 * This validator is the single entry point for all webhook parsing.
 */

import { z } from 'zod';

// Structured analysis output from the voice model (optional end-of-call signals)
const collectrxWebhookStructuredSchema = z.object({
  schemaVersion: z.literal(1),
  callOutcome: z.string().optional(),
  outcomeDetail: z.string().optional(),
  claimStatus: z.string().optional(),
  carrierBlockDetected: z.boolean().optional(),
});

// Metadata forwarded from call initiation to webhook
const vapiCallMetadataSchema = z.object({
  claimId: z.string().optional(),
  carrierId: z.string(),
  patientToken: z.string(),
  practiceId: z.string(),
  appointmentVerificationId: z.string().optional(),
  preVisitType: z.enum(['eligibility', 'cdcp_predet']).optional(),
  cdcpContext: z.boolean().optional(),
  collectrx: collectrxWebhookStructuredSchema.optional(),
});

// Call object with id as required field (most critical)
const vapiCallSchema = z.object({
  id: z.string().min(1, 'call.id is required'),
  status: z.string(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  durationSeconds: z.number().optional(),
});

// Analysis results (optional, from structured data plan)
const vapiAnalysisSchema = z.object({
  summary: z.string().optional(),
  successEvaluation: z.string().optional(),
  collectrx: collectrxWebhookStructuredSchema.optional(),
  structuredData: z.record(z.unknown()).optional(),
});

// Main webhook payload schema
export const vapiWebhookPayloadSchema = z.object({
  type: z.enum(['call.started', 'call.ended', 'call.failed', 'transcript', 'status-update']),
  call: vapiCallSchema,
  transcript: z.string().optional(),
  recordingUrl: z.string().url().optional(),
  metadata: vapiCallMetadataSchema.optional(),
  analysis: vapiAnalysisSchema.optional(),
});

export type VapiWebhookPayloadValidated = z.infer<typeof vapiWebhookPayloadSchema>;

/**
 * Parse and validate a webhook payload. Throws if validation fails.
 * Use this as the single entry point for all webhook processing.
 */
export function validateVapiWebhookPayload(data: unknown): VapiWebhookPayloadValidated {
  try {
    return vapiWebhookPayloadSchema.parse(data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      throw new Error(`[Vapi webhook validation] ${issues}`);
    }
    throw err;
  }
}

/**
 * Safe validation that returns error detail for logging/diagnostics.
 * Use this if you need to return HTTP 400 without throwing.
 */
export function validateVapiWebhookPayloadSafe(
  data: unknown,
): { valid: true; payload: VapiWebhookPayloadValidated } | { valid: false; error: string } {
  try {
    const payload = vapiWebhookPayloadSchema.parse(data);
    return { valid: true, payload };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      return { valid: false, error: issues || 'Validation failed' };
    }
    if (err instanceof Error) {
      return { valid: false, error: err.message };
    }
    return { valid: false, error: 'Unknown validation error' };
  }
}
