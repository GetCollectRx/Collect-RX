/** Maps work-queue rank scores (0–1, from priorityEngine via rankClaimForPractice) to display labels. */

import {
  buildPriorityScoreInput,
  estimateServiceDateFromOutstanding,
  rankClaimForPractice,
  scoreClaim,
} from '../services/priorityScoring'
import type { CarrierId, ClaimStatus } from '@prisma/client'

export type WorkQueuePriorityLabel = 'Critical' | 'High' | 'Med' | 'Low'

export interface WorkQueuePriorityDisplay {
  label: WorkQueuePriorityLabel
  color: string
}

export const WORK_QUEUE_PRIORITY_THRESHOLDS = {
  critical: 0.8,
  high: 0.6,
  med: 0.4,
} as const

const THRESHOLDS = WORK_QUEUE_PRIORITY_THRESHOLDS

export function workQueuePriorityLabel(score: number): WorkQueuePriorityDisplay {
  if (score >= THRESHOLDS.critical) {
    return {
      label: 'Critical',
      color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    }
  }
  if (score >= THRESHOLDS.high) {
    return {
      label: 'High',
      color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    }
  }
  if (score >= THRESHOLDS.med) {
    return {
      label: 'Med',
      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    }
  }
  return {
    label: 'Low',
    color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  }
}

/** Quick estimate for scripts/docs — uses same engine as syncWorkItemsForPractice (self-normalized). */
export function computeWorkQueueRankScore(
  dollarsAtRisk: number,
  daysOutstanding: number,
  _carrierRisk = 0.5,
  carrierId: CarrierId = 'manulife',
  claimStatus: ClaimStatus = 'IN_QUEUE',
): number {
  void _carrierRisk
  const ref = new Date()
  const input = buildPriorityScoreInput(
    {
      carrierId,
      outstandingAmount: dollarsAtRisk,
      daysOutstanding,
      status: claimStatus,
      servicedAt: estimateServiceDateFromOutstanding(ref, daysOutstanding + 7),
      callAttempts: [],
    },
    ref,
  )
  const total = scoreClaim(input).total
  return rankClaimForPractice(input, total)
}
