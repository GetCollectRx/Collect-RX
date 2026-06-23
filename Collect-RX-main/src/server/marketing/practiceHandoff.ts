import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { logProspectActivity } from './prospectActivity.js';
import { maybeStartReferralSequence } from './referralEngine.js';
import { syncProspectStageToHubspot } from './hubspotSync.js';

function defaultTimezone(province: string | null): string {
  const p = (province || '').toUpperCase();
  if (['BC', 'AB', 'SK', 'MB'].includes(p)) return 'America/Vancouver';
  if (['ON', 'QC', 'NB', 'NS', 'PE', 'NL'].includes(p)) return 'America/Toronto';
  return 'America/Toronto';
}

export interface PracticeHandoffResult {
  practiceId: string;
  created: boolean;
  ownerEmail: string | null;
  temporaryPassword: string | null;
}

export async function createPracticeFromProspect(
  prisma: PrismaClient,
  prospectId: string,
  opts: { temporaryPassword?: string } = {},
): Promise<PracticeHandoffResult> {
  const prospect = await prisma.prospect.findUniqueOrThrow({ where: { id: prospectId } });

  if (prospect.linkedPracticeId) {
    return {
      practiceId: prospect.linkedPracticeId,
      created: false,
      ownerEmail: prospect.email,
      temporaryPassword: null,
    };
  }

  const temporaryPassword =
    opts.temporaryPassword?.trim() ||
    process.env.MARKETING_PRACTICE_TEMP_PASSWORD?.trim() ||
    randomBytes(9).toString('base64url');

  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  const practice = await prisma.practice.create({
    data: {
      name: prospect.practiceName,
      timezone: defaultTimezone(prospect.province),
      passwordHash,
    },
  });

  let ownerEmail: string | null = null;
  if (prospect.email?.trim()) {
    ownerEmail = prospect.email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
    if (!existingUser) {
      await prisma.user.create({
        data: {
          practiceId: practice.id,
          email: ownerEmail,
          passwordHash,
          role: 'practice_owner',
          displayName: prospect.contactName?.trim() || prospect.practiceName,
        },
      });
    }
  }

  await prisma.prospect.update({
    where: { id: prospectId },
    data: { linkedPracticeId: practice.id },
  });

  await logProspectActivity(
    prisma,
    prospectId,
    'practice_created',
    `Practice record created (${practice.id})`,
    { practiceId: practice.id, ownerEmail },
  );

  return {
    practiceId: practice.id,
    created: true,
    ownerEmail,
    temporaryPassword: prospect.email ? temporaryPassword : null,
  };
}

export async function handleProspectClosedWon(
  prisma: PrismaClient,
  prospectId: string,
): Promise<PracticeHandoffResult> {
  const prospect = await prisma.prospect.findUniqueOrThrow({ where: { id: prospectId } });
  await maybeStartReferralSequence(prisma, prospect);
  const handoff = await createPracticeFromProspect(prisma, prospectId);
  void syncProspectStageToHubspot(prisma, prospectId, 'closed_won').catch((err) => {
    console.warn('[hubspot] closed_won sync failed', (err as Error).message);
  });
  return handoff;
}
