import { prisma } from '../../../server';
import { AuditEnqueueResult } from './types';

export async function enqueueForAudit(callAttemptId: string): Promise<AuditEnqueueResult> {
  try {
    // Upsert: if row already exists, no-op via unique constraint
    const result = await prisma.guardrail_audit_outbox.upsert({
      where: { call_attempt_id: callAttemptId },
      update: {}, // no-op on conflict
      create: {
        call_attempt_id: callAttemptId,
      },
    });

    return {
      outboxId: result.id,
      enqueued: true,
    };
  } catch (err) {
    return {
      outboxId: '',
      enqueued: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
