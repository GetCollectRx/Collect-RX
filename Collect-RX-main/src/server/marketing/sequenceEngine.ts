/**
 * Marketing Sequence Engine
 *
 * Drives the multi-step email outreach cadence for ProspectPractice records.
 * Called by the BullMQ MARKETING_SEQUENCE_TICK job (once per hour).
 *
 * Flow:
 *   1. Find all active ProspectSequences with nextRunAt <= now
 *   2. For email_cadence sequences: send the current step's email, then
 *      advance to the next step or mark completed
 *   3. Log every action as a ProspectEvent
 *   4. Hard-stop if prospect has optedOutAt set
 */

import type { PrismaClient } from '@prisma/client';
import { buildEmailSteps, EMAIL_CADENCE_TOTAL_STEPS } from './emailTemplates.js';
import { buildProspectUnsubscribeUrl } from './unsubscribeUrl.js';
import { personalizeEmailIntro } from './aiPersonalization.js';

function getSendGrid() {
  if (!process.env.SENDGRID_API_KEY) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sg = require('@sendgrid/mail');
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  return sg;
}

function getSenderConfig() {
  return {
    fromEmail: process.env.MARKETING_SENDER_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'noreply@collectrx.ca',
    senderName: process.env.MARKETING_SENDER_NAME || 'CollectRx Team',
    demoUrl: process.env.MARKETING_DEMO_URL || 'https://collectrx.ca/demo',
    baseUrl: process.env.API_BASE_URL || 'https://api.collectrx.ca',
  };
}

/** Add N calendar days to a date, preserving time-of-day. */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export async function runMarketingSequenceTick(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const cfg = getSenderConfig();
  const sg = getSendGrid();

  const dueSequences = await prisma.prospectSequence.findMany({
    where: {
      status: 'active',
      sequenceType: 'email_cadence',
      nextRunAt: { lte: now },
    },
    include: {
      prospect: true,
    },
    take: 100,
  });

  for (const seq of dueSequences) {
    const prospect = seq.prospect;

    // Hard-stop if opted out
    if (prospect.optedOutAt) {
      await prisma.prospectSequence.update({
        where: { id: seq.id },
        data: { status: 'stopped', completedAt: now, updatedAt: now },
      });
      continue;
    }

    if (seq.sequenceType === 'email_cadence') {
      await processEmailStep(prisma, seq, prospect, sg, cfg, now);
    }
    // voice_call and manual sequences are triggered ad-hoc, not by this tick
  }
}

async function processEmailStep(
  prisma: PrismaClient,
  seq: { id: string; currentStep: number; totalSteps: number; startedAt: Date },
  prospect: { id: string; name: string; city: string | null; email: string | null; province: string | null; practiceSize: string | null; pmsGuess: string | null; website: string | null; score: number },
  sg: ReturnType<typeof getSendGrid>,
  cfg: ReturnType<typeof getSenderConfig>,
  now: Date,
): Promise<void> {
  const nextStep = seq.currentStep + 1;

  if (!prospect.email) {
    await prisma.prospectSequence.update({
      where: { id: seq.id },
      data: { status: 'stopped', completedAt: now, updatedAt: now },
    });
    return;
  }

  const unsubUrl = buildProspectUnsubscribeUrl(cfg.baseUrl, prospect.id);
  const steps = buildEmailSteps({
    practiceName: prospect.name,
    city: prospect.city,
    senderName: cfg.senderName,
    demoUrl: cfg.demoUrl,
    unsubUrl,
  });

  const stepDef = steps.find((s) => s.step === nextStep);
  if (!stepDef) {
    // All steps done
    await prisma.prospectSequence.update({
      where: { id: seq.id },
      data: { status: 'completed', completedAt: now, currentStep: seq.currentStep, updatedAt: now },
    });
    return;
  }

  // Step 1: inject AI-generated personalized intro paragraph
  let emailHtml = stepDef.html;
  if (nextStep === 1) {
    const personalizedIntro = await personalizeEmailIntro({
      practiceName: prospect.name,
      city: prospect.city,
      province: prospect.province,
      pmsGuess: prospect.pmsGuess,
      practiceSize: prospect.practiceSize as 'solo' | 'small_group' | 'large_group' | null,
      website: prospect.website,
    });
    if (personalizedIntro) {
      // Replace the generic opening paragraph with AI-personalized version
      emailHtml = emailHtml.replace(
        /<p>I'm .+?<\/p>/s,
        `<p>${personalizedIntro}</p><p>I'm ${cfg.senderName} from <strong>CollectRx</strong> — we build AI-powered follow-up agents that call insurance carriers on behalf of Canadian dental practices to resolve outstanding claims.</p>`,
      );
    }
  }

  let emailSent = false;
  let errorMsg: string | undefined;

  if (sg) {
    try {
      await sg.send({
        to: prospect.email,
        from: { email: cfg.fromEmail, name: cfg.senderName },
        subject: stepDef.subject,
        html: emailHtml,
        customArgs: { prospect_id: prospect.id, sequence_id: seq.id, step: String(nextStep) },
        headers: { 'X-Prospect-Id': prospect.id },
      });
      emailSent = true;
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[marketingSequence] SendGrid error for prospect ${prospect.id} step ${nextStep}:`, errorMsg);
    }
  } else {
    // No SendGrid configured — log without sending
    console.warn(`[marketingSequence] SENDGRID_API_KEY not set; skipping email to ${prospect.email}`);
    emailSent = true; // advance sequence even in dev
  }

  const isLastStep = nextStep >= EMAIL_CADENCE_TOTAL_STEPS;
  const newStatus = isLastStep ? 'completed' : 'active';
  const nextRunDate = isLastStep
    ? null
    : addDays(now, steps[nextStep]?.dayOffset - stepDef.dayOffset || 3);

  await prisma.$transaction([
    prisma.prospectSequence.update({
      where: { id: seq.id },
      data: {
        currentStep: nextStep,
        status: newStatus,
        nextRunAt: nextRunDate,
        completedAt: isLastStep ? now : null,
        updatedAt: now,
      },
    }),
    prisma.prospectEvent.create({
      data: {
        prospectId: prospect.id,
        sequenceId: seq.id,
        type: emailSent ? 'email_sent' : 'email_bounced',
        metadata: {
          step: nextStep,
          subject: stepDef.subject,
          to: prospect.email,
          ...(errorMsg ? { error: errorMsg } : {}),
        },
        occurredAt: now,
      },
    }),
    // Advance prospect stage to 'contacted' if still 'new'
    prisma.prospectPractice.updateMany({
      where: { id: prospect.id, stage: 'new' },
      data: { stage: 'contacted', updatedAt: now },
    }),
  ]);
}

/**
 * Start an email cadence sequence for a prospect.
 * Idempotent: does nothing if an active email_cadence already exists.
 */
export async function startEmailCadence(
  prisma: PrismaClient,
  prospectId: string,
  sendImmediately = false,
): Promise<{ sequenceId: string; alreadyActive: boolean }> {
  const existing = await prisma.prospectSequence.findFirst({
    where: { prospectId, sequenceType: 'email_cadence', status: 'active' },
  });
  if (existing) {
    return { sequenceId: existing.id, alreadyActive: true };
  }

  const now = new Date();
  const seq = await prisma.prospectSequence.create({
    data: {
      prospectId,
      sequenceType: 'email_cadence',
      status: 'active',
      currentStep: 0,
      totalSteps: EMAIL_CADENCE_TOTAL_STEPS,
      nextRunAt: sendImmediately ? now : addDays(now, 0),
      startedAt: now,
      updatedAt: now,
    },
  });

  await prisma.prospectEvent.create({
    data: {
      prospectId,
      sequenceId: seq.id,
      type: 'stage_changed',
      metadata: { action: 'email_cadence_started', step: 0 },
      occurredAt: now,
    },
  });

  return { sequenceId: seq.id, alreadyActive: false };
}
