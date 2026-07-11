/**
 * Demo seed — creates the generic CollectRx demo practice with realistic
 * insurance AR data for development and prospect walkthroughs.
 *
 * Usage:
 *   npm run demo:seed              — seed (fails if the demo practice exists)
 *   npm run demo:seed -- --reset   — delete the existing demo practice and reseed
 *
 * Customization via environment variables:
 *   SEED_PRACTICE_NAME=MyPractice npm run demo:seed
 *   SEED_PRACTICE_EMAIL=admin@mypractice.local npm run demo:seed
 *   SEED_PRACTICE_PASSWORD=secure_password npm run demo:seed
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { syncWorkItemsForPractice } from '../src/server/services/workQueueService.js';
import { computeWorkQueueRankScore } from '../src/lib/workQueuePriority.js';

const prisma = new PrismaClient();

const DEMO_PRACTICE_NAME = 'CollectRx Demo Practice';
const DEMO_EMAIL = 'demo@collectrx-test.local';
const DEMO_OWNER_NAME = 'Demo Admin';
/** Prior demo identities — cleaned up by --reset so old seeds don't linger. */
const LEGACY_DEMO_PRACTICE_NAMES = [
  'Hasan Family Dental',
  'Maple Grove Dental',
  'Tenth Line Family Dentistry',
] as const;

/** Delete a demo practice and every row the seed creates for it, children first. */
async function deleteDemoPractice(practiceId: string): Promise<void> {
  await prisma.callAttempt.deleteMany({ where: { claim: { practiceId } } });
  await prisma.claimRecoveryEvent.deleteMany({ where: { practiceId } });
  await prisma.claimRecoveryAction.deleteMany({ where: { practiceId } });
  await prisma.adjudicationEvent.deleteMany({ where: { practiceId } });
  await prisma.callQueue.deleteMany({ where: { practiceId } });
  await prisma.appointmentVerification.deleteMany({ where: { practiceId } });
  await prisma.cdcpReconsiderationCase.deleteMany({ where: { practiceId } });
  await prisma.scheduledAppointment.deleteMany({ where: { practiceId } });
  await prisma.workItem.deleteMany({ where: { practiceId } });
  await prisma.insuranceClaim.deleteMany({ where: { practiceId } });
  await prisma.user.deleteMany({ where: { practiceId } });
  await prisma.practice.delete({ where: { id: practiceId } });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

function hoursFromNow(n: number): Date {
  return new Date(Date.now() + n * 60 * 60 * 1000);
}

const CDCP_RECONSIDERATION_DAYS = 60;

/** Denial date that yields `daysRemaining` on the 60-day CDCP reconsideration clock. */
function denialDateForDaysRemaining(daysRemaining: number): Date {
  return daysAgo(CDCP_RECONSIDERATION_DAYS - daysRemaining);
}

function claimNum(prefix: string, n: number): string {
  return `${prefix}-2025-${String(n).padStart(6, '0')}`;
}

// ─── resolved call transcripts ──────────────────────────────────────────────

const RESOLVED_OUTCOMES: Array<{ outcomeDetail: string; repName: string; referenceNumber: string }> = [
  {
    outcomeDetail: 'Spoke with Jennifer M. Claim adjudicated in full. EFT payment of $1,840 processing. Expected deposit by June 21, 2026.',
    repName: 'Jennifer M.',
    referenceNumber: 'SL-2025-847291',
  },
  {
    outcomeDetail: 'Robert at Sun Life confirmed claim approved. Cheque mailed June 3. No further action required.',
    repName: 'Robert T.',
    referenceNumber: 'SL-2025-613044',
  },
  {
    outcomeDetail: 'Sarah K. at Canada Life confirmed claim paid May 28. EFT issued. Balance cleared.',
    repName: 'Sarah K.',
    referenceNumber: 'CL-2025-038872',
  },
  {
    outcomeDetail: 'Daniel confirmed claim adjudicated. Payment $2,120 EFT this week. Crown procedure approved in full.',
    repName: 'Daniel R.',
    referenceNumber: 'GS-2025-491300',
  },
  {
    outcomeDetail: 'Manulife rep confirmed claim approved. Plan maximum not reached. Payment $980 by June 19.',
    repName: 'Michelle P.',
    referenceNumber: 'MAN-2025-729443',
  },
  {
    outcomeDetail: 'Claim confirmed received and processed. Payment $1,640 EFT June 17. Rep confirmed no pending issues.',
    repName: 'James L.',
    referenceNumber: 'CL-2025-049183',
  },
  {
    outcomeDetail: 'Sun Life rep confirmed adjudication complete. $3,200 approved for implant procedure. Payment by June 25.',
    repName: 'Patricia W.',
    referenceNumber: 'SL-2025-924810',
  },
  {
    outcomeDetail: 'TELUS AdjudiCare: Claim verified with Great-West Life. $1,120 paid. EFT sent May 31.',
    repName: 'Kevin A.',
    referenceNumber: 'TEL-GWL-2025-0034',
  },
  {
    outcomeDetail: 'RBC Insurance confirmed claim processed. $760 approved. Payment mailed June 2.',
    repName: 'Donna S.',
    referenceNumber: 'RBC-2025-310192',
  },
  {
    outcomeDetail: 'Green Shield rep: claim 100% approved. $2,480 EFT deposited June 5. Confirmed no balance.',
    repName: 'Aaron B.',
    referenceNumber: 'GS-2025-503771',
  },
  {
    outcomeDetail: 'Canada Life confirmed claim approved. Bridge procedure covered at 60%. $1,380 payment processing.',
    repName: 'Lisa F.',
    referenceNumber: 'CL-2025-071290',
  },
  {
    outcomeDetail: 'Spoke with Manulife. Claim approved — ortho coverage confirmed. $2,200 paid. No appeal needed.',
    repName: 'Christopher D.',
    referenceNumber: 'MAN-2025-881044',
  },
  {
    outcomeDetail: 'Sun Life rep confirmed payment $1,050 approved. Major restorative benefit applied. EFT June 20.',
    repName: 'Angela N.',
    referenceNumber: 'SL-2025-730012',
  },
  {
    outcomeDetail: 'TELUS rep confirmed claim processed. Underlying insurer Manulife. $890 paid June 8.',
    repName: 'Ryan C.',
    referenceNumber: 'TEL-MAN-2025-0217',
  },
  {
    outcomeDetail: 'Green Shield confirmed adjudication. $1,700 paid. Preventive and basic procedures covered.',
    repName: 'Sandra O.',
    referenceNumber: 'GS-2025-618440',
  },
  {
    outcomeDetail: 'Canada Life: claim received June 1, processed same day. $2,640 EFT deposited.',
    repName: 'Timothy H.',
    referenceNumber: 'CL-2025-082001',
  },
  {
    outcomeDetail: 'RBC: endodontic claim approved in full. $1,920 paid. Rep confirmed no secondary review needed.',
    repName: 'Carolyn M.',
    referenceNumber: 'RBC-2025-419230',
  },
  {
    outcomeDetail: 'Sun Life confirmed claim. $840 for recall exam and x-rays approved. EFT by June 18.',
    repName: 'Brian T.',
    referenceNumber: 'SL-2025-801923',
  },
  {
    outcomeDetail: 'Manulife rep: denture claim approved at 50% major. $1,560 paid June 6.',
    repName: 'Natalie G.',
    referenceNumber: 'MAN-2025-774301',
  },
  {
    outcomeDetail: 'Green Shield confirmed. $3,100 for full-arch implant approved. Payment processing June 22.',
    repName: 'Scott V.',
    referenceNumber: 'GS-2025-710004',
  },
  {
    outcomeDetail: 'Canada Life: post and core + crown approved. $1,280 EFT June 10.',
    repName: 'Heather B.',
    referenceNumber: 'CL-2025-093417',
  },
  {
    outcomeDetail: 'Sun Life confirmed claim resolved. $2,040 approved for periodontal scaling. EFT June 23.',
    repName: 'Mark L.',
    referenceNumber: 'SL-2025-912044',
  },
];

const ESCALATED_OUTCOMES: Array<{ outcomeDetail: string }> = [
  { outcomeDetail: 'Claim requires additional x-ray documentation. Rep requested submission within 14 days. Awaiting practice action.' },
  { outcomeDetail: 'Plan maximum reached for current benefit year. Manual review recommended — may qualify for next cycle.' },
  { outcomeDetail: 'Missing NPI number on submission. Resubmission with corrected form required.' },
  { outcomeDetail: 'Claim in secondary review. Supervisor escalation requested. Recall scheduled in 7 days.' },
  { outcomeDetail: 'Procedure code D2750 flagged — rep requested clinical notes. Attach and resubmit.' },
  { outcomeDetail: 'Conflicting patient DOB on file. Practice must confirm with carrier directly.' },
];

const DENIED_OUTCOMES: Array<{ outcomeDetail: string }> = [
  { outcomeDetail: 'Claim denied — procedure D2740 not covered under current plan. Non-covered benefit.' },
  { outcomeDetail: 'Claim denied — waiting period not met. Patient enrolled 8 months ago; 12-month wait applies for major restorative.' },
  { outcomeDetail: 'Claim denied — frequency limitation exceeded. Two crowns claimed within 5-year period.' },
  { outcomeDetail: 'Claim denied — pre-authorization not obtained. Procedure required prior approval.' },
];

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding demo practice with insurance AR data...\n');

  const PASSWORD = process.env.SEED_PRACTICE_PASSWORD || 'CollectRx2026!';
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const practiceName = process.env.SEED_PRACTICE_NAME || DEMO_PRACTICE_NAME;
  const practiceEmail = process.env.SEED_PRACTICE_EMAIL || DEMO_EMAIL;
  const practiceDisplayName = process.env.SEED_PRACTICE_DISPLAY_NAME || DEMO_OWNER_NAME;

  // ── 1. Practice ──────────────────────────────────────────────────────────
  const reset = process.argv.includes('--reset');
  const existing = await prisma.practice.findMany({
    where: { name: { in: [practiceName, DEMO_PRACTICE_NAME, ...LEGACY_DEMO_PRACTICE_NAMES] } },
  });
  if (existing.length > 0 && !reset) {
    console.log('⚠️  Demo practice already exists. Re-run with:\n   npm run demo:seed -- --reset\n');
    return;
  }
  for (const p of existing) {
    await deleteDemoPractice(p.id);
    console.log(`🗑️  Removed existing demo practice: ${p.name} (${p.id})`);
  }

  const practice = await prisma.practice.create({
    data: {
      name: practiceName,
      timezone: 'America/Toronto',
      passwordHash,
    },
  });
  console.log(`✅ Practice: ${practice.name}  (id: ${practice.id})`);

  // ── 2. User (practice owner) ──────────────────────────────────────────────
  await prisma.user.create({
    data: {
      practiceId: practice.id,
      email: practiceEmail,
      passwordHash,
      role: 'practice_owner',
      displayName: practiceDisplayName,
      isActive: true,
    },
  });
  console.log(`✅ User: ${practiceEmail} / ${PASSWORD}`);

  // ── 3. Resolved claims (22) — drive "dollars recovered" KPI ───────────────
  const carriers: Array<'sun_life' | 'canada_life' | 'manulife' | 'green_shield' | 'rbc' | 'telus_adjudicare'> =
    ['sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare'];

  const resolvedAmounts = [
    1840, 1120, 980, 2120, 3200, 1640, 1380, 760, 2480, 1050,
    2200, 890, 1700, 2640, 1920, 840, 1560, 3100, 1280, 2040, 890, 1480,
  ];

  const resolvedClaims = [];
  for (let i = 0; i < RESOLVED_OUTCOMES.length; i++) {
    const outcome = RESOLVED_OUTCOMES[i];
    const amount = resolvedAmounts[i] ?? 1200;
    const billedDaysAgo = 35 + i * 2; // 35–77 days ago
    const carrier = carriers[i % carriers.length];

    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: carrier,
        claimNumber: claimNum('RES', 1000 + i),
        patientToken: randomUUID(),
        billedAmount: amount,
        outstandingAmount: 0, // fully recovered
        daysOutstanding: billedDaysAgo,
        status: 'RESOLVED',
        priority: 'NORMAL',
        servicedAt: daysAgo(billedDaysAgo + 7),
        createdAt: daysAgo(billedDaysAgo),
        updatedAt: daysAgo(3 + i),
      },
    });

    // CallAttempt
    const callAt = daysAgo(10 + i);
    const callCompleted = new Date(callAt.getTime() + 9 * 60 * 1000); // 9 min call
    const attempt = await prisma.callAttempt.create({
      data: {
        claimId: claim.id,
        vapiCallId: randomUUID(),
        initiatedAt: callAt,
        completedAt: callCompleted,
        durationSeconds: 480 + Math.floor(Math.random() * 300),
        outcome: 'RESOLVED',
        outcomeDetail: outcome.outcomeDetail,
        repName: outcome.repName,
        referenceNumber: outcome.referenceNumber,
      },
    });

    // Recovery event (drives dollarsRecoveredSyncVerified)
    await prisma.claimRecoveryEvent.create({
      data: {
        practiceId: practice.id,
        claimId: claim.id,
        eventType: 'PAYMENT_VERIFIED_SYNC',
        amountRecoveredCents: amount * 100,
        previousOutstanding: amount,
        newOutstanding: 0,
        createdAt: new Date(attempt.completedAt!.getTime() + 2 * 24 * 60 * 60 * 1000),
      },
    });

    resolvedClaims.push(claim);
  }

  // Appeal wins — prior DENIED attempt, later RESOLVED (drives reconsiderationSuccessRate KPI)
  const appealWinStories = [
    {
      carrier: 'manulife' as const,
      claimNumber: claimNum('APL', 100),
      amount: 1420,
      deniedDetail: DENIED_OUTCOMES[3].outcomeDetail,
      resolved: RESOLVED_OUTCOMES[4],
    },
    {
      carrier: 'sun_life' as const,
      claimNumber: claimNum('APL', 101),
      amount: 980,
      deniedDetail: DENIED_OUTCOMES[0].outcomeDetail,
      resolved: RESOLVED_OUTCOMES[0],
    },
    {
      carrier: 'canada_life' as const,
      claimNumber: claimNum('APL', 102),
      amount: 1760,
      deniedDetail: DENIED_OUTCOMES[1].outcomeDetail,
      resolved: RESOLVED_OUTCOMES[2],
    },
  ];

  for (const story of appealWinStories) {
    const billedDaysAgo = 55;
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: story.carrier,
        claimNumber: story.claimNumber,
        patientToken: randomUUID(),
        billedAmount: story.amount,
        outstandingAmount: 0,
        daysOutstanding: billedDaysAgo,
        status: 'RESOLVED',
        priority: 'HIGH',
        servicedAt: daysAgo(billedDaysAgo + 7),
        createdAt: daysAgo(billedDaysAgo),
        updatedAt: daysAgo(5),
      },
    });

    const deniedAt = daysAgo(28);
    await prisma.callAttempt.create({
      data: {
        claimId: claim.id,
        vapiCallId: `demo-denied-${story.claimNumber.toLowerCase()}`,
        initiatedAt: deniedAt,
        completedAt: new Date(deniedAt.getTime() + 8 * 60 * 1000),
        durationSeconds: 480,
        outcome: 'DENIED',
        outcomeDetail: story.deniedDetail,
      },
    });

    const resolvedAt = daysAgo(12);
    const resolvedAttempt = await prisma.callAttempt.create({
      data: {
        claimId: claim.id,
        vapiCallId: `demo-resolved-${story.claimNumber.toLowerCase()}`,
        initiatedAt: resolvedAt,
        completedAt: new Date(resolvedAt.getTime() + 9 * 60 * 1000),
        durationSeconds: 540,
        outcome: 'RESOLVED',
        outcomeDetail: story.resolved.outcomeDetail,
        repName: story.resolved.repName,
        referenceNumber: story.resolved.referenceNumber,
      },
    });

    await prisma.claimRecoveryEvent.create({
      data: {
        practiceId: practice.id,
        claimId: claim.id,
        eventType: 'PAYMENT_VERIFIED_SYNC',
        amountRecoveredCents: story.amount * 100,
        previousOutstanding: story.amount,
        newOutstanding: 0,
        createdAt: new Date(resolvedAttempt.completedAt!.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    resolvedClaims.push(claim);
  }

  const totalRecovered =
    resolvedAmounts.reduce((a, b) => a + b, 0) +
    appealWinStories.reduce((a, s) => a + s.amount, 0);
  console.log(`✅ Resolved claims: ${resolvedClaims.length}  ($${totalRecovered.toLocaleString()} recovered, incl. 3 appeal wins)`);

  // ── 4. Call-to-resolution story claims (4) — teach the recovery loop ───────
  const storyClaims: Array<{
    label: string;
    workQueueHint: string;
    claimNumber: string;
    carrier: 'sun_life' | 'canada_life' | 'manulife' | 'green_shield';
    amount: number;
    days: number;
    status: 'CALLING' | 'ON_HOLD' | 'IN_QUEUE';
    priority: 'NORMAL' | 'HIGH';
    recoveryRoute: 'CALL_CARRIER' | 'PRACTICE_GATE';
  }> = [
    {
      label: 'Live call in progress',
      workQueueHint: 'Live console — agent on carrier line',
      claimNumber: 'SL-2025-002341',
      carrier: 'sun_life',
      amount: 2340,
      days: 47,
      status: 'CALLING',
      priority: 'NORMAL',
      recoveryRoute: 'CALL_CARRIER',
    },
    {
      label: 'Practice gate — attach perio chart',
      workQueueHint: 'Owner action required before re-call',
      claimNumber: 'CL-2025-007712',
      carrier: 'canada_life',
      amount: 1580,
      days: 53,
      status: 'ON_HOLD',
      priority: 'NORMAL',
      recoveryRoute: 'PRACTICE_GATE',
    },
    {
      label: 'Recall due now',
      workQueueHint: '72h processing recall — ready to dial',
      claimNumber: 'GS-2025-009984',
      carrier: 'green_shield',
      amount: 890,
      days: 38,
      status: 'IN_QUEUE',
      priority: 'NORMAL',
      recoveryRoute: 'CALL_CARRIER',
    },
    {
      label: 'High-value aging ($3k+ / 60+d)',
      workQueueHint: 'Top work-queue priority — Manulife crown',
      claimNumber: 'MAN-2025-004401',
      carrier: 'manulife',
      amount: 3180,
      days: 67,
      status: 'IN_QUEUE',
      priority: 'HIGH',
      recoveryRoute: 'CALL_CARRIER',
    },
  ];

  for (const s of storyClaims) {
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: s.carrier,
        claimNumber: s.claimNumber,
        patientToken: randomUUID(),
        billedAmount: s.amount,
        outstandingAmount: s.amount,
        daysOutstanding: s.days,
        status: s.status,
        priority: s.priority,
        recoveryRoute: s.recoveryRoute,
        treatmentCodes: s.claimNumber.startsWith('CL-') ? 'D4341,D0274' : 'D2750',
        servicedAt: daysAgo(s.days + 7),
        createdAt: daysAgo(s.days),
      },
    });
    

    if (s.status === 'CALLING') {
      await prisma.callAttempt.create({
        data: {
          claimId: claim.id,
          vapiCallId: 'demo-in-progress-sl-002341',
          initiatedAt: hoursAgo(0.12),
          activeAgent: 'Claims_Agent',
          repName: 'Marcus L.',
          referenceNumber: 'SL-2025-002341',
          liveState: JSON.stringify({
            step: 'speaking_with_rep',
            repQueue: 'claims_adjudication',
            claimRef: s.claimNumber,
            transcriptSnippet:
              'Rep confirms claim received 47 days ago — checking adjudication status with dental benefits team.',
          }),
        },
      });

      await prisma.callQueue.create({
        data: {
          claimId: claim.id,
          practiceId: practice.id,
          status: 'IN_PROGRESS',
          attempts: 1,
          scheduledFor: hoursAgo(1),
          lastAttemptAt: hoursAgo(0.12),
        },
      });
    }

    if (s.recoveryRoute === 'PRACTICE_GATE') {
      const gateCallAt = daysAgo(4);
      const gateAttempt = await prisma.callAttempt.create({
        data: {
          claimId: claim.id,
          vapiCallId: 'demo-gate-cl-007712',
          initiatedAt: gateCallAt,
          completedAt: new Date(gateCallAt.getTime() + 9 * 60 * 1000),
          durationSeconds: 540,
          outcome: 'ESCALATED',
          outcomeDetail:
            'Rep requested periodontal charting before D4341 scaling can be adjudicated. Attach perio chart and resubmit.',
        },
      });

      await prisma.claimRecoveryAction.create({
        data: {
          practiceId: practice.id,
          claimId: claim.id,
          actionType: 'PRACTICE_DOCS',
          status: 'BLOCKING',
          route: 'PRACTICE_GATE',
          title: 'Attach perio chart',
          detail:
            'Canada Life rep flagged missing perio chart for D4341. Upload chart in PMS and mark gate cleared.',
          callAttemptId: gateAttempt.id,
        },
      });

      await prisma.callQueue.create({
        data: {
          claimId: claim.id,
          practiceId: practice.id,
          status: 'ESCALATED',
          attempts: 1,
          scheduledFor: daysFromNow(7),
          lastAttemptAt: gateCallAt,
        },
      });
    }

    if (s.claimNumber === 'GS-2025-009984') {
      const recallCallAt = daysAgo(3);
      const recallAttempt = await prisma.callAttempt.create({
        data: {
          claimId: claim.id,
          vapiCallId: 'demo-recall-gs-009984',
          initiatedAt: recallCallAt,
          completedAt: new Date(recallCallAt.getTime() + 7 * 60 * 1000),
          durationSeconds: 420,
          outcome: 'PENDING',
          outcomeDetail:
            'Claim still in processing. Rep quoted 72-hour turnaround. Recall scheduled.',
          repName: 'Aaron B.',
          referenceNumber: 'GS-2025-009984-PND',
        },
      });

      await prisma.claimRecoveryAction.create({
        data: {
          practiceId: practice.id,
          claimId: claim.id,
          actionType: 'PROCESSING_RECALL',
          status: 'OPEN',
          route: 'CALL_CARRIER',
          title: 'Processing recall — 72h',
          detail: 'Carrier still adjudicating. Re-call if no payment by recall date.',
          scheduledRecallAt: hoursAgo(2),
          callAttemptId: recallAttempt.id,
        },
      });

      await prisma.callQueue.create({
        data: {
          claimId: claim.id,
          practiceId: practice.id,
          status: 'PENDING',
          attempts: 1,
          scheduledFor: hoursAgo(2),
          lastAttemptAt: recallCallAt,
        },
      });
    }

    if (s.claimNumber === 'MAN-2025-004401') {
      const firstCallAt = daysAgo(14);
      const firstAttempt = await prisma.callAttempt.create({
        data: {
          claimId: claim.id,
          vapiCallId: 'demo-first-man-004401',
          initiatedAt: firstCallAt,
          completedAt: new Date(firstCallAt.getTime() + 11 * 60 * 1000),
          durationSeconds: 660,
          outcome: 'PENDING',
          outcomeDetail:
            'Crown D2750 still in adjudication. Rep quoted 10–14 business days. High-value claim flagged for priority follow-up.',
          repName: 'Tanya K.',
          referenceNumber: 'MAN-2025-004401-PND',
        },
      });

      await prisma.claimRecoveryEvent.create({
        data: {
          practiceId: practice.id,
          claimId: claim.id,
          eventType: 'ROUTE_ASSIGNED',
          metadata: { route: 'CALL_CARRIER' },
          createdAt: firstCallAt,
        },
      });

      await prisma.claimRecoveryAction.create({
        data: {
          practiceId: practice.id,
          claimId: claim.id,
          actionType: 'PROCESSING_RECALL',
          status: 'OPEN',
          route: 'CALL_CARRIER',
          title: 'Priority recall — high value aging',
          detail: 'Manulife crown $3,180 at 67 days. Second call queued after processing window.',
          scheduledRecallAt: hoursAgo(0.5),
          callAttemptId: firstAttempt.id,
        },
      });

      await prisma.callQueue.create({
        data: {
          claimId: claim.id,
          practiceId: practice.id,
          status: 'PENDING',
          attempts: 1,
          scheduledFor: hoursAgo(0.5),
          lastAttemptAt: firstCallAt,
        },
      });
    }
  }

  console.log(`✅ Story claims: ${storyClaims.length}  (call-to-resolution loop)`);

  // ── 5. IN_QUEUE claims (12) — waiting to be called ─────────────────────────
  const queuedData = [
    { carrier: 'sun_life' as const,        amount: 1920, days: 34 },
    { carrier: 'canada_life' as const,     amount: 2780, days: 41 },
    { carrier: 'manulife' as const,        amount: 1100, days: 37 },
    { carrier: 'green_shield' as const,    amount: 3400, days: 48 },
    { carrier: 'rbc' as const,             amount: 860,  days: 33 },
    { carrier: 'telus_adjudicare' as const, amount: 1740, days: 45 },
    { carrier: 'sun_life' as const,        amount: 2200, days: 52 },
    { carrier: 'canada_life' as const,     amount: 980,  days: 40 },
    { carrier: 'manulife' as const,        amount: 1650, days: 36 },
    { carrier: 'green_shield' as const,    amount: 2400, days: 44 },
    { carrier: 'sun_life' as const,        amount: 1380, days: 31 },
    { carrier: 'rbc' as const,             amount: 3100, days: 58 },
  ];

  for (let i = 0; i < queuedData.length; i++) {
    const d = queuedData[i];
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: d.carrier,
        claimNumber: claimNum('Q', 2000 + i),
        patientToken: randomUUID(),
        billedAmount: d.amount,
        outstandingAmount: d.amount,
        daysOutstanding: d.days,
        status: 'IN_QUEUE',
        priority: d.days > 50 ? 'HIGH' : 'NORMAL',
        servicedAt: daysAgo(d.days + 7),
        createdAt: daysAgo(d.days),
      },
    });

    await prisma.callQueue.create({
      data: {
        claimId: claim.id,
        practiceId: practice.id,
        status: 'PENDING',
        attempts: 0,
        scheduledFor: new Date(Date.now() + (i + 1) * 30 * 60 * 1000), // staggered today
      },
    });
  }
  const queuedTotal = queuedData.reduce((a, b) => a + b.amount, 0);
  console.log(`✅ Queued claims: ${queuedData.length}  ($${queuedTotal.toLocaleString()} outstanding)`);

  // ── 6. ESCALATED claims (6) ────────────────────────────────────────────────
  const escalatedData = [
    { carrier: 'sun_life' as const,     amount: 2100, days: 62 },
    { carrier: 'canada_life' as const,  amount: 1840, days: 71 },
    { carrier: 'manulife' as const,     amount: 960,  days: 55 },
    { carrier: 'green_shield' as const, amount: 3300, days: 78 },
    { carrier: 'rbc' as const,          amount: 1200, days: 65 },
    { carrier: 'sun_life' as const,     amount: 2700, days: 84 },
  ];

  for (let i = 0; i < escalatedData.length; i++) {
    const d = escalatedData[i];
    const callAt = daysAgo(d.days - 5);
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: d.carrier,
        claimNumber: claimNum('ESC', 3000 + i),
        patientToken: randomUUID(),
        billedAmount: d.amount,
        outstandingAmount: d.amount,
        daysOutstanding: d.days,
        status: 'ESCALATED',
        priority: 'HIGH',
        servicedAt: daysAgo(d.days + 7),
        createdAt: daysAgo(d.days),
      },
    });

    await prisma.callAttempt.create({
      data: {
        claimId: claim.id,
        vapiCallId: randomUUID(),
        initiatedAt: callAt,
        completedAt: new Date(callAt.getTime() + 11 * 60 * 1000),
        durationSeconds: 660,
        outcome: 'ESCALATED',
        outcomeDetail: ESCALATED_OUTCOMES[i % ESCALATED_OUTCOMES.length].outcomeDetail,
      },
    });
  }
  const escalatedTotal = escalatedData.reduce((a, b) => a + b.amount, 0);
  console.log(`✅ Escalated claims: ${escalatedData.length}  ($${escalatedTotal.toLocaleString()} outstanding)`);

  // ── 7. DENIED claims (4) ──────────────────────────────────────────────────
  const deniedData = [
    { carrier: 'sun_life' as const,    amount: 1600, days: 58 },
    { carrier: 'manulife' as const,    amount: 2400, days: 66 },
    { carrier: 'canada_life' as const, amount: 890,  days: 72 },
    { carrier: 'green_shield' as const, amount: 1100, days: 60 },
  ];

  for (let i = 0; i < deniedData.length; i++) {
    const d = deniedData[i];
    const callAt = daysAgo(d.days - 6);
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: d.carrier,
        claimNumber: claimNum('DEN', 4000 + i),
        patientToken: randomUUID(),
        billedAmount: d.amount,
        outstandingAmount: d.amount,
        daysOutstanding: d.days,
        status: 'DENIED',
        priority: 'HIGH',
        servicedAt: daysAgo(d.days + 7),
        createdAt: daysAgo(d.days),
      },
    });

    await prisma.callAttempt.create({
      data: {
        claimId: claim.id,
        vapiCallId: `demo-denied-den-${4000 + i}`,
        initiatedAt: callAt,
        completedAt: new Date(callAt.getTime() + 8 * 60 * 1000),
        durationSeconds: 480,
        outcome: 'DENIED',
        outcomeDetail: DENIED_OUTCOMES[i % DENIED_OUTCOMES.length].outcomeDetail,
      },
    });
  }
  console.log(`✅ Denied claims: ${deniedData.length}`);

  // ── 8. PENDING claims (6) — too new to call yet (<30 days) ────────────────
  const pendingData = [
    { carrier: 'sun_life' as const,        amount: 2800, days: 12 },
    { carrier: 'canada_life' as const,     amount: 1440, days: 8  },
    { carrier: 'manulife' as const,        amount: 3600, days: 22 },
    { carrier: 'green_shield' as const,    amount: 920,  days: 15 },
    { carrier: 'rbc' as const,             amount: 1760, days: 5  },
    { carrier: 'telus_adjudicare' as const, amount: 2100, days: 19 },
  ];

  for (let i = 0; i < pendingData.length; i++) {
    const d = pendingData[i];
    await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: d.carrier,
        claimNumber: claimNum('NEW', 5000 + i),
        patientToken: randomUUID(),
        billedAmount: d.amount,
        outstandingAmount: d.amount,
        daysOutstanding: d.days,
        status: 'PENDING',
        priority: 'NORMAL',
        servicedAt: daysAgo(d.days + 7),
        createdAt: daysAgo(d.days),
      },
    });
  }
  console.log(`✅ Pending claims: ${pendingData.length}  (not eligible yet — <30 days)`);

  // ── 9. ON_HOLD claims (4) — awaiting docs ─────────────────────────────────
  const holdData = [
    { carrier: 'sun_life' as const,     amount: 1850, days: 49 },
    { carrier: 'canada_life' as const,  amount: 2340, days: 57 },
    { carrier: 'manulife' as const,     amount: 1100, days: 43 },
    { carrier: 'green_shield' as const, amount: 2900, days: 68 },
  ];

  for (let i = 0; i < holdData.length; i++) {
    const d = holdData[i];
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: d.carrier,
        claimNumber: claimNum('HOLD', 6000 + i),
        patientToken: randomUUID(),
        billedAmount: d.amount,
        outstandingAmount: d.amount,
        daysOutstanding: d.days,
        status: 'ON_HOLD',
        priority: 'NORMAL',
        servicedAt: daysAgo(d.days + 7),
        createdAt: daysAgo(d.days),
      },
    });

    await prisma.claimRecoveryAction.create({
      data: {
        practiceId: practice.id,
        claimId: claim.id,
        actionType: 'PRACTICE_DOCS',
        status: 'BLOCKING',
        route: 'PRACTICE_GATE',
        title: 'Submit supporting documentation',
        detail: 'Carrier requested clinical notes and x-rays before adjudication can continue.',
      },
    });
  }
  console.log(`✅ On-hold claims: ${holdData.length}  (awaiting documentation)`);

  // ── 10. Pre-visit platform — CDCP deadlines + appointment verifications ─────
  const cdcpPatientTokens = Array.from({ length: 8 }, () => randomUUID());

  const cdcpPredetCases = [
    {
      claimRef: 'PD-DEMO-001',
      patientToken: cdcpPatientTokens[0],
      procedureCode: 'D2750',
      daysRemaining: 3,
      summary: 'Denied — missing periapical radiograph (F-010). Crown predet.',
    },
    {
      claimRef: 'PD-DEMO-002',
      patientToken: cdcpPatientTokens[1],
      procedureCode: 'D2740',
      daysRemaining: 7,
      summary: 'Denied — insufficient clinical narrative for crown (F-010).',
    },
    {
      claimRef: 'PD-DEMO-003',
      patientToken: cdcpPatientTokens[2],
      procedureCode: 'D5110',
      daysRemaining: 14,
      summary: 'Denied — complete denture predet; treatment plan not on file (F-010).',
    },
    {
      claimRef: 'PD-DEMO-004',
      patientToken: cdcpPatientTokens[3],
      procedureCode: 'D4341',
      daysRemaining: 45,
      summary: 'Denied — periodontal charting required for scaling (F-010).',
    },
    {
      claimRef: 'PD-DEMO-005',
      patientToken: cdcpPatientTokens[4],
      procedureCode: 'D6010',
      daysRemaining: 2,
      summary: 'Denied — implant surgical predet; reconsideration window critical.',
    },
  ] as const;

  for (const c of cdcpPredetCases) {
    await prisma.cdcpReconsiderationCase.create({
      data: {
        practiceId: practice.id,
        patientToken: c.patientToken,
        claimRef: c.claimRef,
        carrierCode: 'cdcp_sunlife',
        procedureCode: c.procedureCode,
        denialDate: denialDateForDaysRemaining(c.daysRemaining),
        status: 'open',
        clinicalEvidenceSummary: c.summary,
      },
    });
  }
  console.log(`✅ CDCP predet cases: ${cdcpPredetCases.length}  (deadlines at 2–45 days)`);

  const preVisitVerifications = [
    {
      patientToken: cdcpPatientTokens[5],
      procedureCodes: ['D0120'],
      appointmentAt: daysFromNow(2),
      status: 'GREEN',
      reason: 'cdcp_predet_approved',
      cdcpDaysRemaining: null as number | null,
      missingArtifacts: [] as string[],
    },
    {
      patientToken: cdcpPatientTokens[0],
      procedureCodes: ['D2750'],
      appointmentAt: hoursFromNow(36),
      status: 'YELLOW',
      reason: 'cdcp_predet_pending',
      cdcpDaysRemaining: 3,
      missingArtifacts: ['periapical_xray'],
    },
    {
      patientToken: cdcpPatientTokens[1],
      procedureCodes: ['D2740'],
      appointmentAt: hoursFromNow(20),
      status: 'RED',
      reason: 'cdcp_predet_denied',
      cdcpDaysRemaining: 7,
      missingArtifacts: ['clinical_narrative', 'periapical_xray'],
    },
    {
      patientToken: cdcpPatientTokens[4],
      procedureCodes: ['D6010'],
      appointmentAt: daysFromNow(1),
      status: 'RED',
      reason: 'cdcp_reconsideration_expiring',
      cdcpDaysRemaining: 2,
      missingArtifacts: ['bitewing_xray'],
    },
  ] as const;

  for (const v of preVisitVerifications) {
    const verification = await prisma.appointmentVerification.create({
      data: {
        practiceId: practice.id,
        patientToken: v.patientToken,
        carrierId: 'sun_life',
        procedureCodes: [...v.procedureCodes],
        appointmentAt: v.appointmentAt,
        status: v.status,
        reason: v.reason,
        cdcpDaysRemaining: v.cdcpDaysRemaining,
        missingArtifacts: [...v.missingArtifacts],
        attemptCount: v.status === 'GREEN' ? 1 : 2,
        portalResolved: v.status === 'GREEN',
      },
    });

    await prisma.scheduledAppointment.create({
      data: {
        practiceId: practice.id,
        patientToken: v.patientToken,
        carrierId: 'sun_life',
        procedureCodes: [...v.procedureCodes],
        appointmentAt: v.appointmentAt,
        pmsSource: 'demo_seed',
        pmsAppointmentId: `demo-${verification.id.slice(0, 8)}`,
        verificationId: verification.id,
      },
    });

    await prisma.adjudicationEvent.create({
      data: {
        practiceId: practice.id,
        patientToken: v.patientToken,
        carrierId: 'sun_life',
        procedureCodes: [...v.procedureCodes],
        callType: 'pre_visit_cdcp',
        outcome: v.status === 'RED' ? 'failed' : 'success',
        predeterminationStatus:
          v.status === 'GREEN' ? 'approved' : v.status === 'YELLOW' ? 'pending' : 'denied',
        eligibilityStatus: 'eligible',
        supportingDocsPresent: v.missingArtifacts.length === 0,
        appointmentVerificationId: verification.id,
      },
    });
  }
  console.log(`✅ Pre-visit verifications: ${preVisitVerifications.length}  (GREEN/YELLOW/RED)`);

  // ── work-queue sync (rank scores for /work-queue) ───────────────────────────
  const { upserted: workItemsSynced } = await syncWorkItemsForPractice(prisma, practice.id);
  console.log(`✅ Work items synced: ${workItemsSynced}`);

  // ── summary ─────────────────────────────────────────────────────────────────
  const openAmounts = [
    ...storyClaims.map((s) => s.amount),
    ...queuedData.map((d) => d.amount),
    ...escalatedData.map((d) => d.amount),
    ...deniedData.map((d) => d.amount),
    ...pendingData.map((d) => d.amount),
    ...holdData.map((d) => d.amount),
  ];
  const totalOpen = openAmounts.reduce((a, b) => a + b, 0);
  const totalClaims =
    resolvedClaims.length +
    storyClaims.length +
    queuedData.length +
    escalatedData.length +
    deniedData.length +
    pendingData.length +
    holdData.length;

  const manulifeStory = storyClaims.find((s) => s.claimNumber === 'MAN-2025-004401')!;
  const manulifeRank = computeWorkQueueRankScore(manulifeStory.amount, manulifeStory.days, 0.8);

  console.log('\n' + '─'.repeat(60));
  console.log('🎯  Demo data summary');
  console.log('─'.repeat(60));
  console.log(`   Practice:      ${practiceName} (id: ${practice.id})`);
  console.log(`   Login:         ${practiceEmail}`);
  console.log(`   Password:      ${PASSWORD}`);
  console.log(`   Total claims:  ${totalClaims}`);
  console.log(`   Open AR:       $${totalOpen.toLocaleString()} CAD`);
  console.log(`   Recovered:     $${totalRecovered.toLocaleString()} CAD (${resolvedClaims.length} claims)`);
  console.log(`   Recovery rate: ~${Math.round((totalRecovered / (totalRecovered + totalOpen)) * 100)}%`);
  console.log(`   CDCP deadlines: ${cdcpPredetCases.length} open cases (/pre-visit)`);
  console.log(`   Pre-visit signals: ${preVisitVerifications.length} appointments`);
  console.log(`   Work items:    ${workItemsSynced} open (MAN-2025-004401 rank ≈ ${manulifeRank.toFixed(2)})`);
  console.log('─'.repeat(60));
  console.log('\n📋  Call-to-resolution story claims (work queue / live console):');
  console.log('   Claim ref            Status      Route           Demo narrative');
  for (const s of storyClaims) {
    const rank = computeWorkQueueRankScore(s.amount, s.days, 0.75);
    console.log(
      `   ${s.claimNumber.padEnd(20)} ${s.status.padEnd(11)} ${s.recoveryRoute.padEnd(15)} ${s.label} (rank ${rank.toFixed(2)})`,
    );
  }
  console.log('─'.repeat(60));
  console.log('\n✨  Seed complete. Log in as ' + DEMO_EMAIL + ' → /work-queue or /pre-visit\n');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
