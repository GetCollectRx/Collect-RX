/**
 * Priority engine must not clobber recovery-router SLA recalls (72h processing, 4h retry, etc.).
 * Use the later of recovery recall vs priority rank slot.
 */
export function mergeRecoveryRecallWithPrioritySlot(
  existingScheduledFor: Date | null | undefined,
  prioritySlot: Date,
): Date {
  if (!existingScheduledFor) return prioritySlot;
  return existingScheduledFor.getTime() > prioritySlot.getTime() ? existingScheduledFor : prioritySlot;
}
