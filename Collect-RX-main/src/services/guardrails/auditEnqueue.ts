import { prisma } from '../../lib/prisma';
import { AuditEnqueueResult } from './types';

export async function enqueueForAudit(callAttemptId: string): Promise<AuditEnqueueResult> {
  try {
    // Upsert: if row already exists, no-op via unique constraint
    const result = await prisma.guardrailAuditOutbox.upsert({
      where: { callAttemptId },
      update: {}, // no-op on conflict
      create: {
        callAttemptId,
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
