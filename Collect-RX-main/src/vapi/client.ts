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
//   VAPI_SQUAD_ID         — pre-configured squad ID in Vapi dashboard
//   VAPI_PHONE_NUMBER_ID  — Twilio number registered in Vapi
// ─────────────────────────────────────────────────────────────────────────────

import { CarrierId } from '@prisma/client';

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
  providerNumber: string;
  /** Billing/claims phone line read in CRTC disclosure and given as carrier callback. */
  practicePhone: string;
  /** Language for IVR navigation and rep interactions — 'en' | 'fr'. Default 'en'. */
  languagePreference?: 'en' | 'fr';
  carrierIvrInstructions?: string;
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
  claimId: string;
  carrierId: string;
  patientToken: string;
  practiceId: string;
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

// ---------------------------------------------------------------------------
// Vapi HTTP client
// ---------------------------------------------------------------------------

const VAPI_BASE_URL = 'https://api.vapi.ai';

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

function getPhoneNumberId(): string {
  const id = process.env.VAPI_PHONE_NUMBER_ID;
  if (!id) throw new Error('[VapiClient] VAPI_PHONE_NUMBER_ID environment variable is not set');
  return id;
}

async function vapiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${VAPI_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`[VapiClient] ${method} ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
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
    providerNumber,
    practicePhone,
    languagePreference,
    carrierIvrInstructions,
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
    // Zero-retention: tell Vapi not to store the recording.
    // Belt-and-suspenders — handlePostCallAudioDeletion() also deletes it.
    recordingEnabled: false,
    metadata,
    // ── EPHEMERAL CALL VARIABLES ────────────────────────────────────────────
    // These are injected into the squad system prompt at call time only.
    // They are never written to any DB table, never written to logs
    // (logger.js PHI_FIELD_NAMES scrubs them), and are not stored in the
    // system prompt config. When the call ends they cease to exist.
    // PHI boundary: PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY.
    variables: {
      // ── Patient identifiers — ephemeral, from piiVault.detokenize() ──────────
      patient_name:             patientName,
      patient_dob:              patientDob,
      policy_number:            policyNumber,
      subscriber_name:          subscriberName ?? '',
      subscriber_dob:           subscriberDob ?? '',
      relationship:             relationship ?? 'self',
      // ── Claim reference ───────────────────────────────────────────────────────
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
      provider_number:          providerNumber,
      // CRTC ADAD Part IV Rule 4 — identification within first 10 seconds.
      // practice_phone is the billing/claims line, NOT the staff escalation line.
      practice_phone:           practicePhone,
      language_preference:      languagePreference ?? 'en',
      disclosure_message:       `Hello, this is an automated calling system contacting you on behalf of ${practiceName}, a dental practice. You can reach us at ${practicePhone}. We are calling regarding an outstanding insurance claim. If you are a representative at the claims department, please stay on the line.`,
      // ── Carrier routing ───────────────────────────────────────────────────────
      carrierId,
      carrier_ivr_instructions: carrierIvrInstructions ?? '',
    },
  };

  const result = await vapiRequest<VapiCallResult>('POST', '/call', payload);
  return result;
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
  getCallStatus,
  listCalls,
  endVapiCall,
  transferVapiCall,
  CARRIER_PHONE_MAP,
} as const;

export default vapiClient;
