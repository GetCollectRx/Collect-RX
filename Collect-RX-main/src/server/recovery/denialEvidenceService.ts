import type { PrismaClient } from '@prisma/client';
import { evidenceRequirementsForDenial } from './denialEvidenceRules.js';

export async function syncDenialEvidenceItems(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    claimId: string;
    recoveryActionId?: string | null;
    denialReasonCode?: string | null;
    carrierId?: string | null;
    treatmentCodes?: string | null;
  },
): Promise<number> {
  const requirements = evidenceRequirementsForDenial(params);
  let created = 0;

  for (const req of requirements) {
    const existing = await prisma.claimEvidenceItem.findFirst({
      where: {
        practiceId: params.practiceId,
        claimId: params.claimId,
        recoveryActionId: params.recoveryActionId ?? null,
        evidenceType: req.evidenceType,
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.claimEvidenceItem.create({
      data: {
        practiceId: params.practiceId,
        claimId: params.claimId,
        recoveryActionId: params.recoveryActionId ?? null,
        evidenceType: req.evidenceType,
        status: 'REQUIRED',
        note: req.description,
      },
    });
    created += 1;
  }

  return created;
}
