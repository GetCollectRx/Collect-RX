import type { PrismaClient } from '@prisma/client';

/**
 * Dispatch rollout flags, stored in the same FeatureFlag table as the CSV AR
 * flags: one row per practice, or a global row (practiceId null).
 *
 * Resolution, most specific first:
 *   1. a row for this practice decides (paused = off, not paused = on);
 *   2. otherwise a paused global row turns the feature off;
 *   3. otherwise the feature is ON (no row at all means on).
 *
 * Because "no row" is on, a deploy that has no global pause row in place turns
 * the feature on for every practice at once. A staged release therefore starts
 * with a global pause row, enables practices one at a time with practice rows,
 * and removes the global row last (docs/runbooks/manual-dispatch-rollback.md).
 */
export const DISPATCH_FEATURES = {
  /**
   * The manual "Call now" route dials through the shared dispatch decision and
   * call builder. While this is off the route does not dial at all: the
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
    select: { practiceId: true, paused: true },
  });
  const practiceFlag = flags.find((flag) => flag.practiceId === practiceId);
  if (practiceFlag) return !practiceFlag.paused;
  return !flags.some((flag) => flag.practiceId === null && flag.paused);
}
