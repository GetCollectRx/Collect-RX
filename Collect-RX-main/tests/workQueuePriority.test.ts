import { describe, expect, it } from 'vitest'
import {
  computeWorkQueueRankScore,
  workQueuePriorityLabel,
} from '../src/lib/workQueuePriority.js'

describe('workQueuePriorityLabel', () => {
  it('maps 0–1 rank scores to priority labels', () => {
    expect(workQueuePriorityLabel(0.9).label).toBe('Critical')
    expect(workQueuePriorityLabel(0.8).label).toBe('Critical')
    expect(workQueuePriorityLabel(0.79).label).toBe('High')
    expect(workQueuePriorityLabel(0.6).label).toBe('High')
    expect(workQueuePriorityLabel(0.59).label).toBe('Med')
    expect(workQueuePriorityLabel(0.4).label).toBe('Med')
    expect(workQueuePriorityLabel(0.39).label).toBe('Low')
    expect(workQueuePriorityLabel(0).label).toBe('Low')
  })

  it('shows Med or High for $3,180 at 61 days (not Low)', () => {
    const score = computeWorkQueueRankScore(3180, 61)
    expect(score).toBeGreaterThanOrEqual(0.6)
    const { label } = workQueuePriorityLabel(score)
    expect(['Med', 'High', 'Critical']).toContain(label)
    expect(label).not.toBe('Low')
  })

  it('shows High for MAN-2025-004401 demo claim ($3180 / 67d manulife)', () => {
    const score = computeWorkQueueRankScore(3180, 67, 0.8, 'manulife')
    expect(score).toBeGreaterThanOrEqual(0.6)
    expect(workQueuePriorityLabel(score).label).not.toBe('Low')
  })
})
