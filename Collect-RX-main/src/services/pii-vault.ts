// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — PIIVault (LEGACY — services/pii-vault.ts)
//
// ⚠️  DEPRECATED — do NOT import tokenize() or detokenize() from this file.
//
// The main PHI vault is src/pii-vault.ts (AES-256-GCM, 4h TTL, full PatientPHI
// struct, encrypted DB persistence, rehydrate on restart). Use that instead.
//
// This file remains because:
//   - handlePostCallAudioDeletion() — still used by vapiWebhook.ts (post-call
//     zero-retention deletion of Vapi/Twilio recordings). Not a vault function.
//   - LLM_RESIDENCY_HEADERS — data-residency constants for external LLM calls.
//   - isReadyForAudioDeletion() — utility used by zero-retention gate logic.
//
// tokenize() and detokenize() in this file are orphaned. They use a 24h TTL
// simple string → UUID map (no PHI, no encryption). No code creates tokens
// here any longer. Do not add new callers.
//
// PHIPA/PIPEDA compliance depends on using src/pii-vault.ts exclusively
// for PHI tokenization.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Data residency constants
//
// All external LLM API calls (OpenAI / Anthropic) from CollectRx must include
// the Canada-Central data residency header to comply with Quebec Law 25 and
// Alberta HIA production requirements.
// ---------------------------------------------------------------------------

/**
 * Standard headers to append to every external LLM API request.
 * Include via `{ ...LLM_RESIDENCY_HEADERS }` in fetch options.
 *
 * Note: Header support is vendor-dependent. Both OpenAI Azure (Canada Central)
 * and Anthropic (when routing through Canadian endpoints) honour these.
 */
export const LLM_RESIDENCY_HEADERS: Record<string, string> = {
  'X-Data-Residency': 'Canada-Central',
  'X-Processing-Region': 'ca-central-1',
};

// ---------------------------------------------------------------------------
// Zero-Retention Audio Policy
//
// Per PHIPA/PIPEDA and the CollectRx privacy architecture, call recordings
// must be deleted from Vapi and Twilio storage as soon as:
//   (a) the call transcript has been extracted, AND
//   (b) the 8-dimension automated evaluation has completed.
//
// The `handlePostCallAudioDeletion` webhook handler enforces this.
// It is invoked by the Vapi `call.ended` webhook after the outcome processor
// and automated evaluator have both signalled completion.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatientPHI {
  patientId: string;       // practice-system patient ID
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;    // ISO date YYYY-MM-DD
  healthCardNumber?: string;
  subscriberId?: string;
  groupNumber?: string;
}

export interface TokenRecord {
  token: string;           // UUID
  patientId: string;       // original practice patient ID
  createdAt: Date;
  expiresAt: Date | null;
}

// ---------------------------------------------------------------------------
// In-memory token store
//
// Production note: swap this for an encrypted PostgreSQL table or a KMS-backed
// store. The in-memory map works for dev/pilot and is intentionally simple.
// All tokens expire after TOKEN_TTL_MS to bound PHI exposure window.
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** token UUID → { patientId, expiresAt } */
const tokenStore = new Map<string, { patientId: string; expiresAt: Date }>();

/** patientId → token UUID (so the same patient always gets the same token per call) */
const reverseStore = new Map<string, string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Issue a UUID token for a patient ID.
 *
 * Safe to call repeatedly for the same patientId — returns the same token
 * if it hasn't expired yet (stable within a call session).
 *
 * @param patientId - The practice-system patient identifier.
 * @returns UUID token safe to pass to Vapi / store in DB tables.
 */
export function tokenize(patientId: string): string {
  if (!patientId || typeof patientId !== 'string') {
    throw new Error('[PIIVault] tokenize: patientId must be a non-empty string');
  }

  // Return existing live token if available
  const existingToken = reverseStore.get(patientId);
  if (existingToken) {
    const record = tokenStore.get(existingToken);
    if (record && record.expiresAt > new Date()) {
      return existingToken;
    }
    // Expired — clean up and re-issue
    tokenStore.delete(existingToken);
    reverseStore.delete(patientId);
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  tokenStore.set(token, { patientId, expiresAt });
  reverseStore.set(patientId, token);

  return token;
}

/**
 * Resolve a UUID token back to the original patient ID.
 *
 * MUST only be called on the backend after call completion — never pass
 * detokenized PHI to Vapi or store it in call-related DB columns.
 *
 * @param token - UUID previously issued by `tokenize()`.
 * @returns The original patientId string.
 * @throws If the token is unknown or expired.
 */
export function detokenize(token: string): string {
  if (!token || typeof token !== 'string') {
    throw new Error('[PIIVault] detokenize: token must be a non-empty string');
  }

  const record = tokenStore.get(token);

  if (!record) {
    throw new Error(`[PIIVault] detokenize: unknown token "${token}"`);
  }

  if (record.expiresAt < new Date()) {
    tokenStore.delete(token);
    reverseStore.delete(record.patientId);
    throw new Error(`[PIIVault] detokenize: token "${token}" has expired`);
  }

  return record.patientId;
}

/**
 * Explicitly revoke a token before its TTL expires.
 * Call after call completion when the token is no longer needed.
 */
export function revoke(token: string): void {
  const record = tokenStore.get(token);
  if (record) {
    reverseStore.delete(record.patientId);
    tokenStore.delete(token);
  }
}

/**
 * Check whether a token is currently valid (exists and not expired).
 */
export function isValid(token: string): boolean {
  const record = tokenStore.get(token);
  return !!record && record.expiresAt > new Date();
}

/**
 * Purge all expired tokens. Call periodically (e.g., on server boot + hourly).
 */
export function purgeExpired(): number {
  const now = new Date();
  let purged = 0;
  for (const [token, record] of tokenStore.entries()) {
    if (record.expiresAt < now) {
      reverseStore.delete(record.patientId);
      tokenStore.delete(token);
      purged++;
    }
  }
  return purged;
}

// ---------------------------------------------------------------------------
// Zero-Retention Audio Policy — post-call webhook handler
// ---------------------------------------------------------------------------

export interface AudioDeletionResult {
  vapiDeleted: boolean;
  twilioDeleted: boolean;
  recordingUrl: string | null;
  deletedAt: string;
  errors: string[];
}

/**
 * Delete a call recording from Vapi and (if present) Twilio storage.
 *
 * MUST be called after BOTH of the following are complete:
 *   1. Call transcript has been extracted and persisted to DB
 *   2. 8-dimension automated evaluation has been written to DB
 *
 * The recording URL is nullified in the call record AFTER successful deletion.
 * If deletion fails the error is logged but does NOT throw — the caller should
 * schedule a retry and flag the call for manual review.
 *
 * @param vapiCallId   Vapi call ID (used to identify the recording in Vapi)
 * @param recordingUrl Full URL of the recording (may be a Twilio URL)
 */
export async function handlePostCallAudioDeletion(
  vapiCallId: string,
  recordingUrl: string | null,
): Promise<AudioDeletionResult> {
  const errors: string[] = [];
  let vapiDeleted = false;
  let twilioDeleted = false;
  const deletedAt = new Date().toISOString();

  // 1. Delete from Vapi
  try {
    const vapiKey = process.env.VAPI_API_KEY;
    if (!vapiKey) throw new Error('VAPI_API_KEY not set');

    const vapiRes = await fetch(`https://api.vapi.ai/call/${vapiCallId}/recording`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${vapiKey}`,
        'Content-Type': 'application/json',
        ...LLM_RESIDENCY_HEADERS,
      },
    });

    if (vapiRes.ok || vapiRes.status === 404) {
      // 404 means already deleted or never stored — treat as success
      vapiDeleted = true;
    } else {
      const body = await vapiRes.text().catch(() => '');
      errors.push(`Vapi DELETE failed: HTTP ${vapiRes.status} — ${body}`);
    }
  } catch (err) {
    errors.push(`Vapi DELETE error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Delete from Twilio if the recording URL is a Twilio URL
  if (recordingUrl && recordingUrl.includes('twilio.com')) {
    try {
      // Twilio recording URLs have the form:
      //   https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Recordings/{RecordingSid}
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;

      if (!twilioSid || !twilioToken) {
        errors.push('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — Twilio recording not deleted');
      } else {
        const deleteUrl = recordingUrl.replace(/\.json$/, '') + '.json';
        const twilioRes = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}`,
          },
        });

        if (twilioRes.ok || twilioRes.status === 404) {
          twilioDeleted = true;
        } else {
          const body = await twilioRes.text().catch(() => '');
          errors.push(`Twilio DELETE failed: HTTP ${twilioRes.status} — ${body}`);
        }
      }
    } catch (err) {
      errors.push(`Twilio DELETE error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // No Twilio URL — mark as not applicable (not an error)
    twilioDeleted = true;
  }

  if (errors.length > 0) {
    console.error('[PIIVault] audio deletion errors for call', vapiCallId, errors);
  } else {
    console.info('[PIIVault] zero-retention: recording deleted for call', vapiCallId, { deletedAt });
  }

  return { vapiDeleted, twilioDeleted, recordingUrl, deletedAt, errors };
}

/**
 * Check whether it is safe to delete the recording for a given call.
 * Both transcript and 8-dim eval must be present in the call record.
 * Pass the raw call row from the DB — no PHI required.
 */
export function isReadyForAudioDeletion(callRecord: {
  transcript: string | null;
  evalCompletedAt: Date | null;
}): boolean {
  return Boolean(callRecord.transcript) && Boolean(callRecord.evalCompletedAt);
}

// ---------------------------------------------------------------------------
// Singleton export (DI-friendly)
// ---------------------------------------------------------------------------

export const piiVault = {
  tokenize,
  detokenize,
  revoke,
  isValid,
  purgeExpired,
  handlePostCallAudioDeletion,
  isReadyForAudioDeletion,
  LLM_RESIDENCY_HEADERS,
} as const;

export default piiVault;
