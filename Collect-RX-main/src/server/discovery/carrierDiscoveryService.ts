import type {
  CarrierDiscoveryTrigger,
  CarrierId,
  CarrierNavigationProposalStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { CARRIER_CONFIGS } from '../../carriers/adapter.js';

export const DISCOVERY_ENABLED_ENV = 'COLLECTRX_CARRIER_DISCOVERY_ENABLED';
const MAX_NAVIGATION_STEPS = 20;
const MAX_STEP_LENGTH = 300;
const SAFE_NAVIGATION_PREFIX = /^(?:press|dial|say|select|choose|option)\b/i;
const PERSON_NAME_PATTERN = /\b[A-Z][a-z]{1,}\s+[A-Z][a-z]{1,}\b/;
const EXPLICIT_IVR_FAILURE_PATTERN =
  /\b(?:invalid|incorrect|unrecognized|unrecognised)\s+(?:option|selection|menu\s+(?:option|selection|input))\b|\b(?:option|selection)\b(?:\s+\w+){0,4}\s+(?:is|was)\s+(?:invalid|incorrect|unrecognized|unrecognised)\b|\b(?:option|selection)\s+(?:was\s+)?not\s+(?:recognized|recognised|valid)\b|\b(?:ivr|menu)\s+(?:navigation\s+)?(?:failed|failure|timed?\s*out|disconnect(?:ed)?)\b/i;

export type NavigationSnapshot = {
  steps: string[];
};

export type NavigationDiff = {
  added: string[];
  removed: string[];
  unchanged: string[];
};

export type IvrFailureRelearningResult =
  | { status: 'ignored'; reason: 'not_explicit_ivr_failure' | 'no_safe_steps' }
  | { status: 'proposed'; proposalId: string };

type ProposalInput = {
  carrierId: CarrierId;
  discoveryRunId?: string;
  steps: string[];
  summary: string;
  evidence?: string;
  confidence?: number;
};

export function isCarrierDiscoveryEnabled(): boolean {
  return process.env[DISCOVERY_ENABLED_ENV] === '1';
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function containsUnsafeNavigationContent(value: string): boolean {
  return (
    ['[', ']', '{', '}', '<', '>'].some((character) => value.includes(character)) ||
    /\b\d{6,}\b/.test(value) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(value) ||
    /(?:patient|member|subscriber|date\s+of\s+birth|health\s+card)\b|(?:policy|claim)\s*(?:number|no\.?|id)\b/i.test(value) ||
    PERSON_NAME_PATTERN.test(value)
  );
}

export function sanitizeNavigationSteps(steps: string[]): string[] {
  const normalized = steps
    .map(normalizeText)
    .filter(
      (step) =>
        step.length > 0 &&
        step.length <= MAX_STEP_LENGTH &&
        SAFE_NAVIGATION_PREFIX.test(step) &&
        !containsUnsafeNavigationContent(step),
    );
  return [...new Set(normalized)].slice(0, MAX_NAVIGATION_STEPS);
}

/**
 * Deterministic extraction intentionally handles only explicit IVR/menu lines.
 * It makes no network or model call; ambiguous transcript content requires an
 * operator to provide the proposed steps instead.
 */
export function deriveNavigationStepsFromTranscript(transcript: string): string[] {
  const candidates = transcript
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^(?:ivr|system)\s*:\s*/i, '').trim())
    .filter((line) => SAFE_NAVIGATION_PREFIX.test(line));
  return sanitizeNavigationSteps(candidates);
}

export function isExplicitNonBlockIvrFailure(
  transcript: string,
  carrierBlockDetected: boolean,
): boolean {
  return !carrierBlockDetected && EXPLICIT_IVR_FAILURE_PATTERN.test(transcript);
}

function parseNavigation(value: Prisma.JsonValue): NavigationSnapshot {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { steps?: unknown }).steps) &&
    (value as { steps: unknown[] }).steps.every((step) => typeof step === 'string')
  ) {
    return { steps: sanitizeNavigationSteps((value as { steps: string[] }).steps) };
  }
  return { steps: [] };
}

export function diffNavigation(previous: string[], proposed: string[]): NavigationDiff {
  const previousSet = new Set(previous);
  const proposedSet = new Set(proposed);
  return {
    added: proposed.filter((step) => !previousSet.has(step)),
    removed: previous.filter((step) => !proposedSet.has(step)),
    unchanged: proposed.filter((step) => previousSet.has(step)),
  };
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export async function ensureMonthlyDiscoveryRoster(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  const start = monthStart(now);
  const end = nextMonthStart(now);
  let created = 0;

  for (const carrierId of Object.keys(CARRIER_CONFIGS) as CarrierId[]) {
    const existing = await prisma.carrierDiscoveryRun.findFirst({
      where: { carrierId, trigger: 'MONTHLY', createdAt: { gte: start, lt: end } },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.carrierDiscoveryRun.create({
      data: { carrierId, trigger: 'MONTHLY', dueAt: start },
    });
    created += 1;
  }
  return created;
}

export async function requestCarrierRediscovery(
  prisma: PrismaClient,
  carrierId: CarrierId,
  trigger: Exclude<CarrierDiscoveryTrigger, 'MONTHLY'>,
  _issueDetail?: string,
  requestedBy?: string,
): Promise<string> {
  const run = await prisma.carrierDiscoveryRun.create({
    data: {
      carrierId,
      trigger,
      dueAt: new Date(),
      // Discovery knowledge is global, so never persist call-derived issue
      // detail here. A carrier block or transcript may contain PHI.
      issueDetail: null,
      requestedBy: requestedBy ?? null,
    },
  });
  return run.id;
}

export async function getPublishedNavigationSteps(
  prisma: PrismaClient,
  carrierId: CarrierId,
): Promise<string[]> {
  const snapshot = await prisma.carrierNavigationSnapshot.findFirst({
    where: { carrierId, publishedAt: { not: null } },
    orderBy: { version: 'desc' },
    select: { navigation: true },
  });
  return snapshot ? parseNavigation(snapshot.navigation).steps : [];
}

export async function createNavigationProposal(
  prisma: PrismaClient,
  input: ProposalInput,
): Promise<{ id: string; diff: NavigationDiff }> {
  const steps = sanitizeNavigationSteps(input.steps);
  if (steps.length === 0) {
    throw new Error('Proposal requires explicit, PHI-safe IVR navigation steps');
  }
  const base = await prisma.carrierNavigationSnapshot.findFirst({
    where: { carrierId: input.carrierId, publishedAt: { not: null } },
    orderBy: { version: 'desc' },
    select: { id: true, navigation: true },
  });
  const diff = diffNavigation(base ? parseNavigation(base.navigation).steps : [], steps);
  const proposal = await prisma.carrierNavigationProposal.create({
    data: {
      carrierId: input.carrierId,
      discoveryRunId: input.discoveryRunId ?? null,
      baseSnapshotId: base?.id ?? null,
      proposedNavigation: { steps },
      // These records are platform-wide. Store a fixed operational summary
      // rather than caller-supplied transcript/evidence text.
      proposedSummary: `Operator-submitted IVR navigation update for ${input.carrierId}`,
      diff,
      evidence: null,
      confidence: Math.max(0, Math.min(1, input.confidence ?? 0)),
    },
    select: { id: true },
  });
  return { id: proposal.id, diff };
}

/**
 * Records a deterministic, PHI-safe IVR observation as a proposal. Transcript-
 * derived navigation can never publish itself; a human reviewer must approve it.
 * It does not interact with carrier block state.
 */
export async function recordIvrFailureRelearningObservation(
  prisma: PrismaClient,
  carrierId: CarrierId,
  transcript: string,
  carrierBlockDetected: boolean,
): Promise<IvrFailureRelearningResult> {
  if (!isExplicitNonBlockIvrFailure(transcript, carrierBlockDetected)) {
    return { status: 'ignored', reason: 'not_explicit_ivr_failure' };
  }

  const steps = deriveNavigationStepsFromTranscript(transcript);
  if (steps.length === 0) {
    return { status: 'ignored', reason: 'no_safe_steps' };
  }

  const proposal = await createNavigationProposal(prisma, {
    carrierId,
    steps,
    summary: 'Deterministic IVR failure observation',
    confidence: 1,
  });
  return { status: 'proposed', proposalId: proposal.id };
}

export async function reviewNavigationProposal(
  prisma: PrismaClient,
  proposalId: string,
  action: 'approve' | 'reject',
  reviewerId: string,
  _reviewNotes?: string,
): Promise<boolean> {
  if (action === 'reject') {
    const result = await prisma.carrierNavigationProposal.updateMany({
      where: { id: proposalId, status: 'PROPOSED' },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedBy: reviewerId,
        // Discovery records are platform-wide. Never retain free-form reviewer
        // text because it may contain patient or call details.
        reviewNotes: null,
      },
    });
    return result.count === 1;
  }

  return prisma.$transaction(async (tx) => {
    const proposal = await tx.carrierNavigationProposal.findFirst({
      where: { id: proposalId, status: 'PROPOSED' },
      select: { carrierId: true, proposedNavigation: true, proposedSummary: true, discoveryRunId: true },
    });
    if (!proposal) return false;
    const steps = parseNavigation(proposal.proposedNavigation).steps;
    if (steps.length === 0) return false;
    const latest = await tx.carrierNavigationSnapshot.findFirst({
      where: { carrierId: proposal.carrierId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const snapshot = await tx.carrierNavigationSnapshot.create({
      data: {
        carrierId: proposal.carrierId,
        version: (latest?.version ?? 0) + 1,
        navigation: { steps },
        summary: proposal.proposedSummary,
        publishedAt: new Date(),
        publishedBy: reviewerId,
      },
    });
    const updated = await tx.carrierNavigationProposal.updateMany({
      where: { id: proposalId, status: 'PROPOSED' },
      data: {
        status: 'APPROVED' as CarrierNavigationProposalStatus,
        reviewedAt: new Date(),
        reviewedBy: reviewerId,
        reviewNotes: null,
        publishedSnapshotId: snapshot.id,
      },
    });
    if (updated.count !== 1) return false;
    if (proposal.discoveryRunId) {
      await tx.carrierDiscoveryRun.updateMany({
        where: { id: proposal.discoveryRunId, status: { in: ['PENDING', 'READY_FOR_OPERATOR'] } },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }
    return true;
  });
}

