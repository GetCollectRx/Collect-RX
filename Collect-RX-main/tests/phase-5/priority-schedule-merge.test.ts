import { describe, expect, it } from 'vitest';
import { mergeRecoveryRecallWithPrioritySlot } from '../../src/server/services/priorityScheduleMerge.js';

describe('mergeRecoveryRecallWithPrioritySlot', () => {
  it('keeps future recovery SLA recall over immediate priority slot', () => {
    const prioritySlot = new Date('2026-05-30T12:00:00.000Z');
    const recoveryRecall = new Date('2026-06-02T12:00:00.000Z');
    expect(mergeRecoveryRecallWithPrioritySlot(recoveryRecall, prioritySlot)).toEqual(recoveryRecall);
  });

  it('uses priority slot when recovery recall is sooner or absent', () => {
    const prioritySlot = new Date('2026-05-30T12:00:00.000Z');
    const recoveryRecall = new Date('2026-05-30T11:00:00.000Z');
    expect(mergeRecoveryRecallWithPrioritySlot(recoveryRecall, prioritySlot)).toEqual(prioritySlot);
    expect(mergeRecoveryRecallWithPrioritySlot(null, prioritySlot)).toEqual(prioritySlot);
  });
});
