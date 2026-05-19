import { prisma } from '../../../server';
import { GuardrailAuditEvent } from './types';

export async function writeAuditLog(event: GuardrailAuditEvent): Promise<void> {
  try {
    await prisma.audit_log.create({
      data: {
        action: event.action,
        subject_type: event.subjectType,
        subject_id: event.subjectId,
        details: event.details as Record<string, unknown>,
        // request_ip and user_agent can be added if context available
      },
    });
  } catch (err) {
    // Log to console but don't throw; audit log write should not break the main flow
    console.error('[guardrails] Failed to write audit log:', err);
  }
}
