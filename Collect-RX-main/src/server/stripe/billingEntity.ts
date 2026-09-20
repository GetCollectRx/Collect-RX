/**
 * Resolves which entity actually pays for a practice's CollectRx usage —
 * itself, or its Organization when the DSO is billed centrally (enterprise
 * deal). Every practice bills individually until an org-level checkout has
 * actually been initiated for its Organization (Organization.stripeCustomerId
 * set) — creating an Organization on its own does not opt a practice into
 * pooled billing, matching how a fresh Practice's own stripeCustomerId is
 * null until its owner checks out.
 */
import type { PrismaClient } from '@prisma/client';

export type BillingEntity =
  | { kind: 'practice'; practiceId: string }
  | { kind: 'organization'; organizationId: string; memberPracticeIds: string[] };

export async function resolveBillingEntity(
  prisma: PrismaClient,
  practiceId: string,
): Promise<BillingEntity> {
  const link = await prisma.organizationPractice.findFirst({
    where: { practiceId },
    select: { organizationId: true },
  });
  if (!link) return { kind: 'practice', practiceId };

  const org = await prisma.organization.findUnique({
    where: { id: link.organizationId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!org?.stripeCustomerId) return { kind: 'practice', practiceId };

  const members = await prisma.organizationPractice.findMany({
    where: { organizationId: org.id },
    select: { practiceId: true },
  });
  return {
    kind: 'organization',
    organizationId: org.id,
    memberPracticeIds: members.map((m) => m.practiceId),
  };
}
