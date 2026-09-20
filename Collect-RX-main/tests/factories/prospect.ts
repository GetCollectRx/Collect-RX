import type { Prospect } from '@prisma/client';

/**
 * Build a complete in-memory `Prospect` row for marketing unit tests.
 *
 * Typed as `Prospect` rather than a partial so that a column added to the model
 * breaks every caller at compile time. Five near-identical literals previously
 * lived inline across the marketing suite and had each drifted six fields behind
 * the schema, which meant those tests exercised a shape the database could not
 * produce.
 */
export function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  const now = new Date();
  return {
    id: 'p1',
    practiceName: 'Downtown Dental',
    contactName: null,
    email: 'office@downtown.ca',
    phone: '4165550100',
    city: 'Toronto',
    province: 'ON',
    website: null,
    googlePlaceId: null,
    score: 80,
    stage: 'contacted',
    source: 'harvest',
    pmsHint: null,
    sequenceStep: 1,
    sequencePausedUntil: null,
    sequenceCompleted: false,
    referralStep: 0,
    referralCompleted: false,
    emailOpenCount: 0,
    emailClickCount: 0,
    lastEmailSentAt: null,
    lastEngagedAt: null,
    closedWonAt: null,
    demoScheduledAt: null,
    preDemoEmailSentAt: null,
    dnclCheckedAt: null,
    dnclListed: null,
    hubspotDealId: null,
    campaignId: null,
    linkedPracticeId: null,
    optOutAt: null,
    trialStartedAt: null,
    trialSequenceStep: 0,
    emailSequenceStep: 0,
    personaBucket: null,
    personaConfidence: null,
    personaReasoning: null,
    personaAssignedAt: null,
    pendingOutreachApproval: false,
    initialEmailSentAt: null,
    followUpEmailSentAt: null,
    followUpScheduledFor: null,
    emailRepliedAt: null,
    emailBounceReason: null,
    callSummary: null,
    replyIntent: null,
    suggestedReply: null,
    painPoints: null,
    metadata: null,
    lastVapiCallId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
