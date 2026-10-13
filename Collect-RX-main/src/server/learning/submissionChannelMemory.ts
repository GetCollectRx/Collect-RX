/**
 * Carrier submission-channel memory.
 *
 * Claims_Agent's Scenario A ("claim not received, please resubmit") and
 * Scenario D ("documentation required") both ask the carrier rep how to
 * submit — every single call, even the hundredth call to the same carrier.
 * A real front-desk caller who has done this before would not ask cold; the
 * repeated ask is itself a tell that this is not a consistent human caller.
 *
 * This module closes that gap: it stores what a rep has actually stated
 * about where resubmissions/documentation go, keyed per carrier (not per
 * practice — the destination is the carrier's, not the practice's), and
 * hands it back at dispatch time so the agent can confirm a known channel
 * instead of asking from zero.
 *
 * Source of truth is always a live call — nothing here is asserted by the
 * AI itself, only what a rep said on a previously validated call. A rep
 * giving a different destination than what's on file overwrites it (carrier
 * processes change; the newest confirmed statement wins).
 */

import type { CarrierChannelType, CarrierId, PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger.js';
import { LEARNING_CONTRIBUTION_DISABLED, loadPracticeLearningPolicy } from './learningPolicy.js';

export interface SubmissionChannelObservation {
  /** Practice whose call produced the observation. Required so the contribution flag is checked. */
  practiceId: string;
  carrierId: CarrierId;
  channelType: CarrierChannelType;
  submissionMethod: string;
  submissionDestination: string;
  sourceCallAttemptId?: string;
}

/**
 * Record (or refresh) what a rep said about where resubmissions or
 * documentation should go. Called from the async claims validator after a
 * call's extracted facts pass validation — never from unvalidated data.
 */
export async function recordSubmissionChannelObservation(
  prisma: PrismaClient,
  obs: SubmissionChannelObservation,
): Promise<void> {
  const method = obs.submissionMethod.trim();
  const destination = obs.submissionDestination.trim();
  if (!method || !destination) return;

  const policy = await loadPracticeLearningPolicy(prisma, obs.practiceId);
  if (!policy.learningContribution) {
    logger.info('[submissionChannelMemory] skipped', {
      reasonCode: LEARNING_CONTRIBUTION_DISABLED,
      carrierId: obs.carrierId,
    });
    return;
  }

  const existing = await prisma.carrierSubmissionChannel.findUnique({
    where: { carrierId_channelType: { carrierId: obs.carrierId, channelType: obs.channelType } },
  });

  const sameAsOnFile =
    existing?.submissionMethod === method && existing?.submissionDestination === destination;

  await prisma.carrierSubmissionChannel.upsert({
    where: { carrierId_channelType: { carrierId: obs.carrierId, channelType: obs.channelType } },
    create: {
      carrierId: obs.carrierId,
      channelType: obs.channelType,
      submissionMethod: method,
      submissionDestination: destination,
      timesConfirmed: 1,
      lastConfirmedAt: new Date(),
      sourceCallAttemptId: obs.sourceCallAttemptId,
    },
    update: {
      submissionMethod: method,
      submissionDestination: destination,
      // A changed destination resets the confirmation count — it's a new
      // fact, not a repeat of the old one.
      timesConfirmed: sameAsOnFile ? { increment: 1 } : 1,
      lastConfirmedAt: new Date(),
      sourceCallAttemptId: obs.sourceCallAttemptId,
    },
  });
}

/**
 * Known channel text for injection into a Claims_Agent call variable, e.g.
 * "fax to 555-0100" — empty string when nothing is on file yet, which the
 * prompt's {{#if}} branch treats as "ask the rep, same as today."
 */
export async function getKnownSubmissionChannel(
  prisma: PrismaClient,
  carrierId: CarrierId,
  channelType: CarrierChannelType,
  practiceId: string,
): Promise<string> {
  const policy = await loadPracticeLearningPolicy(prisma, practiceId);
  if (!policy.learningConsumption) return '';
  const row = await prisma.carrierSubmissionChannel.findUnique({
    where: { carrierId_channelType: { carrierId, channelType } },
  });
  if (!row) return '';
  return `${row.submissionMethod} to ${row.submissionDestination}`;
}
