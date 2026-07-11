/**
 * Vapi server-message normalizer.
 *
 * Vapi delivers webhooks as `{ message: { type: 'end-of-call-report' | 'status-update' | ... } }`
 * (see ServerMessageEndOfCallReport / ServerMessageStatusUpdate in the Vapi OpenAPI spec).
 * The rest of this codebase consumes the flat VapiWebhookPayload shape, so this module
 * maps native envelopes onto it. Legacy flat payloads pass through unchanged, which keeps
 * existing tests and internally-generated payloads working.
 *
 * Call metadata note: dispatch sends metadata via assistantOverrides.metadata (CreateCallDTO
 * has no top-level metadata field), so on inbound messages it is read back from
 * message.call.assistantOverrides.metadata first, then legacy locations.
 */

import type { VapiWebhookPayload, VapiCallMetadata } from '../vapi/client';

interface NativeCall {
  id?: unknown;
  status?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  metadata?: unknown;
  assistantOverrides?: { metadata?: unknown };
}

interface NativeServerMessage {
  type?: unknown;
  status?: unknown;
  endedReason?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  transcript?: unknown;
  summary?: unknown;
  call?: NativeCall;
  assistant?: { metadata?: unknown };
  artifact?: { transcript?: unknown; recordingUrl?: unknown };
  analysis?: { summary?: unknown; structuredData?: unknown; successEvaluation?: unknown };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function extractMetadata(msg: NativeServerMessage): VapiCallMetadata | undefined {
  const candidates = [
    msg.call?.assistantOverrides?.metadata,
    msg.call?.metadata,
    msg.assistant?.metadata,
  ];
  for (const c of candidates) {
    if (isRecord(c) && typeof c.practiceId === 'string') {
      return c as unknown as VapiCallMetadata;
    }
  }
  return undefined;
}

function durationSecondsBetween(startedAt?: string, endedAt?: string): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : undefined;
}

/**
 * Normalize a parsed webhook body to the internal VapiWebhookPayload shape.
 * Returns null for message types the backend does not consume — callers
 * should ACK those with 200 and skip processing.
 */
export function normalizeVapiWebhook(parsed: unknown): VapiWebhookPayload | null {
  if (!isRecord(parsed)) return null;

  // Legacy flat shape — already what downstream consumers expect.
  if (typeof parsed.type === 'string' && isRecord(parsed.call)) {
    return parsed as unknown as VapiWebhookPayload;
  }

  if (!isRecord(parsed.message)) return null;
  const msg = parsed.message as NativeServerMessage;
  const msgType = asString(msg.type);
  const callId = asString(msg.call?.id);
  if (!msgType || !callId) return null;

  const metadata = extractMetadata(msg);

  if (msgType === 'end-of-call-report') {
    const startedAt = asString(msg.startedAt) ?? asString(msg.call?.startedAt);
    const endedAt = asString(msg.endedAt) ?? asString(msg.call?.endedAt);
    const structuredData = isRecord(msg.analysis?.structuredData)
      ? (msg.analysis?.structuredData as Record<string, unknown>)
      : undefined;
    return {
      type: 'call.ended',
      call: {
        id: callId,
        status: 'ended',
        startedAt,
        endedAt,
        durationSeconds: durationSecondsBetween(startedAt, endedAt),
      },
      transcript: asString(msg.artifact?.transcript) ?? asString(msg.transcript),
      recordingUrl: asString(msg.artifact?.recordingUrl),
      metadata,
      analysis: {
        summary: asString(msg.analysis?.summary),
        successEvaluation: asString(msg.analysis?.successEvaluation),
        structuredData,
      },
    };
  }

  if (msgType === 'status-update') {
    const status = asString(msg.status) ?? asString(msg.call?.status) ?? 'unknown';
    const failed = status === 'ended' && asString(msg.endedReason)?.includes('error');
    return {
      type: failed ? 'call.failed' : 'status-update',
      call: { id: callId, status },
      metadata,
    };
  }

  // Message types the backend does not consume (speech-update, conversation-update, ...).
  return null;
}
