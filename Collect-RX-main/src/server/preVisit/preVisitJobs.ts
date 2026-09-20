/**
 * Pre-visit BullMQ job types — run on the existing `collectrx-ar` queue
 * (see src/server/jobs/arQueue.ts). No new queue is created.
 */
import type { CarrierId } from '@prisma/client';
import { getArQueue } from '../jobs/arQueue.js';

export const PRE_VISIT_ELIGIBILITY = 'PRE_VISIT_ELIGIBILITY' as const;
export const PRE_VISIT_CDCP_PREDET = 'PRE_VISIT_CDCP_PREDET' as const;
export const PRE_VISIT_TELUS_TX23 = 'PRE_VISIT_TELUS_TX23' as const;
export const APPOINTMENT_VERIFICATION_SWEEP = 'APPOINTMENT_VERIFICATION_SWEEP' as const;

export type PreVisitJobType =
  | typeof PRE_VISIT_ELIGIBILITY
  | typeof PRE_VISIT_CDCP_PREDET
  | typeof PRE_VISIT_TELUS_TX23
  | typeof APPOINTMENT_VERIFICATION_SWEEP;

export interface PreVisitJobPayload {
  practiceId: string;
  patientToken: string;
  carrierId: CarrierId;
  procedureCodes: string[];
  appointmentAt: string; // ISO string
  appointmentVerificationId: string;
  /** True for PRE_VISIT_CDCP_PREDET — routes the VAPI agent to the CDCP IVR path. */
  cdcpContext?: boolean;
}

/**
 * Enqueue a pre-visit job, deduplicated by practice/patient/carrier so a
 * second verification call for the same trio does not double-dispatch.
 */
export async function enqueuePreVisitJob(
  type: PreVisitJobType,
  payload: PreVisitJobPayload,
  delayMs?: number,
  scheduleKey?: string,
): Promise<string> {
  const baseJobId = `pre-visit:${type}:${payload.practiceId}:${payload.patientToken}:${payload.carrierId}`;
  const jobId = scheduleKey ? `${baseJobId}:${scheduleKey}` : baseJobId;
  const queue = getArQueue();
  const job = await queue.add(type, payload, {
    jobId,
    ...(delayMs ? { delay: delayMs } : {}),
  });
  return job.id ?? jobId;
}
