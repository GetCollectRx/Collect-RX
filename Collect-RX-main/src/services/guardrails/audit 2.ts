import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { GuardrailAuditEvent } from './types';

export async function writeAuditLog(event: GuardrailAuditEvent): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        practiceId: event.practiceId,
        action: event.action,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        details: event.details as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Log to console but don't throw; audit log write should not break the main flow
    console.error('[guardrails] Failed to write audit log:', err);
  }
}
