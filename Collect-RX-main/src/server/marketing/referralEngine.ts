/**
 * Referral Engine
 *
 * When a prospect moves to 'closed_won' (becomes a live Practice partner),
 * automatically schedules a referral outreach sequence:
 *
 *   Day 14: "Who else in your network should know about CollectRx?"
 *   Day 30: Final follow-up referral ask
 *
 * Referred prospects enter the pipeline with source='referral' and a +15 score
 * bonus — referral-sourced leads close 3–5× faster.
 *
 * Called from: marketingRouter PATCH /api/marketing/prospects/:id when stage → closed_won
 */

import type { PrismaClient } from '@prisma/client'

interface ReferralEmailStep {
  dayOffset: number
  subject: string
  html: string
}

function buildReferralSteps(ctx: {
  referrerName: string
  city: string | null
  senderName: string
  demoUrl: string
  unsubUrl: string
}): ReferralEmailStep[] {
  const { referrerName, city, senderName, demoUrl, unsubUrl } = ctx
  const cityStr = city ? ` in ${city}` : ''

  const footer = `
    <div style="margin-top:32px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">
      <a href="${unsubUrl}" style="color:#999">Unsubscribe</a>
    </div>
  `

  return [
    {
      dayOffset: 14,
      subject: `Quick question — who else should know about CollectRx?`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
          <p>Hi,</p>
          <p>We're thrilled to be working with ${referrerName}${cityStr}. As you settle in, we had a quick ask:</p>
          <p><strong>Do you know 1–2 other dental offices</strong> in your study club, referral network, or community that struggle with insurance follow-up? We'd love a warm introduction — and you can rest assured we'll treat them with the same care we've shown your team.</p>
          <p>If someone comes to mind, just reply with their name and I'll take it from there. No pressure at all.</p>
          <p style="margin-top:24px"><a href="${demoUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">See what they'll get →</a></p>
          <p>Thanks for the trust,<br/>${senderName}</p>
          ${footer}
        </div>
      `,
    },
    {
      dayOffset: 30,
      subject: `Last ask — a colleague for CollectRx?`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
          <p>Hi,</p>
          <p>Following up one last time. If you ever think of a colleague at a dental practice who might benefit from CollectRx — especially someone who mentions insurance headaches — we'd genuinely appreciate the intro.</p>
          <p>Just reply with their name and I'll make sure they get a thoughtful, no-pressure demo.</p>
          <p>Thanks again for being a part of CollectRx — we're looking forward to a great partnership!<br/>${senderName}</p>
          ${footer}
        </div>
      `,
    },
  ]
}

export const REFERRAL_SEQUENCE_TOTAL_STEPS = 2

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/**
 * Starts a referral ask sequence for a newly-won prospect.
 * Idempotent — safe to call multiple times for the same prospectId.
 */
export async function startReferralSequence(
  prisma: PrismaClient,
  prospectId: string,
): Promise<void> {
  const existing = await prisma.prospectSequence.findFirst({
    where: { prospectId, sequenceType: 'manual', status: 'active' },
  })
  if (existing) return

  const now = new Date()
  const steps = buildReferralSteps({
    referrerName: 'your practice',
    city: null,
    senderName: process.env.MARKETING_SENDER_NAME || 'CollectRx Team',
    demoUrl: process.env.MARKETING_DEMO_URL || 'https://collectrx.ca/demo',
    unsubUrl: '',
  })

  // For referral sequences we store type='manual' with first run at +14 days
  await prisma.prospectSequence.create({
    data: {
      prospectId,
      sequenceType: 'manual',
      status: 'active',
      currentStep: 0,
      totalSteps: REFERRAL_SEQUENCE_TOTAL_STEPS,
      nextRunAt: addDays(now, steps[0].dayOffset),
      startedAt: now,
      updatedAt: now,
    },
  })

  await prisma.prospectEvent.create({
    data: {
      prospectId,
      type: 'stage_changed',
      metadata: { action: 'referral_sequence_started' },
      occurredAt: now,
    },
  })
}

/**
 * Process the referral sequence tick — sends due referral emails.
 * Called from the same MARKETING_SEQUENCE_TICK BullMQ job.
 */
export async function runReferralSequenceTick(prisma: PrismaClient): Promise<void> {
  const now = new Date()

  const dueSequences = await prisma.prospectSequence.findMany({
    where: {
      status: 'active',
      sequenceType: 'manual',
      nextRunAt: { lte: now },
    },
    include: { prospect: true },
    take: 50,
  })

  for (const seq of dueSequences) {
    const prospect = seq.prospect
    if (prospect.optedOutAt) {
      await prisma.prospectSequence.update({
        where: { id: seq.id },
        data: { status: 'stopped', completedAt: now, updatedAt: now },
      })
      continue
    }

    if (!prospect.email) {
      await prisma.prospectSequence.update({
        where: { id: seq.id },
        data: { status: 'stopped', completedAt: now, updatedAt: now },
      })
      continue
    }

    const nextStep = seq.currentStep + 1
    const senderName = process.env.MARKETING_SENDER_NAME || 'CollectRx Team'
    const fromEmail = process.env.MARKETING_SENDER_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'noreply@collectrx.ca'
    const demoUrl = process.env.MARKETING_DEMO_URL || 'https://collectrx.ca/demo'
    const baseUrl = process.env.API_BASE_URL || 'https://api.collectrx.ca'
    const unsubUrl = `${baseUrl}/api/public/prospect-unsubscribe?p=${encodeURIComponent(prospect.id)}`

    const steps = buildReferralSteps({
      referrerName: prospect.name,
      city: prospect.city,
      senderName,
      demoUrl,
      unsubUrl,
    })
    const stepDef = steps[nextStep - 1]

    if (!stepDef) {
      await prisma.prospectSequence.update({
        where: { id: seq.id },
        data: { status: 'completed', completedAt: now, updatedAt: now },
      })
      continue
    }

    const isLast = nextStep >= REFERRAL_SEQUENCE_TOTAL_STEPS

    try {
      if (process.env.SENDGRID_API_KEY) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sg = require('@sendgrid/mail')
        sg.setApiKey(process.env.SENDGRID_API_KEY)
        await sg.send({
          to: prospect.email,
          from: { email: fromEmail, name: senderName },
          subject: stepDef.subject,
          html: stepDef.html,
          customArgs: { prospect_id: prospect.id, sequence_id: seq.id, step: String(nextStep), email_type: 'referral' },
        })
      }
    } catch (e) {
      console.error('[referralEngine] send error', (e as Error).message)
    }

    const nextStepDef = steps[nextStep]
    await prisma.$transaction([
      prisma.prospectSequence.update({
        where: { id: seq.id },
        data: {
          currentStep: nextStep,
          status: isLast ? 'completed' : 'active',
          nextRunAt: isLast || !nextStepDef ? null : addDays(now, nextStepDef.dayOffset - stepDef.dayOffset),
          completedAt: isLast ? now : null,
          updatedAt: now,
        },
      }),
      prisma.prospectEvent.create({
        data: {
          prospectId: prospect.id,
          sequenceId: seq.id,
          type: 'email_sent',
          metadata: { step: nextStep, subject: stepDef.subject, to: prospect.email, emailType: 'referral' },
          occurredAt: now,
        },
      }),
    ])
  }
}
