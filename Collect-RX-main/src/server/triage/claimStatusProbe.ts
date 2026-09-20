/**
 * Pre-call triage — cheapest-channel-first claim status resolution.
 *
 * Before a queued claim is dispatched to a voice agent, each registered
 * channel gets a chance to answer "does this claim still need a phone call?"
 * A carrier call is the most expensive channel in the system, so anything
 * that can close a claim here (a PMS sync that already recorded payment,
 * later a carrier portal lookup or CDAnet status transaction) saves the
 * full call cost and a queue slot.
 *
 * Channels are ordered cheapest-first and the first definitive answer wins.
 * Returning null means "no signal — ask the next channel"; if every channel
 * returns null the claim proceeds to dispatch.
 */

import type { PrismaClient } from '@prisma/client';
import { enrolledCdanetClaimStatusAdapter } from './cdanetClaimStatusAdapter.js';
import { logger } from '../observability/logger.js';

export interface TriageResolution {
  action: 'CLOSE_RESOLVED';
  channel: string;
  detail: string;
}

export interface TriageClaimRef {
  id: string;
  practiceId: string;
}

export interface TriageChannel {
  id: string;
  probe(prisma: PrismaClient, claim: TriageClaimRef): Promise<TriageResolution | null>;
}

/**
 * pms-sync: the practice's own PMS data may already show the claim resolved —
 * imports run continuously, and a payment can land between queueing and
 * dispatch. The queue row's claim snapshot is stale by design, so re-read.
 */
const pmsSyncChannel: TriageChannel = {
  id: 'pms-sync',
  async probe(prisma, claim) {
    const fresh = await prisma.insuranceClaim.findUnique({
      where: { id: claim.id },
      select: { status: true, outstandingAmount: true },
    });
    if (!fresh) return null;

    if (fresh.status === 'RESOLVED') {
      return {
        action: 'CLOSE_RESOLVED',
        channel: this.id,
        detail: 'Claim already RESOLVED in PMS-synced data — no call needed.',
      };
    }
    if (Number(fresh.outstandingAmount) <= 0) {
      return {
        action: 'CLOSE_RESOLVED',
        channel: this.id,
        detail: 'Outstanding amount is zero in PMS-synced data — payment already recorded.',
      };
    }
    return null;
  },
};

/**
 * Ordered cheapest-first. CDAnet is currently an enrolled, explicitly
 * no-signal contract adapter; it cannot issue Tx23 or any network request.
 */
const enrolledCdanetChannel: TriageChannel = {
  id: enrolledCdanetClaimStatusAdapter.id,
  probe: (prisma, claim) =>
    enrolledCdanetClaimStatusAdapter.probe(prisma, {
      practiceId: claim.practiceId,
      claimId: claim.id,
    }),
};

export const TRIAGE_CHANNELS: readonly TriageChannel[] = [pmsSyncChannel, enrolledCdanetChannel];

export async function probeClaimStatus(
  prisma: PrismaClient,
  claim: TriageClaimRef,
): Promise<TriageResolution | null> {
  for (const channel of TRIAGE_CHANNELS) {
    try {
      const resolution = await channel.probe(prisma, claim);
      if (resolution) return resolution;
    } catch (err) {
      // A broken triage channel must never block dispatch — the phone
      // call is the fallback for everything, including triage itself.
      logger.error('[triage] channel failed (non-fatal)', { channelId: channel.id, error: err });
    }
  }
  return null;
}
