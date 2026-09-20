/**
 * Tenant-configurable data retention purge. Per-practice defaults live in
 * PracticeSettings.retention (practiceSettingsService.ts): claims/CallAttempts
 * purge 12 months after InsuranceClaim.resolvedAt, AuditLog/PhiAccessEvent
 * purge 18 months after createdAt.
 *
 * Disabled by default at two levels — both must be true for a practice to
 * actually purge:
 *   1. Global: DATA_RETENTION_ENABLED=1 (env)
 *   2. Per-practice: settings.retention.purgeEnabled
 * This ships built and reviewable without deleting anything until a human
 * turns it on per-practice after validating it in staging — this job was
 * authored and typechecked but never run against a live database (no
 * DATABASE_URL / Postgres available in the environment that wrote it).
 *
 * Deletion order for a purged claim (FK-driven, see prisma/schema.prisma):
 *   CallTranscriptLine (no FK — vapiCallId string match, cleaned up for hygiene)
 *   CallAttempt (cascades to GuardrailAudit, GuardrailAuditOutbox)
 *   CallQueue
 *   InsuranceClaim (cascades to ClaimRecoveryAction, ClaimRecoveryEvent,
 *     ClaimEvidenceItem, ClaimSubmission, EvidencePackExport, UnderpaymentCase;
 *     sets PracticeNotification.claimId to null)
 *
 * Known scope gap: does not sweep bare (non-@relation, no FK) claimId string
 * columns on EmrSyncOutbox, AdjudicationEvent, ReconciliationLog, or
 * CallEscalation — those don't block deletion (no FK constraint) but are left
 * as orphaned correlational rows after a purge. Flagged as a follow-up, not
 * silently ignored: a full sweep of every claimId-shaped column across the
 * schema is a separate, careful pass.
 */
import type { PrismaClient } from '@prisma/client';
import { getPracticeSettings } from '../services/practiceSettingsService.js';

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000; // approximation is fine for a retention *floor*, not a legal deadline

function monthsAgo(months: number, now: Date): Date {
  return new Date(now.getTime() - months * MS_PER_MONTH);
}

export function isDataRetentionGloballyEnabled(): boolean {
  return process.env.DATA_RETENTION_ENABLED === '1' || process.env.DATA_RETENTION_ENABLED === 'true';
}

export interface RetentionPurgeResult {
  practiceId: string;
  ran: boolean;
  claimsPurged: number;
  auditLogRowsPurged: number;
  phiAccessEventRowsPurged: number;
  errors: string[];
}

/** Purges one resolved-and-expired claim and its directly-linked records. */
async function purgeClaim(prisma: PrismaClient, claimId: string): Promise<void> {
  const attempts = await prisma.callAttempt.findMany({
    where: { claimId },
    select: { vapiCallId: true },
  });
  const vapiCallIds = attempts.map((a) => a.vapiCallId);

  await prisma.$transaction([
    ...(vapiCallIds.length > 0
      ? [prisma.callTranscriptLine.deleteMany({ where: { vapiCallId: { in: vapiCallIds } } })]
      : []),
    prisma.callAttempt.deleteMany({ where: { claimId } }),
    prisma.callQueue.deleteMany({ where: { claimId } }),
    prisma.insuranceClaim.delete({ where: { id: claimId } }),
  ]);
}

export async function runDataRetentionForPractice(
  prisma: PrismaClient,
  practiceId: string,
  now: Date = new Date(),
): Promise<RetentionPurgeResult> {
  const result: RetentionPurgeResult = {
    practiceId,
    ran: false,
    claimsPurged: 0,
    auditLogRowsPurged: 0,
    phiAccessEventRowsPurged: 0,
    errors: [],
  };

  const settings = await getPracticeSettings(prisma, practiceId);
  if (!settings.retention.purgeEnabled) {
    return result;
  }
  result.ran = true;

  const claimCutoff = monthsAgo(settings.retention.claimRetentionMonths, now);
  const auditLogCutoff = monthsAgo(settings.retention.auditLogRetentionMonths, now);
  const phiAccessEventCutoff = monthsAgo(settings.retention.phiAccessEventRetentionMonths, now);

  const expiredClaims = await prisma.insuranceClaim.findMany({
    where: { practiceId, status: 'RESOLVED', resolvedAt: { lt: claimCutoff } },
    select: { id: true },
  });
  for (const { id } of expiredClaims) {
    try {
      await purgeClaim(prisma, id);
      result.claimsPurged++;
    } catch (err) {
      result.errors.push(`claim ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    const auditLogDeleted = await prisma.auditLog.deleteMany({
      where: { practiceId, createdAt: { lt: auditLogCutoff } },
    });
    result.auditLogRowsPurged = auditLogDeleted.count;
  } catch (err) {
    result.errors.push(`auditLog: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const phiAccessEventDeleted = await prisma.phiAccessEvent.deleteMany({
      where: { practiceId, createdAt: { lt: phiAccessEventCutoff } },
    });
    result.phiAccessEventRowsPurged = phiAccessEventDeleted.count;
  } catch (err) {
    result.errors.push(`phiAccessEvent: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/** Runs the retention purge for every practice. One practice's failure does not block the rest. */
export async function runDataRetentionAcrossPractices(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<RetentionPurgeResult[]> {
  if (!isDataRetentionGloballyEnabled()) {
    return [];
  }
  const practices = await prisma.practice.findMany({ select: { id: true } });
  const results: RetentionPurgeResult[] = [];
  for (const { id: practiceId } of practices) {
    try {
      results.push(await runDataRetentionForPractice(prisma, practiceId, now));
    } catch (err) {
      results.push({
        practiceId,
        ran: false,
        claimsPurged: 0,
        auditLogRowsPurged: 0,
        phiAccessEventRowsPurged: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }
  return results;
}
