import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { appendRequiredAuditLog } from '../audit/auditLog.js';
import consentConfig from './consent-attestation.json';

/**
 * Practice consent attestation and agent permission gate (policy research
 * HP#1, HP#9; synthesis H1, H2). Both dispatch paths call validateDispatch(),
 * which calls checkConsentDispatchGate() here, so the scheduled queue and the
 * manual trigger cannot diverge.
 *
 * The wording is PENDING_COUNSEL. Enforcement is behind
 * CONSENT_ATTESTATION_ENFORCED and is OFF by default: with the flag off the
 * gate returns allowed without querying, which is the current behaviour.
 */

export const CONSENT_ATTESTATION_TEXT_VERSION: string = consentConfig.textVersion;
export const AGENT_PERMISSION_PURPOSE: string = consentConfig.agentPermissionPurpose;
export const CONSENT_ATTESTATION_TEXT_PLACEHOLDER: string = consentConfig.attestationText;

export const CONSENT_ATTESTATION_ENFORCED_ENV = 'CONSENT_ATTESTATION_ENFORCED';

export type ConsentGateCode =
  | 'CONSENT_ATTESTATION_MISSING'
  | 'CONSENT_ATTESTATION_REVOKED'
  | 'CONSENT_ATTESTATION_VERSION_STALE'
  | 'AGENT_PERMISSION_MISSING';

export type ConsentGateDecision =
  | { allowed: true }
  | { allowed: false; code: ConsentGateCode; reason: string };

const NEXT_ACTION: Record<ConsentGateCode, string> = {
  CONSENT_ATTESTATION_MISSING:
    'Practice owner must record the consent attestation before calls resume.',
  CONSENT_ATTESTATION_REVOKED:
    'The consent attestation was revoked. Practice owner must record it again before calls resume.',
  CONSENT_ATTESTATION_VERSION_STALE:
    'The attestation wording changed. Practice owner must attest to the current version before calls resume.',
  AGENT_PERMISSION_MISSING:
    'Practice owner must grant the claim status inquiry agent permission before calls resume.',
};

function deny(code: ConsentGateCode): ConsentGateDecision {
  return { allowed: false, code, reason: NEXT_ACTION[code] };
}

export function isConsentAttestationEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[CONSENT_ATTESTATION_ENFORCED_ENV];
  return raw === '1' || raw === 'true';
}

/** Pure policy over the latest attestation and permission rows. */
export async function evaluateConsentGate(
  prisma: PrismaClient,
  practiceId: string,
): Promise<ConsentGateDecision> {
  const latest = await prisma.practiceConsentAttestation.findFirst({
    where: { practiceId },
    orderBy: { attestedAt: 'desc' },
  });
  if (!latest) return deny('CONSENT_ATTESTATION_MISSING');
  if (latest.revokedAt) return deny('CONSENT_ATTESTATION_REVOKED');
  if (latest.supersededAt || latest.textVersion !== CONSENT_ATTESTATION_TEXT_VERSION) {
    return deny('CONSENT_ATTESTATION_VERSION_STALE');
  }
  const permission = await prisma.practiceAgentPermission.findUnique({
    where: { practiceId_purpose: { practiceId, purpose: AGENT_PERMISSION_PURPOSE } },
  });
  if (!permission || permission.revokedAt) return deny('AGENT_PERMISSION_MISSING');
  return { allowed: true };
}

/** Dispatch preflight. Flag off means no query and no change to dispatch. */
export async function checkConsentDispatchGate(
  prisma: PrismaClient,
  practiceId: string,
): Promise<ConsentGateDecision> {
  if (!isConsentAttestationEnforced()) return { allowed: true };
  return evaluateConsentGate(prisma, practiceId);
}

export class ConsentAttestationError extends Error {
  constructor(
    readonly code: 'INVALID_SIGNER' | 'STALE_TEXT_VERSION' | 'ALREADY_ATTESTED' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ConsentAttestationError';
  }
}

export interface CreateConsentAttestationInput {
  practiceId: string;
  textVersion: string;
  signerName: string;
  signerRole: string;
  userId?: string;
  req?: Request;
}

const MAX_SIGNER_NAME = 200;
const MAX_SIGNER_ROLE = 100;
const MAX_REVOCATION_REASON = 500;

export async function createConsentAttestation(
  prisma: PrismaClient,
  input: CreateConsentAttestationInput,
) {
  const signerName = input.signerName.trim();
  const signerRole = input.signerRole.trim();
  if (
    signerName.length === 0 ||
    signerName.length > MAX_SIGNER_NAME ||
    signerRole.length === 0 ||
    signerRole.length > MAX_SIGNER_ROLE
  ) {
    throw new ConsentAttestationError('INVALID_SIGNER', 'Signer name and role are required');
  }
  if (input.textVersion !== CONSENT_ATTESTATION_TEXT_VERSION) {
    throw new ConsentAttestationError(
      'STALE_TEXT_VERSION',
      'Attestation text version does not match the current version',
    );
  }

  const active = await prisma.practiceConsentAttestation.findFirst({
    where: { practiceId: input.practiceId, revokedAt: null, supersededAt: null },
    orderBy: { attestedAt: 'desc' },
  });
  if (active && active.textVersion === input.textVersion) {
    throw new ConsentAttestationError('ALREADY_ATTESTED', 'This attestation version is already active');
  }

  const created = await prisma.practiceConsentAttestation.create({
    data: {
      practiceId: input.practiceId,
      textVersion: input.textVersion,
      signerName,
      signerRole,
      attestedByUserId: input.userId ?? null,
    },
  });

  if (active) {
    await prisma.practiceConsentAttestation.update({
      where: { id: active.id },
      data: { supersededAt: new Date() },
    });
    await appendRequiredAuditLog(prisma, {
      practiceId: input.practiceId,
      userId: input.userId,
      action: 'consent_attestation.version_changed',
      subjectType: 'practice_consent_attestation',
      subjectId: active.id,
      details: { fromVersion: active.textVersion, toVersion: input.textVersion },
      req: input.req,
    });
  }

  await appendRequiredAuditLog(prisma, {
    practiceId: input.practiceId,
    userId: input.userId,
    action: 'consent_attestation.created',
    subjectType: 'practice_consent_attestation',
    subjectId: created.id,
    details: { textVersion: input.textVersion, signerRole },
    req: input.req,
  });
  return created;
}

export async function revokeConsentAttestation(
  prisma: PrismaClient,
  input: { practiceId: string; userId?: string; reason: string; req?: Request },
) {
  const active = await prisma.practiceConsentAttestation.findFirst({
    where: { practiceId: input.practiceId, revokedAt: null, supersededAt: null },
    orderBy: { attestedAt: 'desc' },
  });
  if (!active) {
    throw new ConsentAttestationError('NOT_FOUND', 'No active consent attestation to revoke');
  }
  const reason = input.reason.trim().slice(0, MAX_REVOCATION_REASON);
  await prisma.practiceConsentAttestation.update({
    where: { id: active.id },
    data: { revokedAt: new Date(), revokedByUserId: input.userId ?? null, revocationReason: reason || null },
  });
  await appendRequiredAuditLog(prisma, {
    practiceId: input.practiceId,
    userId: input.userId,
    action: 'consent_attestation.revoked',
    subjectType: 'practice_consent_attestation',
    subjectId: active.id,
    details: { textVersion: active.textVersion },
    req: input.req,
  });
}

/** secondaryUseAllowed is always false here; nothing in this release sets it. */
export async function grantAgentPermission(
  prisma: PrismaClient,
  input: { practiceId: string; userId?: string; req?: Request },
) {
  await prisma.practiceAgentPermission.upsert({
    where: { practiceId_purpose: { practiceId: input.practiceId, purpose: AGENT_PERMISSION_PURPOSE } },
    create: {
      practiceId: input.practiceId,
      purpose: AGENT_PERMISSION_PURPOSE,
      secondaryUseAllowed: false,
      grantedByUserId: input.userId ?? null,
    },
    update: { revokedAt: null, grantedAt: new Date(), grantedByUserId: input.userId ?? null },
  });
  await appendRequiredAuditLog(prisma, {
    practiceId: input.practiceId,
    userId: input.userId,
    action: 'agent_permission.granted',
    subjectType: 'practice_agent_permission',
    subjectId: AGENT_PERMISSION_PURPOSE,
    details: { purpose: AGENT_PERMISSION_PURPOSE, secondaryUseAllowed: false },
    req: input.req,
  });
}

export async function revokeAgentPermission(
  prisma: PrismaClient,
  input: { practiceId: string; userId?: string; req?: Request },
) {
  const permission = await prisma.practiceAgentPermission.findUnique({
    where: { practiceId_purpose: { practiceId: input.practiceId, purpose: AGENT_PERMISSION_PURPOSE } },
  });
  if (!permission || permission.revokedAt) {
    throw new ConsentAttestationError('NOT_FOUND', 'No active agent permission to revoke');
  }
  await prisma.practiceAgentPermission.update({
    where: { id: permission.id },
    data: { revokedAt: new Date() },
  });
  await appendRequiredAuditLog(prisma, {
    practiceId: input.practiceId,
    userId: input.userId,
    action: 'agent_permission.revoked',
    subjectType: 'practice_agent_permission',
    subjectId: AGENT_PERMISSION_PURPOSE,
    details: { purpose: AGENT_PERMISSION_PURPOSE },
    req: input.req,
  });
}

export async function getConsentStatus(prisma: PrismaClient, practiceId: string) {
  const [latest, permission, decision] = await Promise.all([
    prisma.practiceConsentAttestation.findFirst({
      where: { practiceId },
      orderBy: { attestedAt: 'desc' },
      select: {
        id: true,
        textVersion: true,
        signerName: true,
        signerRole: true,
        attestedAt: true,
        revokedAt: true,
        supersededAt: true,
      },
    }),
    prisma.practiceAgentPermission.findUnique({
      where: { practiceId_purpose: { practiceId, purpose: AGENT_PERMISSION_PURPOSE } },
      select: { revokedAt: true, grantedAt: true },
    }),
    evaluateConsentGate(prisma, practiceId),
  ]);
  return {
    enforced: isConsentAttestationEnforced(),
    currentTextVersion: CONSENT_ATTESTATION_TEXT_VERSION,
    attestation: latest,
    agentPermission: {
      purpose: AGENT_PERMISSION_PURPOSE,
      active: Boolean(permission && !permission.revokedAt),
      secondaryUseAllowed: false as const,
    },
    dispatchAllowed: decision.allowed,
    dispatchBlockCode: decision.allowed ? null : decision.code,
  };
}
