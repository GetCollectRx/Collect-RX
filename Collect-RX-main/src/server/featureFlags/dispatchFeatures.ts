import type { PrismaClient } from '@prisma/client';

/**
 * Dispatch rollout flags, stored in the same FeatureFlag table as the CSV AR
 * flags: one row per practice, or a global row (practiceId null).
 *
 * Resolution, most specific first:
 *   1. a row for this practice decides (paused = off, not paused = on);
 *   2. otherwise a global row decides (paused = off, not paused = on);
 *   3. otherwise the feature's default applies (most are ON; see DEFAULT_OFF).
 *
 * Because "no row" is on for a default-on feature, a deploy that has no global pause row in place turns
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
  /**
   * DEC-9 (b): staff approve a carrier once per practice before the first call
   * to it. DEFAULT OFF: with no row the checkpoint is not enforced, so a deploy
   * never stalls calling. Turn it on per practice with a practice row whose
   * paused column is false; a global row with paused = false turns it on for
   * every practice without its own row.
   */
  APPROVAL_CHECKPOINT: 'dispatch.approval_checkpoint',
} as const;

export type DispatchFeature = (typeof DISPATCH_FEATURES)[keyof typeof DISPATCH_FEATURES];

const DEFAULT_OFF: ReadonlySet<DispatchFeature> = new Set([DISPATCH_FEATURES.APPROVAL_CHECKPOINT]);

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
  // The unique index does not constrain NULL practice ids, so more than one
  // global row can exist: any paused one wins.
  const globalFlags = flags.filter((flag) => flag.practiceId === null);
  if (globalFlags.length > 0) return !globalFlags.some((flag) => flag.paused);
  return !DEFAULT_OFF.has(feature);
}
