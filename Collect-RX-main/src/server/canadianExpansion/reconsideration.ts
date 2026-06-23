import type { CdcpReconsiderationCase } from '@prisma/client';
import {
  RECONSIDERATION_WINDOW_DAYS,
  reconsiderationExclusionReason,
} from './constants';

export function reconsiderationExpiresAt(denialDate: Date): Date {
  const d = new Date(denialDate);
  d.setUTCDate(d.getUTCDate() + RECONSIDERATION_WINDOW_DAYS);
  return d;
}

export function daysRemainingUntil(expiry: Date, now = new Date()): number {
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function deriveInitialStatus(procedureCode: string | null | undefined): {
  status: string;
  exclusionReason: string | null;
} {
  if (!procedureCode?.trim()) {
    return { status: 'open', exclusionReason: null };
  }
  const ex = reconsiderationExclusionReason(procedureCode);
  if (ex) {
    return { status: 'excluded', exclusionReason: ex };
  }
  return { status: 'open', exclusionReason: null };
}

export function enrichCase(row: CdcpReconsiderationCase): CdcpReconsiderationCase & {
  reconsiderationExpiresAt: string;
  daysRemaining: number;
  windowExpired: boolean;
} {
  const expiry = reconsiderationExpiresAt(row.denialDate);
  const daysRemaining = daysRemainingUntil(expiry);
  return {
    ...row,
    reconsiderationExpiresAt: expiry.toISOString(),
    daysRemaining,
    windowExpired: daysRemaining < 0,
  };
}
