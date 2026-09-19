import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Practice, Prisma } from '@prisma/client';
import { trialEndDate } from '../../billing/tiers.js';

const BCRYPT_ROUNDS = 12;

/** Practice.passwordHash is legacy-only (User.passwordHash is what login uses) — never issued to anyone. */
export function unusedLegacyPasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
}

/**
 * Creates a Practice row and links it into an Organization via
 * OrganizationPractice, both inside the caller's transaction. Shared by
 * admin-assisted org creation, self-serve org signup, and adding a location
 * to an existing org — all three need identical practice provisioning.
 */
export async function createOrgPractice(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: {
    practiceName: string;
    timezone?: string;
    passwordHash: string;
    settings?: object;
    privacyPolicyAcceptedAt?: Date;
    privacyPolicyVersion?: string;
  },
): Promise<Practice> {
  const practice = await tx.practice.create({
    data: {
      name: input.practiceName,
      timezone: input.timezone ?? 'America/Toronto',
      passwordHash: input.passwordHash,
      billingTier: 'trial',
      trialEndsAt: trialEndDate(),
      ...(input.settings ? { settings: input.settings } : {}),
      ...(input.privacyPolicyAcceptedAt ? { privacyPolicyAcceptedAt: input.privacyPolicyAcceptedAt } : {}),
      ...(input.privacyPolicyVersion ? { privacyPolicyVersion: input.privacyPolicyVersion } : {}),
    },
  });
  await tx.organizationPractice.create({
    data: { organizationId, practiceId: practice.id },
  });
  return practice;
}
