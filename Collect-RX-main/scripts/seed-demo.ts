/**
 * Demo seed — creates "Hasan Family Dental" with realistic AR data for the Dr. Hasan pilot demo.
 *
 * Usage:
 *   DATABASE_URL=<railway_url> npx ts-node --esm scripts/seed-demo.ts
 *   or add to package.json: "demo:seed": "ts-node --esm scripts/seed-demo.ts"
 *
 * Sets login: demo@hasanfamilydental.ca / CollectRx2026!
 * Delete the practice afterwards: DELETE FROM practices WHERE name = 'Hasan Family Dental';
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

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
  console.log('🌱 Seeding demo practice...\n');

  const PASSWORD = 'CollectRx2026!';
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // ── 1. Practice ──────────────────────────────────────────────────────────
  const existing = await prisma.practice.findFirst({ where: { name: 'Hasan Family Dental' } });
  if (existing) {
    console.log('⚠️  Demo practice already exists. Delete it first:\n   DELETE FROM practices WHERE name = \'Hasan Family Dental\';\n');
    return;
  }

  const practice = await prisma.practice.create({
    data: {
      name: 'Hasan Family Dental',
      timezone: 'America/Toronto',
      passwordHash,
    },
  });
  console.log(`✅ Practice: ${practice.name}  (id: ${practice.id})`);

  // ── 2. User (practice owner) ──────────────────────────────────────────────
  await prisma.user.create({
    data: {
      practiceId: practice.id,
      email: 'demo@hasanfamilydental.ca',
      passwordHash,
      role: 'practice_owner',
      displayName: 'Dr. Hasan',
      isActive: true,
    },
  });
  console.log(`✅ User: demo@hasanfamilydental.ca / ${PASSWORD}`);

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
  const totalRecovered = resolvedAmounts.reduce((a, b) => a + b, 0);
  console.log(`✅ Resolved claims: ${resolvedClaims.length}  ($${totalRecovered.toLocaleString()} recovered)`);

  // ── 4. CALLING claims (4) — show system working right now ─────────────────
  const callingData = [
    { carrier: 'sun_life' as const,      amount: 2340, days: 47, claimSuffix: 'SL-2025-002341' },
    { carrier: 'canada_life' as const,   amount: 1580, days: 53, claimSuffix: 'CL-2025-007712' },
    { carrier: 'manulife' as const,      amount: 3180, days: 61, claimSuffix: 'MAN-2025-004401' },
    { carrier: 'green_shield' as const,  amount: 890,  days: 38, claimSuffix: 'GS-2025-009984' },
  ];

  for (const d of callingData) {
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id,
        carrierId: d.carrier,
        claimNumber: d.claimSuffix,
        patientToken: randomUUID(),
        billedAmount: d.amount,
        outstandingAmount: d.amount,
        daysOutstanding: d.days,
        status: 'CALLING',
        priority: d.days > 55 ? 'HIGH' : 'NORMAL',
        servicedAt: daysAgo(d.days + 7),
        createdAt: daysAgo(d.days),
      },
    });

    // Active call started a few minutes ago
    await prisma.callAttempt.create({
      data: {
        claimId: claim.id,
        vapiCallId: randomUUID(),
        initiatedAt: hoursAgo(0.15 + Math.random() * 0.3),
        activeAgent: 'IVR_Navigator',
        liveState: JSON.stringify({ step: 'navigating_ivr', menuDepth: 2 }),
      },
    });

    await prisma.callQueue.create({
      data: {
        claimId: claim.id,
        practiceId: practice.id,
        status: 'IN_PROGRESS',
        attempts: 1,
        scheduledFor: hoursAgo(1),
        lastAttemptAt: hoursAgo(0.2),
      },
    });
  }
  console.log(`✅ Calling claims: ${callingData.length}  (active right now)`);

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
        vapiCallId: randomUUID(),
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

  // ── summary ─────────────────────────────────────────────────────────────────
  const openAmounts = [
    ...callingData.map(d => d.amount),
    ...queuedData.map(d => d.amount),
    ...escalatedData.map(d => d.amount),
    ...deniedData.map(d => d.amount),
    ...pendingData.map(d => d.amount),
    ...holdData.map(d => d.amount),
  ];
  const totalOpen = openAmounts.reduce((a, b) => a + b, 0);
  const totalClaims = resolvedClaims.length + callingData.length + queuedData.length +
    escalatedData.length + deniedData.length + pendingData.length + holdData.length;

  console.log('\n' + '─'.repeat(60));
  console.log('🎯  Demo data summary');
  console.log('─'.repeat(60));
  console.log(`   Practice:      Hasan Family Dental (id: ${practice.id})`);
  console.log(`   Login:         demo@hasanfamilydental.ca`);
  console.log(`   Password:      CollectRx2026!`);
  console.log(`   Total claims:  ${totalClaims}`);
  console.log(`   Open AR:       $${totalOpen.toLocaleString()} CAD`);
  console.log(`   Recovered:     $${totalRecovered.toLocaleString()} CAD (22 claims, last 30 days)`);
  console.log(`   Recovery rate: ~${Math.round(totalRecovered / (totalRecovered + totalOpen) * 100)}%`);
  console.log('─'.repeat(60));
  console.log('\n✨  Seed complete. Log in at your Railway URL.\n');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
