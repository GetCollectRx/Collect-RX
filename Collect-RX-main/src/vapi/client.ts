// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Vapi Client
//
// Thin wrapper around the Vapi REST API. All patient identifiers passed to
// Vapi MUST be UUID tokens from PIIVault — never real names or DOBs.
//
// The squad model:
//   IVR_Navigator → Claims_Agent → Escalation_Closer / Resolution_Closer
//
// Required env vars:
//   VAPI_API_KEY        — Vapi private API key
//   VAPI_SQUAD_ID       — pre-configured squad ID in Vapi dashboard
//   VAPI_PHONE_NUMBER   — Twilio number registered in Vapi
// ─────────────────────────────────────────────────────────────────────────────

import { CarrierId } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VapiCallParams {
  claimId: string;
  carrierId: CarrierId;
  /** UUID from PIIVault — the only patient identifier sent to Vapi */
  patientToken: string;
  carrierPhone: string;
  /** Claim number for IVR navigation — not PHI */
  claimNumber: string;
  /** Billed amount for context — not PHI */
  billedAmount: number;
  outstandingAmount: number;
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
  };
}

export interface VapiCallMetadata {
  claimId: string;
  carrierId: string;
  patientToken: string;
  practiceId: string;
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
 * Only UUID tokens are passed as patient identifiers — never real PHI.
 */
export async function initiateCall(params: VapiCallParams): Promise<VapiCallResult> {
  const {
    claimId,
    carrierId,
    patientToken,
    carrierPhone,
    claimNumber,
    billedAmount,
    outstandingAmount,
  } = params;

  // Build the metadata forwarded to the Vapi squad for IVR navigation.
  // patientToken is a UUID — it identifies the patient to the backend only.
  const metadata: VapiCallMetadata = {
    claimId,
    carrierId,
    patientToken,   // UUID only — no real PHI
    practiceId: process.env.PRACTICE_ID ?? 'unknown',
  };

  const payload = {
    squadId: getSquadId(),
    phoneNumberId: getPhoneNumberId(),
    customer: {
      number: carrierPhone,
    },
    metadata,
    // Context variables injected into the IVR Navigator's system prompt.
    // These are claim-level details only — no patient PHI.
    variables: {
      carrierId,
      claimNumber,
      billedAmount: billedAmount.toFixed(2),
      outstandingAmount: outstandingAmount.toFixed(2),
      // patientToken passed separately so agents can reference it without PHI
      patientToken,
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

export const vapiClient = {
  initiateCall,
  getCallStatus,
  listCalls,
  CARRIER_PHONE_MAP,
} as const;

export default vapiClient;
