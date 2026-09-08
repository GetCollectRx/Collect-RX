// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Vapi Client
//
// Thin wrapper around the Vapi REST API.
//
// PHI ARCHITECTURE — read this before touching initiateCall():
//
//   PHI is sent to Vapi as EPHEMERAL CALL VARIABLES ONLY.
//   It is never stored in: DB tables, system prompt config, logs, metadata,
//   or any persistent store. The flow is:
//
//     1. CSV import → piiVault.tokenize(PatientPHI) → UUID token stored in DB
//     2. Queue dispatch → piiVault.detokenize(token) → real PHI in memory only
//     3. initiateCall() → PHI injected as Vapi call `variables` (ephemeral)
//     4. Vapi agent uses PHI to identify claim to carrier rep during the call
//     5. Call ends → recording deleted (handlePostCallAudioDeletion)
//     6. Transcript PHI-scrubbed before persisting to DB
//
//   patientToken UUID remains in Vapi `metadata` as the primary key linking
//   the Vapi call back to the CollectRx DB — it is never real PHI.
//
//   Khalid (the operator) never sees PHI. The voice agent does, only during
//   the live call. Nothing is stored. This is the PHIPA/PIPEDA boundary.
//
// The squad model:
//   IVR_Navigator → Claims_Agent → Escalation_Closer / Resolution_Closer
//
// Required env vars:
//   VAPI_API_KEY          — Vapi private API key
//   VAPI_SQUAD_ID         — pre-configured squad ID in Vapi dashboard (post-visit recovery)
//   VAPI_PREVISIT_SQUAD_ID — optional separate squad for pre-visit calls (falls back to VAPI_SQUAD_ID)
//   VAPI_PHONE_NUMBER_ID  — Twilio number registered in Vapi
// ─────────────────────────────────────────────────────────────────────────────

import { CarrierId } from '@prisma/client';
import { CALL_TIMEOUTS, CARRIER_TIMEOUTS } from '../billing/tiers.js';
import { vapiCircuitBreaker } from './circuitBreaker.js';

/**
 * Hard call-length ceiling sent to Vapi (assistantOverrides.maxDurationSeconds
 * — Vapi's default is 600s, so it must be set explicitly). Carrier hold-time
 * overrides apply below the absolute 45-min ceiling, never above it.
 */
export function maxCallDurationSeconds(carrierId: string): number {
  const carrierMinutes = CARRIER_TIMEOUTS[carrierId] ?? CARRIER_TIMEOUTS.default;
  return Math.min(carrierMinutes, CALL_TIMEOUTS.absoluteMaxMinutes) * 60;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VapiCallParams {
  claimId: string;
  carrierId: CarrierId;
  practiceId: string;
  /**
   * UUID from PIIVault — primary key linking this Vapi call to CollectRx DB.
   * Passed in Vapi metadata only. Never used as a PHI carrier.
   */
  patientToken: string;
  // ─── PHI fields — sourced exclusively from piiVault.detokenize() ───────────
  // These are injected as ephemeral Vapi call variables (not stored anywhere).
  // Caller (queueEngine, insurance.ts) MUST detokenize before calling here.
  patientName: string;
  patientDob: string;           // ISO date YYYY-MM-DD
  policyNumber: string;
  subscriberName?: string;
  /** ISO date YYYY-MM-DD — required when relationship !== 'self' for some carriers. */
  subscriberDob?: string;
  relationship?: string;        // e.g. "self", "spouse", "dependent"
  // ─── Claim fields ────────────────────────────────────────────────────────────
  carrierPhone: string;
  claimNumber: string;
  groupNumber?: string;
  /** ISO date string — maps to InsuranceClaim.servicedAt */
  treatmentDate?: string;
  /** ISO date string — maps to InsuranceClaim.submittedAt */
  claimSubmittedDate?: string;
  daysOutstanding: number;
  billedAmount: number;
  /** What the practice expected the carrier to pay — maps to InsuranceClaim.expectedAmount */
  amountExpected?: number;
  outstandingAmount: number;
  /** CDT codes string — maps to InsuranceClaim.treatmentCodes */
  treatmentCodes?: string;
  // ─── Practice identity ───────────────────────────────────────────────────────
  practiceName: string;
  /** Provincial college registration / billing number (Canadian NPI equivalent). */
  practiceNpi?: string;
  /** HST/GST business registration number. */
  practiceTaxId?: string;
  /** Practice mailing address — some carriers ask for this during identity verification. */
  practiceAddress?: string;
  providerNumber: string;
  /** Billing/claims phone line read in CRTC disclosure and given as carrier callback. */
  practicePhone: string;
  /** Language for IVR navigation and rep interactions — 'en' | 'fr'. Default 'en'. */
  languagePreference?: 'en' | 'fr';
  carrierIvrInstructions?: string;
  /** Known resubmission channel from prior confirmed calls (Scenario A) — see submissionChannelMemory.ts. */
  knownResubmissionChannel?: string;
  /** Known documentation-submission channel from prior confirmed calls (Scenario D) — see submissionChannelMemory.ts. */
  knownDocumentationChannel?: string;
  /**
   * Stable per-attempt key (e.g. `${claimId}:${attemptNumber}`) — sent as the
   * Idempotency-Key header so a retry of the *same* attempt (after a timeout
   * whose outcome is unknown) can't create a second outbound call to the
   * carrier for that attempt. Optional so existing callers don't break;
   * callers that dispatch real carrier calls should always pass one.
   */
  idempotencyKey?: string;
}

export interface VapiCallResult {
  vapiCallId: string;
  status: 'queued' | 'ringing' | 'in-progress' | 'completed' | 'failed';
  createdAt: string;
}

export interface VapiCallStatus {
  vapiCallId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  recordingUrl: string | null;
}

export interface VapiWebhookPayload {
  type:
    | 'call.started'
    | 'call.ended'
    | 'call.failed'
    | 'transcript'
    | 'status-update';
  call: {
    id: string;
    status: string;
    startedAt?: string;
    endedAt?: string;
    durationSeconds?: number;
  };
  transcript?: string;
  recordingUrl?: string;
  /** CollectRx metadata forwarded from the call initiation payload */
  metadata?: VapiCallMetadata;
  analysis?: {
    summary?: string;
    successEvaluation?: string;
    /** Same shape as `metadata.collectrx` — post-call tools may write here */
    collectrx?: CollectrxWebhookStructured;
    /** analysisPlan.structuredDataPlan output — feeds the async claims validator */
    structuredData?: Record<string, unknown>;
  };
}

/** Optional structured end-of-call signal (preferred over transcript regex). */
export interface CollectrxWebhookStructured {
  schemaVersion: 1;
  callOutcome?: string;
  outcomeDetail?: string;
  claimStatus?: string;
  carrierBlockDetected?: boolean;
}

export interface VapiCallMetadata {
  claimId?: string;
  carrierId: string;
  patientToken: string;
  practiceId: string;
  appointmentVerificationId?: string;
  preVisitType?: 'eligibility' | 'cdcp_predet';
  cdcpContext?: boolean;
  collectrx?: CollectrxWebhookStructured;
}

// ---------------------------------------------------------------------------
// CARRIER_PHONE_MAP — direct-dial numbers for each carrier's claims line.
// Update if carriers change their numbers.
// ---------------------------------------------------------------------------

export const CARRIER_PHONE_MAP: Record<CarrierId, string> = {
  sun_life:          '+18009619356',
  canada_life:       '+18007240222',
  manulife:          '+18662122333',
  green_shield:      '+18882110644',
  rbc:               '+18003613311',
  telus_adjudicare:  '+18772893343',
};

/** CDCP Contact Centre — separate from Sun Life group benefits line. */
export const CDCP_CONTACT_CENTRE_PHONE = '+18888888110';

// ---------------------------------------------------------------------------
// Vapi HTTP client
// ---------------------------------------------------------------------------

// Overridable so test harnesses can point dispatch at a local mock instead of
// live Vapi. Production deployments leave this unset.
const VAPI_BASE_URL = (process.env.VAPI_BASE_URL || 'https://api.vapi.ai').replace(/\/$/, '');

function getApiKey(): string {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error('[VapiClient] VAPI_API_KEY environment variable is not set');
  return key;
}

function getSquadId(): string {
  const id = process.env.VAPI_SQUAD_ID;
  if (!id) throw new Error('[VapiClient] VAPI_SQUAD_ID environment variable is not set');
  return id;
}

function getPreVisitSquadId(): string {
  return process.env.VAPI_PREVISIT_SQUAD_ID?.trim() || getSquadId();
}

function getPhoneNumberId(): string {
  const id = process.env.VAPI_PHONE_NUMBER_ID;
  if (!id) throw new Error('[VapiClient] VAPI_PHONE_NUMBER_ID environment variable is not set');
  return id;
}

// A hung connection here would hang the queue-engine tick promise forever —
// the isTickRunning latch never releases and dispatch dies for all practices
// until restart. Every Vapi request must have a finite deadline.
const VAPI_HTTP_TIMEOUT_MS = Math.max(5_000, Number(process.env.VAPI_HTTP_TIMEOUT_MS || 30_000));

/**
 * Thrown when a Vapi request fails before we received any HTTP response —
 * a client-side timeout (AbortSignal) or a network-level failure (DNS,
 * connection reset, etc.). In this case Vapi may or may not have received
 * and processed the request; unlike a normal rejection (a response with a
 * non-2xx status, which means Vapi definitely did NOT create the call),
 * an ambiguous outcome must not be treated as safe to blindly retry —
 * callers should hold the dispatch slot rather than releasing it for an
 * immediate auto-retry that could dial the carrier twice.
 */
export class VapiAmbiguousOutcomeError extends Error {
  /**
   * The original fetch failure (TimeoutError/AbortError/etc.) this wraps.
   * vapiCircuitBreaker's failure-reason classifier reads this to tell a
   * timeout from a generic network error, which it can no longer do from
   * this wrapper's own .name alone. A plain property rather than the ES2022
   * Error `cause` option — this project's tsconfig lib is capped at ES2020.
   */
  readonly originalCause: unknown;

  constructor(method: string, path: string, cause: unknown) {
    super(
      `[VapiClient] ${method} ${path} — no response received (timeout or network failure); ` +
        `Vapi call may or may not have been created: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'VapiAmbiguousOutcomeError';
    this.originalCause = cause;
  }
}

async function vapiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
  options?: { idempotencyKey?: string },
): Promise<T> {
  return vapiCircuitBreaker.execute(async () => {
    const url = `${VAPI_BASE_URL}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${getApiKey()}`,
          'Content-Type': 'application/json',
          ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(VAPI_HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      // fetch() itself throwing means no response ever arrived — genuinely
      // ambiguous, as opposed to the !res.ok branch below where Vapi *did*
      // respond and told us definitively that nothing was created.
      throw new VapiAmbiguousOutcomeError(method, path, err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`[VapiClient] ${method} ${path} → ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initiate a Vapi squad call to a carrier's claims line.
 *
 * PHI CONTRACT: Caller must have already called piiVault.detokenize() and
 * must pass the resolved PatientPHI fields (patientName, patientDob,
 * policyNumber, subscriberName) here. These are injected as ephemeral
 * Vapi call variables — they are never stored, never logged, and deleted
 * from Vapi after the call via handlePostCallAudioDeletion().
 *
 * patientToken UUID goes in Vapi `metadata` only — it is the primary key
 * linking this Vapi call back to the CollectRx DB.
 */
export async function initiateCall(params: VapiCallParams): Promise<VapiCallResult> {
  const {
    claimId,
    carrierId,
    practiceId,
    patientToken,
    // PHI — resolved from piiVault.detokenize() by caller
    patientName,
    patientDob,
    policyNumber,
    subscriberName,
    subscriberDob,
    relationship,
    // Claim fields
    carrierPhone,
    claimNumber,
    groupNumber,
    treatmentDate,
    claimSubmittedDate,
    daysOutstanding,
    billedAmount,
    amountExpected,
    outstandingAmount,
    treatmentCodes,
    // Practice identity
    practiceName,
    practiceNpi,
    practiceTaxId,
    practiceAddress,
    providerNumber,
    practicePhone,
    languagePreference,
    carrierIvrInstructions,
    knownResubmissionChannel,
    knownDocumentationChannel,
    idempotencyKey,
  } = params;

  // Guard: only dial known carrier claims lines
  const allowedNumbers = new Set(
    Object.values(CARRIER_PHONE_MAP).map((n) => n.replace(/\D/g, '')),
  );
  const normalized = carrierPhone.replace(/\D/g, '');
  if (!allowedNumbers.has(normalized)) {
    throw new Error(
      `[VapiClient] Refusing outbound call — destination is not a known carrier claims line: ${carrierPhone}`,
    );
  }

  // metadata: UUID primary key only — no PHI ever in metadata
  const metadata: VapiCallMetadata = {
    claimId,
    carrierId,
    patientToken,   // UUID — links call to DB; never the real patient name/DOB
    practiceId,
  };

  const payload = {
    squadId: getSquadId(),
    phoneNumberId: getPhoneNumberId(),
    customer: {
      number: carrierPhone,
    },
    // Vapi's CreateCallDTO has no top-level variables/metadata/recordingEnabled —
    // those fields are silently dropped. Everything call-scoped must ride in
    // assistantOverrides, which Vapi applies to every squad member.
    assistantOverrides: {
      // Zero-retention: tell Vapi not to store the recording.
      // Belt-and-suspenders — handlePostCallAudioDeletion() also deletes it.
      artifactPlan: { recordingEnabled: false },
      maxDurationSeconds: maxCallDurationSeconds(carrierId),
      metadata,
      // ── EPHEMERAL CALL VARIABLES ──────────────────────────────────────────
      // These are injected into the squad system prompt at call time only.
      // They are never written to any DB table, never written to logs
      // (logger.js PHI_FIELD_NAMES scrubs them), and are not stored in the
      // system prompt config. When the call ends they cease to exist.
      // PHI boundary: PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY.
      variableValues: {
      // ── Patient identifiers — ephemeral, from piiVault.detokenize() ──────────
      patient_name:             patientName,
      patient_dob:              patientDob,
      policy_number:            policyNumber,
      subscriber_name:          subscriberName ?? '',
      subscriber_dob:           subscriberDob ?? '',
      relationship:             relationship ?? 'self',
      // ── Claim reference ───────────────────────────────────────────────────────
      claim_id:                 claimId,
      patient_token:            patientToken,
      insurance_carrier:        carrierId,
      claim_number:             claimNumber,
      group_number:             groupNumber ?? '',
      treatment_date:           treatmentDate ?? '',
      claim_submitted_date:     claimSubmittedDate ?? '',
      days_outstanding:         String(daysOutstanding),
      amount_billed:            billedAmount.toFixed(2),
      amount_expected:          (amountExpected ?? outstandingAmount).toFixed(2),
      outstanding_amount:       outstandingAmount.toFixed(2),
      treatment_codes:          treatmentCodes ?? '',
      // ── Practice identity — not PHI ───────────────────────────────────────────
      practice_name:            practiceName,
      practice_npi:             practiceNpi ?? '',
      practice_tax_id:          practiceTaxId ?? '',
      practice_address:         practiceAddress ?? '',
      provider_number:          providerNumber,
      // CRTC ADAD Part IV Rule 4 — identification within first 10 seconds.
      // practice_phone is the billing/claims line, NOT the staff escalation line.
      practice_phone:           practicePhone,
      language_preference:      languagePreference ?? 'en',
      // ── Carrier routing ───────────────────────────────────────────────────────
      carrierId,
      carrier_ivr_instructions: carrierIvrInstructions ?? '',
      known_resubmission_channel: knownResubmissionChannel ?? '',
      known_documentation_channel: knownDocumentationChannel ?? '',
      },
    },
  };

  const result = await vapiRequest<VapiCallResult & { id?: string }>('POST', '/call', payload, {
    idempotencyKey,
  });
  return {
    ...result,
    vapiCallId: result.vapiCallId ?? result.id ?? '',
  };
}

export interface VapiPreVisitCallParams {
  practiceId: string;
  patientToken: string;
  carrierId: CarrierId;
  appointmentVerificationId: string;
  preVisitType: 'eligibility' | 'cdcp_predet';
  cdcpContext?: boolean;
  patientName: string;
  patientDob: string;
  policyNumber: string;
  subscriberName?: string;
  subscriberDob?: string;
  procedureCodes: string[];
  appointmentAt: string;
  practiceName: string;
  providerNumber: string;
  practicePhone: string;
  languagePreference?: 'en' | 'fr';
  carrierIvrInstructions?: string;
  /** See VapiCallParams.idempotencyKey — same rationale, stable per dispatch attempt. */
  idempotencyKey?: string;
}

/**
 * Pre-appointment verification call — no claim context required.
 * CDCP predetermination checks dial the CDCP Contact Centre (1-888-888-8110).
 */
export async function initiatePreVisitCall(params: VapiPreVisitCallParams): Promise<VapiCallResult> {
  const carrierPhone = params.cdcpContext
    ? CDCP_CONTACT_CENTRE_PHONE
    : CARRIER_PHONE_MAP[params.carrierId];

  const allowedNumbers = new Set(
    [...Object.values(CARRIER_PHONE_MAP), CDCP_CONTACT_CENTRE_PHONE].map((n) => n.replace(/\D/g, '')),
  );
  const normalized = carrierPhone.replace(/\D/g, '');
  if (!allowedNumbers.has(normalized)) {
    throw new Error(`[VapiClient] Refusing pre-visit call — unknown destination: ${carrierPhone}`);
  }

  const metadata: VapiCallMetadata = {
    carrierId: params.carrierId,
    patientToken: params.patientToken,
    practiceId: params.practiceId,
    appointmentVerificationId: params.appointmentVerificationId,
    preVisitType: params.preVisitType,
    cdcpContext: params.cdcpContext === true,
  };

  const purpose =
    params.cdcpContext
      ? 'a CDCP predetermination status inquiry before a scheduled appointment'
      : 'an eligibility and coverage verification before a scheduled appointment';

  const payload = {
    squadId: getPreVisitSquadId(),
    phoneNumberId: getPhoneNumberId(),
    customer: { number: carrierPhone },
    assistantOverrides: {
      artifactPlan: { recordingEnabled: false },
      maxDurationSeconds: maxCallDurationSeconds(params.carrierId),
      metadata,
      variableValues: {
      patient_name: params.patientName,
      patient_dob: params.patientDob,
      policy_number: params.policyNumber,
      subscriber_name: params.subscriberName ?? '',
      subscriber_dob: params.subscriberDob ?? '',
      procedure_codes: params.procedureCodes.join(', '),
      appointment_at: params.appointmentAt,
      practice_name: params.practiceName,
      provider_number: params.providerNumber,
      practice_phone: params.practicePhone,
      language_preference: params.languagePreference ?? 'en',
      carrier_id: params.carrierId,
      cdcp_context: params.cdcpContext ? 'true' : 'false',
      carrier_ivr_instructions: params.carrierIvrInstructions ?? '',
      disclosure_message:
        `Hello, this is an automated calling system contacting you on behalf of ${params.practiceName}, a dental practice. ` +
        `You can reach us at ${params.practicePhone}. We are calling regarding ${purpose}. ` +
        `If you are a representative at the provider line, please stay on the line.`,
      },
    },
  };

  const result = await vapiRequest<VapiCallResult & { id?: string }>('POST', '/call', payload, {
    idempotencyKey: params.idempotencyKey,
  });
  return {
    ...result,
    vapiCallId: result.vapiCallId ?? result.id ?? '',
  };
}

/**
 * Retrieve the current status of a Vapi call.
 */
export async function getCallStatus(vapiCallId: string): Promise<VapiCallStatus> {
  return vapiRequest<VapiCallStatus>('GET', `/call/${vapiCallId}`);
}

/**
 * List recent calls for debugging / reconciliation.
 */
export async function listCalls(limit = 20): Promise<VapiCallStatus[]> {
  return vapiRequest<VapiCallStatus[]>('GET', `/call?limit=${limit}`);
}

/** End an in-progress Vapi call (CARRIER_BLOCK / staff end). */
export async function endVapiCall(vapiCallId: string): Promise<void> {
  await vapiRequest<unknown>('POST', `/call/${vapiCallId}/end`);
}

/** Warm transfer to front desk phone (human takeover). */
export async function transferVapiCall(vapiCallId: string, toPhoneNumber: string): Promise<void> {
  await vapiRequest<unknown>('POST', `/call/${vapiCallId}/transfer`, {
    destination: { type: 'number', number: toPhoneNumber },
  });
}

export const vapiClient = {
  initiateCall,
  initiatePreVisitCall,
  getCallStatus,
  listCalls,
  endVapiCall,
  transferVapiCall,
  CARRIER_PHONE_MAP,
  CDCP_CONTACT_CENTRE_PHONE,
} as const;

export default vapiClient;
