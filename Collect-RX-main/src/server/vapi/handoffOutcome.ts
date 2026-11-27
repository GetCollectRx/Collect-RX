/**
 * Records how each staff handoff request ended, so a practice can see how often
 * a live carrier rep was left without staff to speak to.
 *
 * Only the transfer's own result is observable here. Whether staff then answer a
 * connected transfer is not, and is reported as unobserved, not as a success.
 */
import type { PrismaClient } from '@prisma/client';
import { appendAuditLog } from '../audit/auditLog.js';

export const HANDOFF_OUTCOMES = [
  'transfer_initiated',
  'no_escalation_number',
  'handoff_error',
  'missing_context',
] as const;

export type HandoffOutcome = (typeof HANDOFF_OUTCOMES)[number];

export const HANDOFF_OUTCOME_ACTION = 'frontdesk.handoff.outcome';

export type HandoffOutcomeCounts = Record<HandoffOutcome, number>;

function isHandoffOutcome(value: unknown): value is HandoffOutcome {
  return typeof value === 'string' && (HANDOFF_OUTCOMES as readonly string[]).includes(value);
}

export function summarizeHandoffOutcomes(rows: readonly unknown[]): HandoffOutcomeCounts {
  const counts: HandoffOutcomeCounts = {
    transfer_initiated: 0,
    no_escalation_number: 0,
    handoff_error: 0,
    missing_context: 0,
  };
  for (const row of rows) {
    const outcome = (row as { outcome?: unknown } | null)?.outcome;
    if (isHandoffOutcome(outcome)) counts[outcome] += 1;
  }
  return counts;
}

/** Appends one chained audit row. Carries the outcome code and the call id only. */
export async function recordHandoffOutcome(
  prisma: PrismaClient,
  params: { practiceId: string; vapiCallId: string; outcome: HandoffOutcome },
): Promise<void> {
  await appendAuditLog(prisma, {
    practiceId: params.practiceId,
    action: HANDOFF_OUTCOME_ACTION,
    subjectType: 'VapiCall',
    subjectId: params.vapiCallId,
    details: { outcome: params.outcome },
  });
}

export async function countHandoffOutcomes(
  prisma: PrismaClient,
  practiceId: string,
  since: Date,
): Promise<HandoffOutcomeCounts> {
  const rows = await prisma.auditLog.findMany({
    where: { practiceId, action: HANDOFF_OUTCOME_ACTION, createdAt: { gte: since } },
    select: { details: true },
  });
  return summarizeHandoffOutcomes(
    rows.map((row) => (typeof row.details === 'object' && row.details !== null ? row.details : null)),
  );
}
