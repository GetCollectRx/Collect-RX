import type { CallAttempt, CarrierId, PrismaClient } from '@prisma/client';

const MAX_ATTEMPTS = 3;
const MAX_LESSONS = 5;

export type FailureReviewAttempt = {
  attemptNumber: number;
  initiatedAt: string;
  completedAt: string | null;
  outcome: string | null;
  transcriptAvailable: boolean;
  validationPassed: boolean | null;
  carrierBlockDetected: boolean;
};

export type MaxAttemptFailureReview = {
  claimId: string;
  claimRef: string;
  carrierId: CarrierId;
  attempts: FailureReviewAttempt[];
  summary: string;
  recommendation: string;
  approvedCarrierLessons: string[];
};

type ApprovedLesson = {
  recommendation: string;
};

function isSafeApprovedLesson(recommendation: string): boolean {
  return !/\b\d{6,}\b|\b\d{4}-\d{2}-\d{2}\b|@|\+?\d[\d .()-]{8,}\d/.test(recommendation);
}

function recommendationForAttempts(attempts: CallAttempt[]): string {
  if (attempts.some((attempt) => attempt.carrierBlockDetected)) {
    return 'Do not retry this claim. Keep the carrier block in place and follow the carrier-block review process.';
  }
  if (attempts.some((attempt) => attempt.outcome === 'DENIED')) {
    return 'Review the denial with a billing lead and prepare the required resubmission, documentation, or appeal before any further carrier contact.';
  }
  if (attempts.some((attempt) => attempt.outcome === 'ESCALATED' || attempt.validationPassed === false)) {
    return 'Assign this claim to a billing lead for manual carrier follow-up; do not schedule another automated call.';
  }
  if (attempts.every((attempt) => ['NO_ANSWER', 'HUNG_UP', 'FAILED', null].includes(attempt.outcome))) {
    return 'Assign this claim to a billing lead for manual carrier follow-up; the automated attempt limit has been reached.';
  }
  return 'Review the structured call outcomes with a billing lead and choose a documented manual recovery path; do not schedule another automated call.';
}

function summaryForAttempts(attempts: CallAttempt[]): string {
  const transcriptCount = attempts.filter((attempt) => Boolean(attempt.transcriptText)).length;
  const outcomes = attempts
    .map((attempt) => attempt.outcome ?? 'INCOMPLETE')
    .join(', ');

  return `${attempts.length}/${MAX_ATTEMPTS} automated attempts completed or started; outcomes: ${outcomes}. ${transcriptCount}/${attempts.length} attempt transcripts are available for authorized staff review.`;
}

export function buildMaxAttemptFailureReview(
  claimId: string,
  claimNumber: string,
  carrierId: CarrierId,
  attempts: CallAttempt[],
  approvedLessons: ApprovedLesson[],
): MaxAttemptFailureReview {
  const orderedAttempts = [...attempts].sort(
    (a, b) => a.initiatedAt.getTime() - b.initiatedAt.getTime(),
  );

  return {
    claimId,
    claimRef: claimNumber.startsWith('CRX-') ? claimNumber : `CRX-${claimNumber}`,
    carrierId,
    attempts: orderedAttempts.map((attempt, index) => ({
      attemptNumber: index + 1,
      initiatedAt: attempt.initiatedAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
      outcome: attempt.outcome,
      transcriptAvailable: Boolean(attempt.transcriptText),
      validationPassed: attempt.validationPassed,
      carrierBlockDetected: attempt.carrierBlockDetected,
    })),
    summary: summaryForAttempts(orderedAttempts),
    recommendation: recommendationForAttempts(orderedAttempts),
    approvedCarrierLessons: approvedLessons
      .map((lesson) => lesson.recommendation)
      .filter(isSafeApprovedLesson)
      .slice(0, MAX_LESSONS),
  };
}

export async function listMaxAttemptFailureReviews(
  prisma: PrismaClient,
  practiceId: string,
): Promise<MaxAttemptFailureReview[]> {
  const exhaustedEntries = await prisma.callQueue.findMany({
    where: {
      practiceId,
      attempts: { gte: MAX_ATTEMPTS },
      status: 'ESCALATED',
    },
    select: {
      claimId: true,
      claim: { select: { claimNumber: true, carrierId: true } },
    },
    take: 50,
  });
  if (exhaustedEntries.length === 0) return [];

  const claimIds = exhaustedEntries.map((entry) => entry.claimId);
  const carrierIds = [...new Set(exhaustedEntries.map((entry) => entry.claim.carrierId))];
  const [attempts, lessons] = await Promise.all([
    prisma.callAttempt.findMany({
      where: { claimId: { in: claimIds } },
      orderBy: { initiatedAt: 'asc' },
    }),
    prisma.carrierLesson.findMany({
      where: {
        carrierId: { in: carrierIds },
        status: 'APPROVED',
        category: { in: ['IVR_NAVIGATION', 'REP_INTERACTION', 'REFUSAL'] },
      },
      select: { carrierId: true, recommendation: true },
      orderBy: [{ confidence: 'desc' }, { reviewedAt: 'desc' }],
      take: carrierIds.length * MAX_LESSONS,
    }),
  ]);

  const attemptsByClaim = new Map<string, CallAttempt[]>();
  for (const attempt of attempts) {
    const existing = attemptsByClaim.get(attempt.claimId) ?? [];
    existing.push(attempt);
    attemptsByClaim.set(attempt.claimId, existing);
  }
  const lessonsByCarrier = new Map<CarrierId, ApprovedLesson[]>();
  for (const lesson of lessons) {
    const existing = lessonsByCarrier.get(lesson.carrierId) ?? [];
    if (existing.length < MAX_LESSONS) existing.push(lesson);
    lessonsByCarrier.set(lesson.carrierId, existing);
  }

  return exhaustedEntries.map((entry) =>
    buildMaxAttemptFailureReview(
      entry.claimId,
      entry.claim.claimNumber,
      entry.claim.carrierId,
      attemptsByClaim.get(entry.claimId) ?? [],
      lessonsByCarrier.get(entry.claim.carrierId) ?? [],
    ),
  );
}
