import type { CarrierId, PrismaClient } from '@prisma/client';
import { getHumanAssistedSquadId } from '../../vapi/client.js';
import { effectiveHumanAssisted } from '../../billing/entitlements.js';
import { planTierForPractice } from '../plans/practiceEntitlements.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';
import { runWithRlsBypass } from '../db/rlsContext.js';
import type { PracticeSettings } from '../../types/practiceSettings.js';

/**
 * The execution mode every carrier dial must be started in. Both the scheduler
 * and the manual "Call now" route resolve it here so a practice can never be
 * dialed in a different mode depending on which path started the call.
 *
 * The plan, not only the practice's toggle, decides whether the AI may speak
 * with the representative (effectiveHumanAssisted). A human-assisted practice
 * always gets the human-assisted squad; an autonomous practice leaves squadId
 * unset so initiateCall() uses its configured autonomous squad.
 */
export interface DispatchMode {
  humanAssisted: boolean;
  squadId: string | undefined;
}

export function dispatchModeFor(humanAssisted: boolean): DispatchMode {
  return {
    humanAssisted,
    squadId: humanAssisted ? getHumanAssistedSquadId() : undefined,
  };
}

export async function resolveDispatchMode(
  prisma: PrismaClient,
  practiceId: string,
  settings?: Pick<PracticeSettings, 'humanAssistedMode'>,
): Promise<DispatchMode> {
  const practiceSettings = settings ?? (await getPracticeSettings(prisma, practiceId));
  const tier = await planTierForPractice(prisma, practiceId);
  return dispatchModeFor(effectiveHumanAssisted(tier, practiceSettings.humanAssistedMode));
}

/**
 * Fleet-wide count of calls in flight per carrier, for the concurrency ceiling.
 * Gathered outside any practice's RLS scope: a practice-scoped read would
 * silently narrow to that one tenant and defeat a fleet-wide limit.
 */
export async function loadCarrierActiveCounts(prisma: PrismaClient): Promise<Map<CarrierId, number>> {
  const active = await runWithRlsBypass(() =>
    prisma.callAttempt.findMany({
      where: { completedAt: null },
      select: { claim: { select: { carrierId: true } } },
    }),
  );
  const counts = new Map<CarrierId, number>();
  for (const attempt of active) {
    const carrierId = attempt.claim?.carrierId;
    if (!carrierId) continue;
    counts.set(carrierId, (counts.get(carrierId) ?? 0) + 1);
  }
  return counts;
}
