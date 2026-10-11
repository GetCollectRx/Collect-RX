import type { PrismaClient } from '@prisma/client';

/**
 * Dispatch rollout flags. Same table as the CSV AR flags: a row in FeatureFlag, per
 * practice or global (practiceId null). The feature is ON unless a paused row
 * exists at either scope, so pausing any applicable row is the rollback.
 */
export const DISPATCH_FEATURES = {
  /**
   * The manual "Call now" route dials through the shared dispatch decision and
   * call builder. While this is paused the route does not dial at all: the
   * previous manual path is intentionally not kept, because it could not
   * select the human-assisted squad.
   */
  MANUAL_SHARED_BUILDER: 'dispatch.manual_shared_builder',
} as const;

export type DispatchFeature = (typeof DISPATCH_FEATURES)[keyof typeof DISPATCH_FEATURES];

export async function isDispatchFeatureEnabled(
  prisma: PrismaClient,
  practiceId: string,
  feature: DispatchFeature,
): Promise<boolean> {
  const flags = await prisma.featureFlag.findMany({
    where: {
      feature,
      OR: [{ practiceId }, { practiceId: null }],
    },
    select: { paused: true },
  });
  // Kill-switch semantics: a paused row at either scope turns the feature off.
  // No row means on (staged rollout uses explicit pause rows).
  return !flags.some((flag) => flag.paused);
}
