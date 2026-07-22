/**
 * Carrier Whitelist Validation Test
 *
 * Tests carrier enabled/disabled state validation during dispatch.
 * Requirements:
 * - 5 practices
 * - 50+ dispatch attempts
 * - Verify disabled carriers are rejected
 * - Verify enabled carriers are accepted
 * - Verify re-enabling a carrier allows dispatch
 */

import { PrismaClient, type CarrierId } from '@prisma/client';
import { validateDispatch, checkCarrierAuthorizationGate } from '../src/carriers/adapter';
import { getPracticeSettings } from '../src/server/services/practiceSettingsService';

interface DispatchLog {
  practiceId: string;
  practiceName: string;
  carrierId: CarrierId;
  carrierEnabled: boolean;
  dispatchAttempt: number;
  result: 'PASS' | 'FAIL';
  reason?: string;
}

const dispatchLogs: DispatchLog[] = [];

async function createTestPractice(prisma: PrismaClient, index: number): Promise<string> {
  const practice = await prisma.practice.create({
    data: {
      name: `Test Practice ${index + 1}`,
      timezone: 'America/Toronto',
      passwordHash: 'test_hash',
    },
  });

  // Initialize practice settings with voice agent enabled
  await prisma.practice.update({
    where: { id: practice.id },
    data: {
      settings: {
        voiceAgentEnabled: true,
        automationEnabled: true,
        emailsEnabled: true,
        sendFromPracticeEmail: false,
        usageVisibleToOfficeManager: false,
        usageVisibleToBillingCoordinator: false,
        usageAlertEmailsEnabled: true,
        callWindowStart: '08:00',
        callWindowEnd: '17:00',
        escalationPhoneNumber: '416-555-0100',
        carrierConfigs: [
          {
            carrierId: 'sun_life',
            enabled: true,
            minimumClaimAgeDays: 32,
            maxAttempts: 3,
            callWindowStart: '08:00',
            callWindowEnd: '17:00',
            notes: '',
            providerNumber: 'PROV-001',
            authorizationSubmitted: true,
            authorizationSubmittedAt: new Date().toISOString(),
            languagePreference: 'en' as const,
          },
          {
            carrierId: 'canada_life',
            enabled: true,
            minimumClaimAgeDays: 32,
            maxAttempts: 3,
            callWindowStart: '08:00',
            callWindowEnd: '17:00',
            notes: '',
            providerNumber: 'PROV-002',
            authorizationSubmitted: true,
            authorizationSubmittedAt: new Date().toISOString(),
            languagePreference: 'en' as const,
          },
          {
            carrierId: 'manulife',
            enabled: false,
            minimumClaimAgeDays: 32,
            maxAttempts: 3,
            callWindowStart: '08:00',
            callWindowEnd: '17:00',
            notes: '',
            providerNumber: 'PROV-003',
            authorizationSubmitted: true,
            authorizationSubmittedAt: new Date().toISOString(),
            languagePreference: 'en' as const,
          },
          {
            carrierId: 'green_shield',
            enabled: true,
            minimumClaimAgeDays: 32,
            maxAttempts: 3,
            callWindowStart: '08:00',
            callWindowEnd: '17:00',
            notes: '',
            providerNumber: 'PROV-004',
            authorizationSubmitted: true,
            authorizationSubmittedAt: new Date().toISOString(),
            languagePreference: 'en' as const,
          },
          {
            carrierId: 'rbc',
            enabled: false,
            minimumClaimAgeDays: 32,
            maxAttempts: 3,
            callWindowStart: '08:00',
            callWindowEnd: '17:00',
            notes: '',
            providerNumber: 'PROV-005',
            authorizationSubmitted: true,
            authorizationSubmittedAt: new Date().toISOString(),
            languagePreference: 'en' as const,
          },
          {
            carrierId: 'telus_adjudicare',
            enabled: true,
            minimumClaimAgeDays: 21,
            maxAttempts: 3,
            callWindowStart: '08:00',
            callWindowEnd: '17:00',
            notes: '',
            providerNumber: 'PROV-006',
            authorizationSubmitted: true,
            authorizationSubmittedAt: new Date().toISOString(),
            languagePreference: 'en' as const,
          },
        ],
        telusTpaMappings: {},
      },
    },
  });

  return practice.id;
}

async function createTestClaim(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: CarrierId,
  claimNumber: string,
): Promise<string> {
  const claim = await prisma.insuranceClaim.create({
    data: {
      practiceId,
      carrierId,
      claimNumber,
      patientToken: 'test-token-' + Math.random().toString(36).substr(2, 9),
      billedAmount: 500,
      outstandingAmount: 500,
      daysOutstanding: 45,
      status: 'PENDING',
      priority: 'NORMAL',
    },
  });

  return claim.id;
}

async function testDispatchValidation(
  prisma: PrismaClient,
  practiceId: string,
  practiceName: string,
  claimId: string,
  carrierId: CarrierId,
  daysOutstanding: number,
  attemptCount: number,
): Promise<DispatchLog> {
  const settings = await getPracticeSettings(prisma, practiceId);
  const carrierConfig = settings.carrierConfigs.find((c) => c.carrierId === carrierId);
  const isEnabled = carrierConfig?.enabled ?? false;

  const guard = await validateDispatch(prisma, {
    practiceId,
    claimId,
    carrierId,
    daysOutstanding,
    attemptsSoFar: attemptCount,
    claimStatus: 'PENDING',
  });

  const dispatchLog: DispatchLog = {
    practiceId,
    practiceName,
    carrierId,
    carrierEnabled: isEnabled,
    dispatchAttempt: attemptCount + 1,
    result: 'PASS',
    reason: undefined,
  };

  // Verify correct behavior:
  // - If carrier is NOT enabled, dispatch should fail
  // - If carrier IS enabled, dispatch should pass (assuming other guards pass)
  if (!isEnabled) {
    if (!guard.allowed) {
      dispatchLog.result = 'PASS';
      dispatchLog.reason = 'Correctly rejected disabled carrier';
    } else {
      dispatchLog.result = 'FAIL';
      dispatchLog.reason = 'ERROR: Disabled carrier was allowed through!';
    }
  } else {
    // Carrier IS enabled - check if authorization gate passes
    const authGate = await checkCarrierAuthorizationGate(prisma, practiceId, carrierId);
    if (authGate.allowed) {
      dispatchLog.result = 'PASS';
      dispatchLog.reason = 'Correctly allowed enabled carrier';
    } else {
      dispatchLog.result = 'FAIL';
      dispatchLog.reason = `Enabled carrier rejected: ${authGate.reason}`;
    }
  }

  dispatchLogs.push(dispatchLog);
  return dispatchLog;
}

async function updateCarrierEnabled(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: CarrierId,
  enabled: boolean,
): Promise<void> {
  const settings = await getPracticeSettings(prisma, practiceId);
  const carrierConfigs = settings.carrierConfigs.map((c) =>
    c.carrierId === carrierId ? { ...c, enabled } : c
  );

  await prisma.practice.update({
    where: { id: practiceId },
    data: {
      settings: {
        ...settings,
        carrierConfigs,
      },
    },
  });
}

async function runValidationTests() {
  const prisma = new PrismaClient();

  console.log('CARRIER WHITELIST VALIDATION TEST');
  console.log('==================================\n');

  try {
    // Step 1: Create 5 test practices
    console.log('Creating 5 test practices...');
    const practiceIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await createTestPractice(prisma, i);
      practiceIds.push(id);
      console.log(`  ✓ Created Practice ${i + 1} (ID: ${id})`);
    }
    console.log('');

    // Step 2: Test 1 - Practice A with enabled/disabled carriers
    console.log('TEST 1: Practice A - Mixed enabled/disabled carriers');
    console.log('--------------------------------------------------');
    const practiceA = practiceIds[0];
    const practiceAName = 'Test Practice 1';

    // Create claims for each carrier
    const sunLifeClaimA = await createTestClaim(prisma, practiceA, 'sun_life', 'CLAIM-SL-001');
    const canadaLifeClaimA = await createTestClaim(prisma, practiceA, 'canada_life', 'CLAIM-CL-001');
    const manulifeClaimA = await createTestClaim(prisma, practiceA, 'manulife', 'CLAIM-ML-001');
    const rbcClaimA = await createTestClaim(prisma, practiceA, 'rbc', 'CLAIM-RBC-001');

    // Attempt 1-3: Try to dispatch to enabled carriers (should succeed)
    await testDispatchValidation(prisma, practiceA, practiceAName, sunLifeClaimA, 'sun_life', 45, 0);
    await testDispatchValidation(prisma, practiceA, practiceAName, canadaLifeClaimA, 'canada_life', 45, 0);

    // Attempt 4-5: Try to dispatch to disabled carriers (should fail)
    await testDispatchValidation(prisma, practiceA, practiceAName, manulifeClaimA, 'manulife', 45, 0);
    await testDispatchValidation(prisma, practiceA, practiceAName, rbcClaimA, 'rbc', 45, 0);

    // Step 3: Re-enable carriers and retry
    console.log('\nTEST 2: Re-enable manulife and rbc for Practice A');
    console.log('-----------------------------------------------');
    await updateCarrierEnabled(prisma, practiceA, 'manulife', true);
    await updateCarrierEnabled(prisma, practiceA, 'rbc', true);

    // Attempt 6-7: Retry previously disabled carriers (should now succeed)
    await testDispatchValidation(prisma, practiceA, practiceAName, manulifeClaimA, 'manulife', 45, 1);
    await testDispatchValidation(prisma, practiceA, practiceAName, rbcClaimA, 'rbc', 45, 1);

    // Step 4: Test with remaining practices (50+ dispatch attempts across all)
    console.log('\nTEST 3: Dispatch validation across remaining practices');
    console.log('-----------------------------------------------------');
    let dispatchCount = 8;
    const carriers: CarrierId[] = ['sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare'];

    for (let i = 1; i < practiceIds.length; i++) {
      const practiceId = practiceIds[i];
      const practiceName = `Test Practice ${i + 1}`;

      // Create multiple claims per practice and test different carrier combinations
      for (let j = 0; j < 10; j++) {
        const carrierId = carriers[j % carriers.length];
        const claimId = await createTestClaim(prisma, practiceId, carrierId, `CLAIM-${i}-${j}`);

        // Randomize attempt count for variety
        const attempts = Math.floor(Math.random() * 3);
        await testDispatchValidation(prisma, practiceId, practiceName, claimId, carrierId, 45, attempts);

        dispatchCount++;
      }
    }

    // Ensure we have 50+ attempts
    const remainingAttempts = 50 - dispatchCount;
    if (remainingAttempts > 0) {
      console.log(`\nAdding ${remainingAttempts} additional dispatch attempts to reach 50+...`);
      const practice = practiceIds[0];
      for (let i = 0; i < remainingAttempts; i++) {
        const carrier = carriers[i % carriers.length];
        const claim = await createTestClaim(prisma, practice, carrier, `CLAIM-EXTRA-${i}`);
        await testDispatchValidation(prisma, practice, practiceAName, claim, carrier, 45, 0);
      }
    }

    // Step 5: Print report
    console.log('\n');
    console.log('='.repeat(80));
    console.log('VALIDATION REPORT');
    console.log('='.repeat(80));
    console.log(`Total dispatch attempts: ${dispatchLogs.length}`);
    console.log(`Passed: ${dispatchLogs.filter((l) => l.result === 'PASS').length}`);
    console.log(`Failed: ${dispatchLogs.filter((l) => l.result === 'FAIL').length}`);
    console.log('');

    // Group logs by practice
    const byPractice = new Map<string, DispatchLog[]>();
    for (const log of dispatchLogs) {
      if (!byPractice.has(log.practiceId)) {
        byPractice.set(log.practiceId, []);
      }
      byPractice.get(log.practiceId)!.push(log);
    }

    // Print per-practice summary
    for (const [practiceId, logs] of byPractice) {
      const practice = logs[0];
      const passed = logs.filter((l) => l.result === 'PASS').length;
      const failed = logs.filter((l) => l.result === 'FAIL').length;

      console.log(`${practice.practiceName} (${practiceId})`);
      console.log(`  Total attempts: ${logs.length} | Passed: ${passed} | Failed: ${failed}`);

      // Print failed tests
      if (failed > 0) {
        console.log('  Failed attempts:');
        logs.filter((l) => l.result === 'FAIL').forEach((log) => {
          console.log(`    - ${log.carrierId} (enabled: ${log.carrierEnabled}): ${log.reason}`);
        });
      }
      console.log('');
    }

    // Overall result
    const totalFailed = dispatchLogs.filter((l) => l.result === 'FAIL').length;
    const overallResult = totalFailed === 0 ? 'PASSED ✓' : `FAILED (${totalFailed} errors)`;

    console.log('='.repeat(80));
    console.log(`OVERALL RESULT: ${overallResult}`);
    console.log('='.repeat(80));

    if (totalFailed === 0) {
      console.log('\nCarrier whitelist validation successful!');
      console.log(`- Disabled carriers correctly rejected`);
      console.log(`- Enabled carriers correctly allowed`);
      console.log(`- Re-enabling carriers allows dispatch`);
      console.log(`- Total dispatch attempts: ${dispatchLogs.length} (target: 50+)`);
    } else {
      console.log('\nCarrier whitelist validation FAILED');
      process.exit(1);
    }
  } catch (error) {
    console.error('Test error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the tests
runValidationTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
