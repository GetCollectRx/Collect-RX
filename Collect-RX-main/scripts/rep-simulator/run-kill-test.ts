#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Rep Simulator harness ("Kill Test 1")
//
// Entry point for validating a carrier (starting with Green Shield) before
// any live claim is ever dispatched against it. Every CallAttempt this
// script writes carries isSynthetic=true, a testRunId, and a repPersona so
// it can never be mistaken for a real recovery call in analytics, billing,
// or the front-desk console.
//
// Guard order (do not reorder):
//   1. assertUnderTestCallCostGuard() — hard $30/run spend ceiling
//      (src/server/services/testCallCostGuard.ts). Runs BEFORE any Vapi
//      call so a runaway test run can never overspend. Mirrors the
//      CARRIER_BLOCK "check before proceeding" idiom in
//      src/carriers/adapter.ts.
//   2. VAPI_API_KEY presence check — fails loud with a clear message and a
//      non-zero exit code. This script never fakes a success path when it
//      cannot actually dispatch a call.
//
// Carriers do not offer a sandbox environment, so when a real Vapi key IS
// present this dials the carrier's real published claims line (same numbers
// as CARRIER_PHONE_MAP in src/vapi/client.ts / scripts/ivr-research/
// research-call.cjs) using fabricated placeholder identity data — never real
// patient PHI. That is why the cost ceiling and isSynthetic/testRunId
// tagging exist: this is a controlled, bounded, clearly-labeled rehearsal
// call, not a real claim follow-up.
//
// Usage:
//   npx tsx scripts/rep-simulator/run-kill-test.ts --carrier green_shield --run-id <uuid>
//   npx tsx scripts/rep-simulator/run-kill-test.ts --carrier green_shield   # generates a run id
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { CarrierId } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { CALL_TIMEOUTS } from '../../src/billing/tiers.js';
import {
  assertUnderTestCallCostCeiling,
  TestCallCostCeilingExceededError,
  type TestCallCostSummary,
} from '../../src/server/services/testCallCostGuard.js';
import {
  CARRIER_PHONE_MAP,
  getCallStatus,
  initiateCall,
  type VapiCallStatus,
} from '../../src/vapi/client.js';

const SUPPORTED_CARRIERS = Object.keys(CARRIER_PHONE_MAP) as CarrierId[];

/** Dedicated, idempotent practice fixture — never a real practice's data. */
const SYNTHETIC_PRACTICE_NAME = 'CollectRx Rep Simulator (synthetic kill-test fixture)';

export class UsageError extends Error {}

/** Thrown instead of a fake success path when no live Vapi credential is available. */
export class MissingVapiApiKeyError extends Error {}

export interface KillTestArgs {
  carrierId: CarrierId;
  testRunId: string;
}

export interface KillTestOutcome {
  testRunId: string;
  carrierId: CarrierId;
  costSummary: TestCallCostSummary;
}

function isSupportedCarrier(value: string): value is CarrierId {
  return (SUPPORTED_CARRIERS as readonly string[]).includes(value);
}

/**
 * Parses `--carrier <id>` (required) and `--run-id <uuid>` (optional — a
 * fresh UUID is generated when omitted, so ad hoc runs never collide with a
 * prior run's cost total).
 */
export function parseArgs(argv: readonly string[]): KillTestArgs {
  let carrier: string | undefined;
  let runId: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--carrier') {
      carrier = argv[i + 1];
      i += 1;
    } else if (token === '--run-id') {
      runId = argv[i + 1];
      i += 1;
    }
  }

  if (!carrier) {
    throw new UsageError(
      `--carrier is required. Supported carriers: ${SUPPORTED_CARRIERS.join(', ')}. ` +
        'Example: npx tsx scripts/rep-simulator/run-kill-test.ts --carrier green_shield --run-id <uuid>',
    );
  }
  if (!isSupportedCarrier(carrier)) {
    throw new UsageError(`Unknown carrier "${carrier}". Supported carriers: ${SUPPORTED_CARRIERS.join(', ')}.`);
  }

  return { carrierId: carrier, testRunId: runId ?? randomUUID() };
}

async function findOrCreateSyntheticPractice(): Promise<{ id: string }> {
  const existing = await prisma.practice.findFirst({
    where: { name: SYNTHETIC_PRACTICE_NAME },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.practice.create({
    data: {
      name: SYNTHETIC_PRACTICE_NAME,
      // Not a real login — this practice is a Rep Simulator fixture, never surfaced to a user.
      passwordHash: 'rep-simulator-synthetic-fixture-no-login',
      billingPhone: '+15555550100',
      npi: 'SYNTHETIC-KILL-TEST-NPI',
    },
    select: { id: true },
  });
}

/** One InsuranceClaim per test run, so kill-test spend/history stays traceable and disposable. */
async function createSyntheticClaim(practiceId: string, carrierId: CarrierId, testRunId: string) {
  return prisma.insuranceClaim.create({
    data: {
      practiceId,
      carrierId,
      claimNumber: `KILLTEST-${testRunId}`,
      // No real patient exists behind this token — synthetic fixture only.
      patientToken: randomUUID(),
      billedAmount: 100,
      outstandingAmount: 100,
      daysOutstanding: 45,
    },
  });
}

/**
 * Vapi calls are asynchronous — initiateCall() only confirms the call was
 * queued. Poll getCallStatus() until Vapi reports the call ended, bounded by
 * the same absolute call-length ceiling production dispatch enforces
 * (CALL_TIMEOUTS.absoluteMaxMinutes) plus a fixed margin for Vapi's own
 * post-call processing lag.
 */
async function pollUntilComplete(vapiCallId: string): Promise<VapiCallStatus> {
  const pollIntervalMs = 5_000;
  const timeoutMarginMs = 2 * 60 * 1000;
  const deadline = Date.now() + CALL_TIMEOUTS.absoluteMaxMinutes * 60 * 1000 + timeoutMarginMs;

  for (;;) {
    const status = await getCallStatus(vapiCallId);
    if (status.endedAt !== null) return status;
    if (Date.now() > deadline) {
      throw new Error(`[rep-simulator] Timed out waiting for call ${vapiCallId} to end.`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Only reachable once VAPI_API_KEY is confirmed present. Places the call,
 * waits for it to end, and records exactly one CallAttempt row tagged as
 * synthetic so it is unambiguously excluded from real AR/billing reporting.
 */
async function dispatchSyntheticCall(carrierId: CarrierId, testRunId: string): Promise<void> {
  const practice = await findOrCreateSyntheticPractice();
  const claim = await createSyntheticClaim(practice.id, carrierId, testRunId);

  const callResult = await initiateCall({
    claimId: claim.id,
    carrierId,
    practiceId: practice.id,
    patientToken: claim.patientToken,
    // Placeholder identity only — never real PHI. See file header: carriers
    // offer no sandbox, so this rehearsal call dials their real claims line.
    patientName: 'SYNTHETIC TEST PATIENT — REP SIMULATOR',
    patientDob: '1990-01-01',
    policyNumber: 'SYNTHETIC-0000',
    carrierPhone: CARRIER_PHONE_MAP[carrierId],
    claimNumber: claim.claimNumber,
    daysOutstanding: claim.daysOutstanding,
    billedAmount: Number(claim.billedAmount),
    outstandingAmount: Number(claim.outstandingAmount),
    practiceName: SYNTHETIC_PRACTICE_NAME,
    providerNumber: 'SYNTHETIC-PROVIDER',
    practicePhone: '+15555550100',
  });

  const finalStatus = await pollUntilComplete(callResult.vapiCallId);

  await prisma.callAttempt.create({
    data: {
      claimId: claim.id,
      vapiCallId: callResult.vapiCallId,
      initiatedAt: new Date(callResult.createdAt),
      completedAt: finalStatus.endedAt ? new Date(finalStatus.endedAt) : new Date(),
      durationSeconds: finalStatus.durationSeconds ?? undefined,
      minutesBilled:
        finalStatus.durationSeconds != null ? Math.ceil(finalStatus.durationSeconds / 60) : undefined,
      transcriptText: finalStatus.transcript ?? undefined,
      isSynthetic: true,
      testRunId,
      repPersona: `${carrierId}_carrier_rep`,
    },
  });
}

/**
 * Full Kill Test 1 flow: parse args, enforce the cost ceiling, require a
 * real Vapi credential, then dispatch. Exported (rather than run inline) so
 * tests can exercise the guard chain without a live Vapi key or network
 * access — see tests/repSimulatorKillTest.test.ts.
 */
export async function runKillTest(argv: readonly string[]): Promise<KillTestOutcome> {
  const { carrierId, testRunId } = parseArgs(argv);

  const costSummary = await assertUnderTestCallCostCeiling(prisma, { testRunId, carrierId });

  if (!process.env.VAPI_API_KEY) {
    throw new MissingVapiApiKeyError(
      `VAPI_API_KEY not set, cannot dispatch a live call for test run ${testRunId} (carrier ${carrierId}). ` +
        'Set VAPI_API_KEY (plus VAPI_SQUAD_ID and VAPI_PHONE_NUMBER_ID) to a real Vapi credential and retry.',
    );
  }

  await dispatchSyntheticCall(carrierId, testRunId);
  return { testRunId, carrierId, costSummary };
}

function describeFailure(err: unknown): string {
  if (err instanceof UsageError) return `[rep-simulator] Usage error: ${err.message}`;
  if (err instanceof TestCallCostCeilingExceededError) {
    return `[rep-simulator] Cost ceiling guard blocked this run: ${err.message}`;
  }
  if (err instanceof MissingVapiApiKeyError) return `[rep-simulator] ${err.message}`;
  return `[rep-simulator] Fatal: ${err instanceof Error ? err.message : String(err)}`;
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void (async () => {
    try {
      const outcome = await runKillTest(process.argv.slice(2));
      console.warn(
        `[rep-simulator] Dispatched Kill Test 1 run ${outcome.testRunId} against ${outcome.carrierId}. ` +
          `Estimated run spend so far: $${outcome.costSummary.projectedTotalCostUsd.toFixed(2)} ` +
          `of $${outcome.costSummary.ceilingUsd.toFixed(2)} ceiling.`,
      );
      process.exitCode = 0;
    } catch (err) {
      console.error(describeFailure(err));
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  })();
}
