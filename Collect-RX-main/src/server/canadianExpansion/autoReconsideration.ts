/**
 * MOD-01 (auto) — detect CDCP denials in Vapi end-of-call reports and auto-create
 * a CdcpReconsiderationCase. Idempotent on (practiceId, claimRef).
 */

import type { PrismaClient } from '@prisma/client';
import { deriveInitialStatus } from './reconsideration';

interface VapiEndOfCallMessage {
  type?: string;
  call?: {
    id?: string;
    metadata?: Record<string, unknown>;
    assistantOverrides?: { variableValues?: Record<string, unknown> };
  };
  analysis?: {
    structuredData?: Record<string, unknown>;
  };
}

export interface DenialSignal {
  practiceId: string;
  patientToken: string;
  claimRef: string;
  carrierCode: string;
  procedureCode: string | null;
  vapiCallId: string | null;
  reasonCode: string | null;
}

const DENIAL_OUTCOMES = new Set([
  'DENIED',
  'NOT_COVERED',
  'NOT_ELIGIBLE',
  'PENDING_PREAUTH',
]);

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Pull denial signals from a Vapi end-of-call-report message. */
export function detectDenialFromEndOfCall(
  msg: VapiEndOfCallMessage
): DenialSignal | null {
  if (!msg || msg.type !== 'end-of-call-report') return null;

  const sd = msg.analysis?.structuredData ?? {};
  const meta =
    msg.call?.metadata ??
    msg.call?.assistantOverrides?.variableValues ??
    ({} as Record<string, unknown>);

  const outcome = asString(sd.outcome) || asString(sd.status);
  const isAppealable =
    sd.is_appealable === true ||
    sd.is_appealable === 'true' ||
    asString(sd.is_appealable)?.toLowerCase() === 'true';
  if (!outcome || !DENIAL_OUTCOMES.has(outcome.toUpperCase())) return null;
  // Only auto-track when explicitly appealable, OR when the structured data
  // includes a recognised denial outcome and is from CDCP.
  const carrierCode =
    asString(sd.carrier_code) ?? asString(meta.carrier_code) ?? 'cdcp_sunlife';
  if (!isAppealable && carrierCode !== 'cdcp_sunlife') return null;

  const practiceId = asString(meta.practice_id) ?? asString(sd.practice_id);
  const patientToken = asString(meta.patient_token) ?? asString(sd.patient_token);
  const claimRef =
    asString(sd.claim_ref) ??
    asString(sd.predetermination_ref) ??
    asString(meta.claim_ref);
  if (!practiceId || !patientToken || !claimRef) return null;

  const procedureCode =
    asString(sd.procedure_code) ?? asString(meta.procedure_code);
  const vapiCallId = asString(msg.call?.id);
  const reasonCode =
    asString(sd.reason_code) ?? asString(sd.denial_reason);

  return {
    practiceId,
    patientToken,
    claimRef,
    carrierCode,
    procedureCode,
    vapiCallId,
    reasonCode,
  };
}

/** Idempotent upsert keyed on (practiceId, claimRef). */
export async function upsertReconsiderationFromSignal(
  prisma: PrismaClient,
  signal: DenialSignal
): Promise<{ created: boolean; id: string }> {
  const existing = await prisma.cdcpReconsiderationCase.findFirst({
    where: { practiceId: signal.practiceId, claimRef: signal.claimRef },
    select: { id: true },
  });
  if (existing) {
    return { created: false, id: existing.id };
  }
  const init = deriveInitialStatus(signal.procedureCode || '');
  const summary = signal.reasonCode
    ? `Auto-detected denial via Vapi (reason: ${signal.reasonCode})${signal.vapiCallId ? ` — call ${signal.vapiCallId}` : ''}`
    : `Auto-detected denial via Vapi${signal.vapiCallId ? ` — call ${signal.vapiCallId}` : ''}`;
  const row = await prisma.cdcpReconsiderationCase.create({
    data: {
      practiceId: signal.practiceId,
      patientToken: signal.patientToken,
      claimRef: signal.claimRef,
      carrierCode: signal.carrierCode,
      procedureCode: signal.procedureCode,
      denialDate: new Date(),
      status: init.status,
      exclusionReason: init.exclusionReason,
      clinicalEvidenceSummary: summary,
    },
  });
  return { created: true, id: row.id };
}

export async function maybeAutoCreateFromVapiBody(
  prisma: PrismaClient,
  body: unknown
): Promise<{ created: boolean; id?: string } | null> {
  const message = (body as { message?: VapiEndOfCallMessage })?.message;
  if (!message) return null;
  const signal = detectDenialFromEndOfCall(message);
  if (!signal) return null;
  try {
    return await upsertReconsiderationFromSignal(prisma, signal);
  } catch (e) {
    console.error('[auto-reconsideration] upsert failed', e);
    return null;
  }
}
