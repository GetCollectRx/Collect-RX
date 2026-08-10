#!/usr/bin/env node

/**
 * Data Quality Audit for CollectRX
 * Checks: orphaned records, missing data, stale entries, referential integrity
 * Run: npm exec -- node scripts/audit-data-quality.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const NOW = new Date();
const THIRTY_DAYS_AGO = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);

const findings = [];

async function auditOrphanedRecords() {
  console.log('Checking for orphaned records...');

  // 1. CallAttempt without InsuranceClaim
  const orphanedCalls = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM call_attempts
    WHERE claim_id NOT IN (SELECT id FROM insurance_claims)
  `;
  if (orphanedCalls[0].count > 0) {
    findings.push({
      category: 'REFERENTIAL_INTEGRITY',
      severity: 'critical',
      message: `Found ${orphanedCalls[0].count} call attempts with non-existent claims`,
      count: Number(orphanedCalls[0].count),
    });
  }

  // 2. CallQueue without InsuranceClaim
  const orphanedQueue = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM call_queue
    WHERE claim_id NOT IN (SELECT id FROM insurance_claims)
  `;
  if (orphanedQueue[0].count > 0) {
    findings.push({
      category: 'REFERENTIAL_INTEGRITY',
      severity: 'critical',
      message: `Found ${orphanedQueue[0].count} queue entries with non-existent claims`,
      count: Number(orphanedQueue[0].count),
    });
  }

  // 3. InsuranceClaim without Practice
  const orphanedClaims = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM insurance_claims
    WHERE practice_id NOT IN (SELECT id FROM "Practice")
  `;
  if (orphanedClaims[0].count > 0) {
    findings.push({
      category: 'REFERENTIAL_INTEGRITY',
      severity: 'critical',
      message: `Found ${orphanedClaims[0].count} insurance claims with non-existent practices`,
      count: Number(orphanedClaims[0].count),
    });
  }

  // 4. EligibilitySnapshot without Practice
  const orphanedSnapshots = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM eligibility_snapshots
    WHERE practice_id NOT IN (SELECT id FROM "Practice")
  `;
  if (orphanedSnapshots[0].count > 0) {
    findings.push({
      category: 'REFERENTIAL_INTEGRITY',
      severity: 'critical',
      message: `Found ${orphanedSnapshots[0].count} eligibility snapshots with non-existent practices`,
      count: Number(orphanedSnapshots[0].count),
    });
  }

  return { orphanedCalls: orphanedCalls[0], orphanedQueue: orphanedQueue[0], orphanedClaims: orphanedClaims[0], orphanedSnapshots: orphanedSnapshots[0] };
}

async function auditMissingRecords() {
  console.log('Checking for missing critical data...');

  // 1. Claims without patientToken (required for Vapi calls)
  const claimsNoToken = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM insurance_claims WHERE patient_token IS NULL
  `;
  if (claimsNoToken[0].count > 0) {
    findings.push({
      category: 'MISSING_DATA',
      severity: 'warning',
      message: `${claimsNoToken[0].count} claims missing patientToken (cannot call)`,
      count: Number(claimsNoToken[0].count),
    });
  }

  // 2. Claims without servicedAt (required for appeal deadlines)
  const claimsNoServiceDate = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM insurance_claims WHERE serviced_at IS NULL AND status != 'DELETED'
  `;
  if (claimsNoServiceDate[0].count > 0) {
    findings.push({
      category: 'MISSING_DATA',
      severity: 'info',
      message: `${claimsNoServiceDate[0].count} active claims missing servicedAt date`,
      count: Number(claimsNoServiceDate[0].count),
    });
  }

  // 3. Practices without billing setup
  const practicesNoBilling = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Practice" WHERE "stripeCustomerId" IS NULL AND "createdAt" < NOW() - INTERVAL '30 days'
  `;
  if (practicesNoBilling[0].count > 0) {
    findings.push({
      category: 'MISSING_DATA',
      severity: 'warning',
      message: `${practicesNoBilling[0].count} active practices (>30 days) without Stripe billing setup`,
      count: Number(practicesNoBilling[0].count),
    });
  }

  // 4. CallAttempt without outcome (stuck calls)
  const nineAgo = new Date(NOW.getTime() - 9 * 24 * 60 * 60 * 1000);
  const stuckCalls = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM call_attempts
    WHERE outcome IS NULL AND initiated_at < ${nineAgo}
  `;
  if (stuckCalls[0].count > 0) {
    findings.push({
      category: 'MISSING_DATA',
      severity: 'warning',
      message: `${stuckCalls[0].count} calls initiated >9 days ago without outcome (check Vapi webhooks)`,
      count: Number(stuckCalls[0].count),
    });
  }

  return { claimsNoToken: claimsNoToken[0], claimsNoServiceDate: claimsNoServiceDate[0] };
}

async function auditStaleData() {
  console.log('Checking for stale/outdated data...');

  // 1. Claims not updated in >30 days
  const staleClaims = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM insurance_claims
    WHERE status NOT IN ('RESOLVED', 'DENIED')
    AND updated_at < ${THIRTY_DAYS_AGO}
    AND deleted_at IS NULL
  `;
  if (staleClaims[0].count > 0) {
    findings.push({
      category: 'STALE_DATA',
      severity: 'info',
      message: `${staleClaims[0].count} active claims not updated in >30 days (may need refresh)`,
      count: Number(staleClaims[0].count),
    });
  }

  // 2. EligibilitySnapshot stale (>30 days old, no refresh)
  const staleSnapshots = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM eligibility_snapshots
    WHERE verified_at < ${THIRTY_DAYS_AGO}
  `;
  if (staleSnapshots[0].count > 0) {
    findings.push({
      category: 'STALE_DATA',
      severity: 'info',
      message: `${staleSnapshots[0].count} eligibility snapshots older than 30 days`,
      count: Number(staleSnapshots[0].count),
    });
  }

  // 3. Recovery actions in BLOCKING status for >90 days
  const ninetyAgo = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
  const longBlockedActions = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM claim_recovery_actions
    WHERE status = 'BLOCKING' AND created_at < ${ninetyAgo}
  `;
  if (longBlockedActions[0].count > 0) {
    findings.push({
      category: 'STALE_DATA',
      severity: 'warning',
      message: `${longBlockedActions[0].count} recovery actions blocked for >90 days (escalate)`,
      count: Number(longBlockedActions[0].count),
    });
  }

  return { staleClaims: staleClaims[0], staleSnapshots: staleSnapshots[0], longBlockedActions: longBlockedActions[0] };
}

async function auditDataQualityMetrics(orphaned, missing, stale) {
  console.log('Calculating data quality metrics...');

  // Practice counts
  const practiceCount = await prisma.practice.count();
  const practicesWithClaims = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT practice_id) as count FROM insurance_claims
  `;
  const totalClaims = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM insurance_claims WHERE deleted_at IS NULL
  `;
  const totalCallAttempts = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM call_attempts
  `;

  // Resolve rate
  const resolvedClaims = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM insurance_claims
    WHERE status = 'RESOLVED' AND deleted_at IS NULL
  `;
  const deniedClaims = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM insurance_claims
    WHERE status = 'DENIED' AND deleted_at IS NULL
  `;

  const successfulOutcomes = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM call_attempts
    WHERE outcome IN ('RESOLVED', 'PENDING')
  `;
  const failedOutcomes = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM call_attempts
    WHERE outcome IN ('FAILED', 'NO_ANSWER', 'HUNG_UP')
  `;

  console.log('\n=== Data Counts ===');
  console.log(`Practices: ${practiceCount}`);
  console.log(`Practices with claims: ${Number(practicesWithClaims[0].count)}`);
  console.log(`Total claims (active): ${Number(totalClaims[0].count)}`);
  console.log(`Total call attempts: ${Number(totalCallAttempts[0].count)}`);
  console.log(`Resolved claims: ${Number(resolvedClaims[0].count)}`);
  console.log(`Denied claims: ${Number(deniedClaims[0].count)}`);
  console.log(`Successful call outcomes: ${Number(successfulOutcomes[0].count)}`);
  console.log(`Failed/incomplete outcomes: ${Number(failedOutcomes[0].count)}`);

  // Quality scoring
  let qualityScore = 100;

  // Deduct for orphaned/inconsistent records
  const totalIssues =
    (Number(orphaned.orphanedCalls.count) || 0) +
    (Number(orphaned.orphanedQueue.count) || 0) +
    (Number(orphaned.orphanedClaims.count) || 0) +
    (Number(orphaned.orphanedSnapshots.count) || 0);
  if (totalIssues > 0) qualityScore -= Math.min(15, totalIssues * 2);

  // Deduct for missing critical data
  const totalMissing =
    (Number(missing.claimsNoToken.count) || 0) + (Number(missing.claimsNoServiceDate.count) || 0);
  if (totalMissing > 0) qualityScore -= Math.min(10, totalMissing);

  // Deduct for stale data
  const totalStale = Number(stale.staleClaims.count) || 0;
  if (totalStale > 0) qualityScore -= Math.min(8, Math.floor(totalStale / 100));

  // Deduct for call failure rate
  const totalOutcomes = Number(successfulOutcomes[0].count) + Number(failedOutcomes[0].count);
  if (totalOutcomes > 0) {
    const failureRate = Number(failedOutcomes[0].count) / totalOutcomes;
    if (failureRate > 0.3) qualityScore -= 10; // >30% failure rate
    else if (failureRate > 0.15) qualityScore -= 5; // >15% failure rate
  }

  qualityScore = Math.max(0, qualityScore);

  console.log(`\n=== Quality Score: ${qualityScore}/100 ===`);

  // Trend alert
  if (qualityScore < 50) {
    findings.push({
      category: 'QUALITY_SCORE',
      severity: 'critical',
      message: `Overall data quality score ${qualityScore}/100 — CRITICAL`,
    });
  } else if (qualityScore < 70) {
    findings.push({
      category: 'QUALITY_SCORE',
      severity: 'warning',
      message: `Overall data quality score ${qualityScore}/100 — DEGRADED`,
    });
  } else if (qualityScore < 85) {
    findings.push({
      category: 'QUALITY_SCORE',
      severity: 'info',
      message: `Overall data quality score ${qualityScore}/100 — ACCEPTABLE`,
    });
  } else {
    findings.push({
      category: 'QUALITY_SCORE',
      severity: 'info',
      message: `Overall data quality score ${qualityScore}/100 — HEALTHY`,
    });
  }

  return qualityScore;
}

async function main() {
  console.log('Starting CollectRX Data Quality Audit...\n');

  try {
    // Run all audits
    const orphaned = await auditOrphanedRecords();
    const missing = await auditMissingRecords();
    const stale = await auditStaleData();
    const qualityScore = await auditDataQualityMetrics(orphaned, missing, stale);

    // Summary report
    console.log('\n=== AUDIT FINDINGS ===\n');
    if (findings.length === 0) {
      console.log('No issues found.');
    } else {
      const critical = findings.filter((f) => f.severity === 'critical');
      const warnings = findings.filter((f) => f.severity === 'warning');
      const info = findings.filter((f) => f.severity === 'info');

      if (critical.length > 0) {
        console.log('CRITICAL:');
        critical.forEach((f) => console.log(`  - ${f.message}${f.count ? ` (${f.count})` : ''}`));
      }

      if (warnings.length > 0) {
        console.log('\nWARNING:');
        warnings.forEach((f) => console.log(`  - ${f.message}${f.count ? ` (${f.count})` : ''}`));
      }

      if (info.length > 0) {
        console.log('\nINFO:');
        info.forEach((f) => console.log(`  - ${f.message}${f.count ? ` (${f.count})` : ''}`));
      }
    }

    // Escalation recommendation
    const criticalCount = findings.filter((f) => f.severity === 'critical').length;
    const warningCount = findings.filter((f) => f.severity === 'warning').length;

    console.log('\n=== ESCALATION RECOMMENDATION ===');
    if (criticalCount >= 3 || findings.some((f) => f.message.includes('CRITICAL'))) {
      console.log('RED ZONE — Immediate ops intervention required');
    } else if (criticalCount > 0 || warningCount >= 5) {
      console.log('YELLOW ZONE — Schedule investigation within 24 hours');
    } else {
      console.log('NONE — Continue normal monitoring');
    }

    process.exit(0);
  } catch (e) {
    console.error('Audit failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
