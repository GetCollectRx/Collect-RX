import { describe, expect, it } from 'vitest'
import type { ClaimStatus } from '@prisma/client'
import { workQueuePriorityLabel } from '../src/lib/workQueuePriority.js'
import {
  applyPracticePriorityFloor,
  buildPriorityScoreInput,
  estimateServiceDateFromOutstanding,
  rankClaimForPractice,
  scoreClaim,
} from '../src/server/services/priorityEngine.js'

const ref = new Date('2026-06-01T12:00:00.000Z')

function manulifeInput(
  dollars: number,
  days: number,
  attemptCount = 0,
  claimStatus: ClaimStatus = 'IN_QUEUE',
) {
  return buildPriorityScoreInput(
    {
      carrierId: 'manulife',
      outstandingAmount: dollars,
      daysOutstanding: days,
      status: claimStatus,
      servicedAt: estimateServiceDateFromOutstanding(ref, days + 7),
      queueEntry: attemptCount > 0 ? { attempts: attemptCount } : null,
      callAttempts: [],
    },
    ref,
  )
}

describe('rankClaimForPractice', () => {
  it('normalizes to 1.0 when claim is the practice max', () => {
    const input = manulifeInput(3180, 67)
    const total = scoreClaim(input).total
    expect(rankClaimForPractice(input, total)).toBe(1)
    expect(workQueuePriorityLabel(1).label).toBe('Critical')
  })

  it('MAN-2025-004401 style ($3180 / 61d) shows High or Med, never Low', () => {
    const input = manulifeInput(3180, 61)
    const total = scoreClaim(input).total
    const rank = rankClaimForPractice(input, total)
    expect(rank).toBeGreaterThanOrEqual(0.6)
    const { label } = workQueuePriorityLabel(rank)
    expect(['Med', 'High', 'Critical']).toContain(label)
    expect(label).not.toBe('Low')
  })

  it('applies floor: $2000+ and 45+ days never below High threshold', () => {
    const input = manulifeInput(2100, 46)
    const total = scoreClaim(input).total
    const rank = rankClaimForPractice(input, total * 3)
    expect(rank).toBeGreaterThanOrEqual(0.6)
    expect(workQueuePriorityLabel(rank).label).toBe('High')
  })

  it('does not floor small or young claims', () => {
    const input = manulifeInput(500, 20)
    const total = scoreClaim(input).total
    const rank = rankClaimForPractice(input, total * 10)
    expect(rank).toBeLessThan(0.6)
    expect(applyPracticePriorityFloor(rank, 500, 20)).toBe(rank)
  })

  it('ranks high-value aging claims above smaller fresher peers in a practice batch', () => {
    const crown = manulifeInput(3180, 67)
    const small = manulifeInput(860, 33)
    const totals = [scoreClaim(crown).total, scoreClaim(small).total]
    const maxScore = Math.max(...totals)
    const crownRank = rankClaimForPractice(crown, maxScore)
    const smallRank = rankClaimForPractice(small, maxScore)
    expect(crownRank).toBeGreaterThan(smallRank)
  })
})
