import type { PrismaClient } from '@prisma/client';

/**
 * Provenance expiry for approved carrier lessons (policy research PS section 4,
 * synthesis F12). A lesson keeps its text after review, but the link back to the
 * source call attempt (sourceCallAttemptId) is cleared after a retention period.
 * That link is what would let a tenant's offboarding or deletion request trace
 * its influence through shared lessons, so it should not outlive the period.
 *
 * Nothing schedules this function. The retention period has no default because
 * the value is PENDING_COUNSEL. Callers must supply it, and a missing or
 * non-positive value throws. Dry run is the default and reports counts only.
 */

export const PROVENANCE_RETENTION_ENV = 'LESSON_PROVENANCE_RETENTION_DAYS';

export interface ProvenanceExpiryResult {
  dryRun: boolean;
  cutoff: Date;
  matched: number;
  cleared: number;
}

export function readProvenanceRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[PROVENANCE_RETENTION_ENV];
  const days = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(
      `${PROVENANCE_RETENTION_ENV} must be a positive integer number of days (value pending counsel)`,
    );
  }
  return days;
}

export async function runLessonProvenanceExpiry(
  prisma: PrismaClient,
  options: { retentionDays: number; dryRun?: boolean; now?: Date },
): Promise<ProvenanceExpiryResult> {
  const { retentionDays } = options;
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error('retentionDays must be a positive integer');
  }
  const dryRun = options.dryRun ?? true;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);

  const where = {
    status: 'APPROVED' as const,
    sourceCallAttemptId: { not: null },
    reviewedAt: { lt: cutoff },
  };
  const matched = await prisma.carrierLesson.count({ where });
  if (dryRun) return { dryRun, cutoff, matched, cleared: 0 };

  const result = await prisma.carrierLesson.updateMany({
    where,
    data: { sourceCallAttemptId: null },
  });
  return { dryRun, cutoff, matched, cleared: result.count };
}
