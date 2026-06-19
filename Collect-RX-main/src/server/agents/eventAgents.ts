/**
 * Event Agents — Situation-triggered autonomous agents.
 *
 * These are NOT on a cron schedule. They fire in response to specific
 * events in the CollectRx system. Import the trigger function and call
 * it at the appropriate event point.
 *
 * Trigger map:
 *
 * post-call-debrief          call.ended (vapiWebhook.ts)
 * hallucination-detector     call.ended for RESOLVED/DENIED/APPROVED outcomes
 * escalation-triage          ESCALATION_REQUIRED outcome in vapiWebhook.ts
 * incident-response          CARRIER_BLOCK detection or risk-radar CRITICAL
 * practice-onboarding-validator  new practice activated (practices route)
 * release-readiness          manual trigger via API endpoint
 */

import type { PrismaClient } from '@prisma/client';
import { runAgent, type AgentResult } from './agentRunner.js';

// ── post-call-debrief ─────────────────────────────────────────────────────────
// Fired after every call.ended. Extracts lessons from the call and routes
// findings to voice-agent-trainer and carrier-ivr-health.

export async function triggerPostCallDebrief(
  prisma: PrismaClient,
  callData: {
    vapiCallId: string;
    claimId: string;
    carrierId: string;
    outcome: string;
    durationSeconds?: number;
    transcript?: string;
  },
): Promise<void> {
  // Fire-and-forget — never block the webhook response
  runAgent('post-call-debrief', { call: callData }, prisma).catch((err) => {
    console.error('[EventAgents] post-call-debrief failed:', err);
  });
}

// ── hallucination-detector ────────────────────────────────────────────────────
// Fired after any call with a financially terminal outcome (RESOLVED, DENIED,
// APPROVED_PENDING_PAYMENT). Checks transcript for fabricated reference numbers
// or false confirmations.

export async function triggerHallucinationDetector(
  prisma: PrismaClient,
  callData: {
    vapiCallId: string;
    claimId: string;
    carrierId: string;
    outcome: string;
    transcript?: string;
    referenceNumber?: string;
  },
): Promise<void> {
  const HIGH_STAKE_OUTCOMES = ['RESOLVED', 'DENIED', 'APPROVED_PENDING_PAYMENT'];
  if (!HIGH_STAKE_OUTCOMES.includes(callData.outcome)) return;

  runAgent('hallucination-detector', { call: callData }, prisma).catch((err) => {
    console.error('[EventAgents] hallucination-detector failed:', err);
  });
}

// ── escalation-triage ─────────────────────────────────────────────────────────
// Fired when a call ends with ESCALATION_REQUIRED. Routes the claim to the
// right human reviewer and tracks SLA.

export async function triggerEscalationTriage(
  prisma: PrismaClient,
  escalationData: {
    claimId: string;
    carrierId: string;
    reason: string;
    practiceId: string;
    billedAmount?: number;
  },
): Promise<void> {
  runAgent('escalation-triage', { escalation: escalationData }, prisma).catch((err) => {
    console.error('[EventAgents] escalation-triage failed:', err);
  });
}

// ── incident-response ─────────────────────────────────────────────────────────
// Fired on CARRIER_BLOCK, PHI breach signal, or when risk-radar returns CRITICAL.
// Plays the relevant runbook section.

export type IncidentType =
  | 'CARRIER_BLOCK'
  | 'PHI_BREACH'
  | 'QUEUE_OUTAGE'
  | 'VAPI_FAILURE'
  | 'BILLING_ANOMALY'
  | 'COMPLIANCE_VIOLATION';

export async function triggerIncidentResponse(
  prisma: PrismaClient,
  incident: {
    type: IncidentType;
    carrierId?: string;
    practiceId?: string;
    detail: string;
    detectedBy: string;
  },
): Promise<AgentResult> {
  // Incident response IS awaited — we want to know if it failed
  return runAgent('incident-response', { incident }, prisma);
}

// ── practice-onboarding-validator ─────────────────────────────────────────────
// Fired when a new practice is activated. Verifies BAAL, provider numbers,
// and CSV import are complete before the first call is allowed.

export async function triggerPracticeOnboardingValidator(
  prisma: PrismaClient,
  practice: {
    id: string;
    name: string;
    tier: string;
    authorizationSubmitted: boolean;
    providerNumber?: string;
  },
): Promise<void> {
  runAgent('practice-onboarding-validator', { practice }, prisma).catch((err) => {
    console.error('[EventAgents] practice-onboarding-validator failed:', err);
  });
}

// ── release-readiness ─────────────────────────────────────────────────────────
// Fired manually before a deploy via POST /internal/agents/release-readiness.
// Returns the result synchronously — the deploy gate waits on this.

export async function triggerReleaseReadiness(
  prisma: PrismaClient,
  releaseData: {
    version?: string;
    changedFiles?: string[];
    triggerSource: 'manual' | 'ci';
  },
): Promise<AgentResult> {
  return runAgent('release-readiness', { release: releaseData }, prisma);
}

// ── backend-reviewer ──────────────────────────────────────────────────────────
// Fired manually via POST /internal/agents/backend-reviewer with a file list.
// Returns structured review findings.

export async function triggerBackendReviewer(
  prisma: PrismaClient,
  reviewData: {
    files: string[];
    prTitle?: string;
    triggerSource: 'manual' | 'pr_webhook';
  },
): Promise<AgentResult> {
  return runAgent('backend-reviewer', { review: reviewData }, prisma);
}
