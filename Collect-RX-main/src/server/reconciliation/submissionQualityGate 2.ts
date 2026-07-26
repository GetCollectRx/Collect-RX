import { Prisma, type PrismaClient } from '@prisma/client';

export type SubmissionClearance = 'GREEN' | 'YELLOW' | 'RED';

export interface SubmissionQualityFinding {
  code: string;
  severity: SubmissionClearance;
  message: string;
}

export interface SubmissionQualityReport {
  clearance: SubmissionClearance;
  findings: SubmissionQualityFinding[];
}

export async function evaluateSubmissionQuality(
  prisma: PrismaClient,
  practiceId: string,
  claimId: string,
): Promise<SubmissionQualityReport> {
  const claim = await prisma.insuranceClaim.findFirst({
    where: { id: claimId, practiceId, deletedAt: null },
    select: {
      id: true,
      claimNumber: true,
      treatmentCodes: true,
      submittedAt: true,
      servicedAt: true,
      expectedAmount: true,
      outstandingAmount: true,
      denialReasonCode: true,
      patientToken: true,
    },
  });

  if (!claim) {
    return { clearance: 'RED', findings: [{ code: 'NOT_FOUND', severity: 'RED', message: 'Claim not found' }] };
  }

  const findings: SubmissionQualityFinding[] = [];

  if (!claim.treatmentCodes?.trim()) {
    findings.push({
      code: 'MISSING_CDT',
      severity: 'RED',
      message: 'No procedure codes on claim — carrier will reject or pend.',
    });
  }

  if (!claim.submittedAt) {
    findings.push({
      code: 'MISSING_SUBMIT_DATE',
      severity: 'YELLOW',
      message: 'Submission date missing — add before carrier follow-up.',
    });
  }

  if (!claim.servicedAt) {
    findings.push({
      code: 'MISSING_DOS',
      severity: 'YELLOW',
      message: 'Date of service missing — appeal deadlines may be inaccurate.',
    });
  }

  if (claim.expectedAmount == null || Number(claim.expectedAmount) <= 0) {
    findings.push({
      code: 'MISSING_EXPECTED',
      severity: 'YELLOW',
      message: 'Expected carrier payment not set — underpayment detection disabled.',
    });
  }

  if (claim.denialReasonCode) {
    findings.push({
      code: 'PRIOR_DENIAL',
      severity: 'RED',
      message: `Prior denial on file (${claim.denialReasonCode}) — resolve before resubmit.`,
    });
  }

  const blockingGate = await prisma.claimRecoveryAction.findFirst({
    where: {
      claimId,
      status: 'BLOCKING',
      actionType: 'SUBMISSION_QUALITY',
    },
  });

  const clearance: SubmissionClearance = findings.some((f) => f.severity === 'RED')
    ? 'RED'
    : findings.some((f) => f.severity === 'YELLOW')
      ? 'YELLOW'
      : 'GREEN';

  if (clearance !== 'GREEN' && !blockingGate) {
    await prisma.claimRecoveryAction.create({
      data: {
        practiceId,
        claimId,
        actionType: 'SUBMISSION_QUALITY',
        status: clearance === 'RED' ? 'BLOCKING' : 'OPEN',
        route: 'PRACTICE_GATE',
        title: 'Submission readiness defects',
        detail: findings.map((f) => f.message).join(' '),
        metadata: { findings, clearance } as unknown as Prisma.InputJsonValue,
      },
    });
  } else if (clearance === 'GREEN' && blockingGate) {
    await prisma.claimRecoveryAction.update({
      where: { id: blockingGate.id },
      data: { status: 'CLEARED', clearedAt: new Date() },
    });
  }

  return { clearance, findings };
}
