/**
 * Resolves which plan's features a practice can use. An org-billed practice
 * gets the organization's plan, since that is what is being paid for; its own
 * billingTier stays at trial once the org takes over billing.
 */
import type { BillingTier, PrismaClient } from '@prisma/client';
import { type Feature, featuresForTier, tierAllows } from '../../billing/entitlements.js';
import { resolveBillingEntity } from '../stripe/billingEntity.js';

export async function planTierForPractice(
  prisma: PrismaClient,
  practiceId: string,
): Promise<BillingTier | null> {
  const entity = await resolveBillingEntity(prisma, practiceId);
  if (entity.kind === 'organization') {
    const org = await prisma.organization.findUnique({
      where: { id: entity.organizationId },
      select: { billingTier: true },
    });
    return org?.billingTier ?? 'trial';
  }
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { billingTier: true },
  });
  return practice?.billingTier ?? null;
}

export async function practiceHasFeature(
  prisma: PrismaClient,
  practiceId: string,
  feature: Feature,
): Promise<boolean> {
  return tierAllows(await planTierForPractice(prisma, practiceId), feature);
}

export async function practiceFeatures(prisma: PrismaClient, practiceId: string): Promise<Feature[]> {
  return featuresForTier(await planTierForPractice(prisma, practiceId));
}
